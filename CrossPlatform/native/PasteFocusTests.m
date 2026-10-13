#import "Paste.m"

static NSMutableDictionary *attributes;
static int nextPid = 100000;
static NSValue *Key(AXUIElementRef element) { return [NSValue valueWithPointer:element]; }
static id Read(AXUIElementRef element, CFStringRef name) { return attributes[Key(element)][(__bridge NSString *)name]; }
static id Node(NSString *role) {
    id object = CFBridgingRelease(AXUIElementCreateApplication(nextPid++));
    attributes[Key((__bridge AXUIElementRef)object)] = [@{@"AXRole":role,@"AXEnabled":@YES} mutableCopy];
    return object;
}
static void Put(id node, NSString *name, id value) { attributes[Key((__bridge AXUIElementRef)node)][name] = value; }
static BOOL Resolves(id anchor, id expected, int budget) {
    AXUIElementRef result = VIResolveEditor((__bridge AXUIElementRef)anchor, Read, 4, &budget, CFAbsoluteTimeGetCurrent() + 1);
    BOOL matches = expected ? result && CFEqual(result, (__bridge CFTypeRef)expected) : result == NULL;
    if (result) CFRelease(result);
    return matches;
}
static BOOL ResolvesWindow(id window, id expected, int budget) {
    AXUIElementRef result = VIResolveWindowFocus((__bridge AXUIElementRef)window, Read, 20, &budget, CFAbsoluteTimeGetCurrent() + 1);
    BOOL matches = expected ? result && CFEqual(result, (__bridge CFTypeRef)expected) : result == NULL;
    if (result) CFRelease(result);
    return matches;
}
int main(void) {
    @autoreleasepool {
        attributes = [NSMutableDictionary new];
        id first = Node(@"AXTextArea"), second = Node(@"AXTextField");
        NSCAssert(Resolves(first, first, 32), @"A directly focused editor remains valid");
        id group = Node(@"AXGroup");
        Put(group, @"AXChildren", @[first]);
        NSCAssert(Resolves(group, first, 32), @"Resolve the editor inside a focused AXGroup");
        id outer = Node(@"AXGroup");
        Put(outer, @"AXChildren", @[group]);
        NSCAssert(Resolves(outer, first, 32), @"Resolve nested focus wrappers");
        Put(group, @"AXChildren", @[first,second]);
        NSCAssert(Resolves(group, nil, 32), @"Never choose an arbitrary editor from multiple candidates");
        Put(second, @"AXFocused", @YES);
        NSCAssert(Resolves(group, second, 32), @"Prefer the explicitly focused child");
        Put(group, @"AXFocusedUIElement", first);
        NSCAssert(Resolves(group, first, 32), @"Follow the container's own focused element");
        Put(first, @"AXEditable", @NO);
        NSCAssert(Resolves(first, nil, 32), @"Reject a read-only editor");
        id secure = Node(@"AXTextField");
        Put(secure, @"AXSubrole", @"AXSecureTextField");
        NSCAssert(Resolves(secure, nil, 32), @"Secure input is excluded");
        id disabled = Node(@"AXTextArea");
        Put(disabled, @"AXEnabled", @NO);
        NSCAssert(Resolves(disabled, nil, 32), @"Disabled fields are excluded");
        id cycle = Node(@"AXGroup");
        Put(cycle, @"AXChildren", @[cycle]);
        NSCAssert(Resolves(cycle, nil, 32), @"Self references do not recurse");
        NSCAssert(Resolves(outer, nil, 1), @"Incomplete searches do not select an editor");
        id webArea = Node(@"AXWebArea"), webGroup = Node(@"AXGroup"), webField = Node(@"AXTextArea");
        Put(webField, @"AXParent", webGroup); Put(webGroup, @"AXParent", webArea);
        NSCAssert(VIIsWebEditor((__bridge AXUIElementRef)webField, Read), @"Detect a web editor through its accessibility ancestors");
        NSCAssert(!VIIsWebEditor((__bridge AXUIElementRef)second, Read), @"Native editors retain direct insertion");
        Put(cycle, @"AXParent", cycle);
        NSCAssert(!VIIsWebEditor((__bridge AXUIElementRef)cycle, Read), @"Cyclic parents do not hang web detection");
        id focusedField = Node(@"AXTextArea"), nestedGroup = Node(@"AXGroup"), splitGroup = Node(@"AXGroup");
        Put(focusedField, @"AXFocused", @YES); Put(nestedGroup, @"AXChildren", @[focusedField]);
        Put(splitGroup, @"AXChildren", @[nestedGroup, Node(@"AXTextField")]);
        NSCAssert(Resolves(splitGroup, focusedField, 32), @"Focus on a nested editor disambiguates its wrapper");
        NSCAssert(VIFocusUnavailable(NULL, Read), @"A missing AX focus can use a normal paste");
        id opaque = Node(@"AXUnknown");
        [attributes[Key((__bridge AXUIElementRef)opaque)] removeObjectForKey:@"AXRole"];
        NSCAssert(VIFocusUnavailable((__bridge AXUIElementRef)opaque, Read), @"An unavailable AX role permits compatibility insertion");
        NSCAssert(!VIFocusUnavailable((__bridge AXUIElementRef)Node(@"AXButton"), Read), @"A known noneditable control is not an unavailable editor");
        Put(opaque, @"AXReadOnly", @YES);
        NSCAssert(!VIFocusUnavailable((__bridge AXUIElementRef)opaque, Read), @"An opaque read-only field never receives compatibility insertion");
        Put(opaque, @"AXReadOnly", @NO); Put(opaque, @"AXSubrole", @"AXSecureTextField");
        NSCAssert(!VIFocusUnavailable((__bridge AXUIElementRef)opaque, Read), @"An opaque secure field remains excluded");
        Put(opaque, @"AXSubrole", @"AXUnknown"); Put(opaque, @"AXEnabled", @NO);
        NSCAssert(!VIFocusUnavailable((__bridge AXUIElementRef)opaque, Read), @"An opaque disabled field remains excluded");
        for (NSString *role in @[@"AXGroup", @"AXWebArea", @"AXScrollArea"]) {
            id wrapper = Node(role);
            NSCAssert(VIFocusUnavailable((__bridge AXUIElementRef)wrapper, Read), @"A focused editor wrapper permits normal paste when the inner field cannot be resolved");
            Put(wrapper, @"AXReadOnly", @YES);
            NSCAssert(!VIFocusUnavailable((__bridge AXUIElementRef)wrapper, Read), @"Explicit read-only wrappers remain excluded");
        }
        id window = Node(@"AXWindow"), composer = Node(@"AXTextArea");
        Put(window, @"AXChildren", @[composer]);
        Put(window, @"AXFocused", @YES);
        NSCAssert(ResolvesWindow(window, nil, 128), @"A lone unfocused editor in a window is not a paste target");
        Put(composer, @"AXFocused", @YES);
        NSCAssert(ResolvesWindow(window, composer, 128), @"Recover explicit editor focus from the active window");
        id deep = composer;
        for (int i = 0; i < 8; i++) { id wrapper = Node(@"AXGroup"); Put(wrapper, @"AXChildren", @[deep]); deep = wrapper; }
        Put(window, @"AXChildren", @[deep]);
        NSCAssert(ResolvesWindow(window, composer, 128), @"Find focused editors deeper than four wrappers");
        NSCAssert(ResolvesWindow(window, nil, 4), @"Window focus search remains bounded");
        Put(composer, @"AXReadOnly", @YES);
        NSCAssert(ResolvesWindow(window, nil, 128), @"Window fallback excludes read-only fields");
        Put(composer, @"AXReadOnly", @NO); Put(composer, @"AXSubrole", @"AXSecureTextField");
        NSCAssert(ResolvesWindow(window, nil, 128), @"Window fallback excludes secure fields");
        Put(composer, @"AXSubrole", @"AXUnknown"); Put(composer, @"AXFocused", @NO);
        Put(window, @"AXFocusedUIElement", deep);
        NSCAssert(ResolvesWindow(window, composer, 128), @"A window's focused element can be a deep wrapper");
        Put(window, @"AXFocusedUIElement", cycle); Put(window, @"AXChildren", @[cycle]);
        NSCAssert(ResolvesWindow(window, nil, 128), @"Window fallback handles cyclic focus trees");
        int timedBudget = 128;
        NSCAssert(!VIResolveWindowFocus((__bridge AXUIElementRef)window, Read, 20, &timedBudget, CFAbsoluteTimeGetCurrent() - 1),
            @"Window focus search also obeys a time budget");
        puts("Paste focus: 36 regression checks passed");
    }
}
