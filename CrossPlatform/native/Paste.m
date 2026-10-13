#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// Runs inside the signed application, which owns the Accessibility permission.
// Field contents are only used in memory; diagnostics contain reason codes only.
static id VIAttributeWithError(AXUIElementRef element, CFStringRef name, AXError *error) {
    AXUIElementSetMessagingTimeout(element, .12);
    CFTypeRef result = NULL;
    AXError status = AXUIElementCopyAttributeValue(element, name, &result);
    if (error) *error = status;
    if (status != kAXErrorSuccess) return nil;
    return CFBridgingRelease(result);
}
static id VIAttribute(AXUIElementRef element, CFStringRef name) { return VIAttributeWithError(element, name, NULL); }
// Main-queue, content-free evidence of how the most recent focus search failed.
static NSMutableArray *vi_focus_probes;
static AXError vi_accessibility_request_error;
typedef id (*VIAttributeReader)(AXUIElementRef, CFStringRef);
static BOOL VIIsElement(id value) {
    return value && CFGetTypeID((__bridge CFTypeRef)value) == AXUIElementGetTypeID();
}
static BOOL VIEditorExcluded(AXUIElementRef element, VIAttributeReader read) {
    return [read(element, kAXEnabledAttribute) isEqual:@NO]
        || [read(element, CFSTR("AXEditable")) isEqual:@NO]
        || [read(element, CFSTR("AXReadOnly")) isEqual:@YES]
        || [read(element, kAXSubroleAttribute) isEqual:(__bridge NSString *)kAXSecureTextFieldSubrole];
}
static BOOL VIFocusUnavailable(AXUIElementRef element, VIAttributeReader read) {
    if (!element) return YES;
    if (VIEditorExcluded(element, read)) return NO;
    NSString *role = read(element, kAXRoleAttribute);
    // Embedded editors sometimes expose only their focused wrapper. The
    // wrapper is not an editable AX element, but Cmd+V still reaches its input.
    return !role || [@[@"AXGroup", @"AXWebArea", @"AXScrollArea", @"AXWindow", @"AXApplication"] containsObject:role];
}
static BOOL VIIsEditable(AXUIElementRef element, VIAttributeReader read) {
    if (VIEditorExcluded(element, read)) return NO;
    Boolean valueSettable = false, selectedSettable = false;
    AXUIElementIsAttributeSettable(element, kAXValueAttribute, &valueSettable);
    AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute, &selectedSettable);
    NSString *role = read(element, kAXRoleAttribute);
    return valueSettable || selectedSettable || [read(element, CFSTR("AXEditable")) boolValue]
        || [@[(__bridge NSString *)kAXTextFieldRole, (__bridge NSString *)kAXTextAreaRole,
            (__bridge NSString *)kAXComboBoxRole] containsObject:role ?: @""];
}
// Chromium and rich text editors can focus an AXGroup around the actual input.
// Resolve only within that focus anchor; multiple editors are ambiguous.
static BOOL VISearchAvailable(int budget, CFAbsoluteTime deadline) {
    return budget > 0 && CFAbsoluteTimeGetCurrent() < deadline;
}
static AXUIElementRef VIResolveEditor(AXUIElementRef anchor, VIAttributeReader read, int depth, int *budget, CFAbsoluteTime deadline) CF_RETURNS_RETAINED;
static AXUIElementRef VIResolveEditor(AXUIElementRef anchor, VIAttributeReader read, int depth, int *budget, CFAbsoluteTime deadline) {
    if (!anchor || depth < 0 || !VISearchAvailable((*budget)--, deadline)
        || VIEditorExcluded(anchor, read)) return NULL;
    if (VIIsEditable(anchor, read)) return (AXUIElementRef)CFRetain(anchor);
    id nested = read(anchor, kAXFocusedUIElementAttribute);
    if (VIIsElement(nested) && !CFEqual(anchor, (__bridge CFTypeRef)nested)) {
        AXUIElementRef editor = VIResolveEditor((__bridge AXUIElementRef)nested, read, depth - 1, budget, deadline);
        if (editor) return editor;
    }
    NSArray *children = read(anchor, kAXChildrenAttribute);
    if (![children isKindOfClass:NSArray.class]) return NULL;
    NSMutableArray *editors = [NSMutableArray new], *focusedEditors = [NSMutableArray new];
    for (id child in children) {
        if (!VISearchAvailable(*budget, deadline)) break;
        if (!VIIsElement(child) || CFEqual(anchor, (__bridge CFTypeRef)child)) continue;
        AXUIElementRef editor = VIResolveEditor((__bridge AXUIElementRef)child, read, depth - 1, budget, deadline);
        if (!editor) continue;
        id object = CFBridgingRelease(editor);
        [editors addObject:object];
        if ([read((__bridge AXUIElementRef)child, kAXFocusedAttribute) isEqual:@YES]
            || [read((__bridge AXUIElementRef)object, kAXFocusedAttribute) isEqual:@YES])
            [focusedEditors addObject:object];
    }
    if (!VISearchAvailable(*budget, deadline)) return NULL;
    NSArray *candidates = focusedEditors.count ? focusedEditors : editors;
    if (candidates.count != 1) return NULL;
    return (AXUIElementRef)CFRetain((__bridge CFTypeRef)candidates.firstObject);
}
// An app-level focus attribute can be absent or point at a web wrapper while
// the active window still exposes the focused editor. Unlike a focus anchor,
// a whole window must never resolve merely because it has one editable field.
static AXUIElementRef VIResolveWindowFocus(AXUIElementRef node, VIAttributeReader read, int depth, int *budget, CFAbsoluteTime deadline) CF_RETURNS_RETAINED;
static AXUIElementRef VIResolveWindowFocus(AXUIElementRef node, VIAttributeReader read, int depth, int *budget, CFAbsoluteTime deadline) {
    if (!node || depth < 0 || !VISearchAvailable((*budget)--, deadline) || VIEditorExcluded(node, read)) return NULL;
    id focused = read(node, kAXFocusedUIElementAttribute);
    if (VIIsElement(focused) && !CFEqual(node, (__bridge CFTypeRef)focused)) {
        AXUIElementRef editor = VIResolveEditor((__bridge AXUIElementRef)focused, read, 12, budget, deadline);
        if (editor) return editor;
    }
    NSString *role = read(node, kAXRoleAttribute);
    if (![@[@"AXWindow", @"AXApplication"] containsObject:role ?: @""] && [read(node, kAXFocusedAttribute) isEqual:@YES]) {
        AXUIElementRef editor = VIResolveEditor(node, read, 12, budget, deadline);
        if (editor) return editor;
    }
    // Do not search the text/layout descendants of an unfocused input.
    if ([@[@"AXTextArea", @"AXTextField", @"AXComboBox", @"AXStaticText"] containsObject:role ?: @""]) return NULL;
    NSArray *children = read(node, kAXChildrenAttribute);
    if (![children isKindOfClass:NSArray.class]) return NULL;
    for (id child in children) {
        if (!VISearchAvailable(*budget, deadline)) break;
        if (!VIIsElement(child) || CFEqual(node, (__bridge CFTypeRef)child)) continue;
        AXUIElementRef editor = VIResolveWindowFocus((__bridge AXUIElementRef)child, read, depth - 1, budget, deadline);
        if (editor) return editor;
    }
    return NULL;
}
static AXUIElementRef VIFocusedElement(void) CF_RETURNS_RETAINED;
static AXUIElementRef VIFocusedElement(void) {
    vi_focus_probes = [NSMutableArray new];
    NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!front) return NULL;
    AXUIElementRef application = AXUIElementCreateApplication(front.processIdentifier);
    AXUIElementSetMessagingTimeout(application, .12);
    AXUIElementRef system = AXUIElementCreateSystemWide();
    id fallback = nil;
    AXUIElementRef result = NULL;
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + .3;
    for (int source = 0; source < 3 && !result && CFAbsoluteTimeGetCurrent() < deadline; source++) {
        AXError error = kAXErrorSuccess;
        id value = VIAttributeWithError(source == 1 ? system : application,
            source == 2 ? kAXFocusedWindowAttribute : kAXFocusedUIElementAttribute, &error);
        NSMutableDictionary *probe = [@{@"source":@[@"application",@"system",@"window"][source], @"axError":@(error)} mutableCopy];
        [vi_focus_probes addObject:probe];
        if (!VIIsElement(value)) continue;
        AXUIElementRef anchor = (__bridge AXUIElementRef)value;
        pid_t pid = 0;
        BOOL matches = AXUIElementGetPid(anchor, &pid) == kAXErrorSuccess && pid == front.processIdentifier;
        probe[@"pidMatches"] = @(matches);
        if (!matches) continue;
        int budget = 128;
        NSString *role = VIAttribute(anchor, kAXRoleAttribute) ?: @"none";
        probe[@"anchorRole"] = role;
        BOOL wholeWindow = source == 2 || [@[@"AXWindow", @"AXApplication"] containsObject:role];
        result = wholeWindow ? VIResolveWindowFocus(anchor, VIAttribute, 20, &budget, deadline)
            : VIResolveEditor(anchor, VIAttribute, 12, &budget, deadline);
        probe[@"searchVisited"] = @(128 - budget);
        probe[@"searchExpired"] = @(CFAbsoluteTimeGetCurrent() >= deadline);
        probe[@"resolved"] = @(result != NULL);
        if (source != 2 && !result) {
            // A known button, read-only or secure input must not be replaced
            // with another field discovered elsewhere in the window.
            if (!VIFocusUnavailable(anchor, VIAttribute)) {
                result = (AXUIElementRef)CFRetain(anchor);
                break;
            }
            if (!fallback) fallback = value;
        }
    }
    CFRelease(application);
    CFRelease(system);
    return result ?: (fallback ? (AXUIElementRef)CFRetain((__bridge CFTypeRef)fallback) : NULL);
}
// This is diagnostic metadata only. Some embedded web editors omit AXWebArea,
// so this ancestor test must not decide how text is delivered.
static BOOL VIIsWebEditor(AXUIElementRef element, VIAttributeReader read) {
    id current = (__bridge id)element;
    for (int depth = 0; depth < 12 && VIIsElement(current); depth++) {
        AXUIElementRef node = (__bridge AXUIElementRef)current;
        if ([read(node, kAXRoleAttribute) isEqual:@"AXWebArea"]) return YES;
        id parent = read(node, kAXParentAttribute);
        if (!VIIsElement(parent) || CFEqual(node, (__bridge CFTypeRef)parent)) break;
        current = parent;
    }
    return NO;
}
static NSRange VISelection(AXUIElementRef element) {
    id value = VIAttribute(element, kAXSelectedTextRangeAttribute);
    CFRange range;
    if (value && CFGetTypeID((__bridge CFTypeRef)value) == AXValueGetTypeID()
        && AXValueGetType((__bridge AXValueRef)value) == kAXValueCFRangeType
        && AXValueGetValue((__bridge AXValueRef)value, kAXValueCFRangeType, &range)
        && range.location >= 0 && range.length >= 0) return NSMakeRange(range.location, range.length);
    return NSMakeRange(NSNotFound, 0);
}

// Same conservative evidence rules as the original PasteTargetProbe. Posting a
// keyboard event, or finding text that was already there, is not a success.
BOOL VIInsertionConfirmed(NSString *before, NSRange selection, NSString *after, NSRange afterSelection, NSString *text) {
    if (!before || !after || !text.length) return NO;
    NSString *(^normalize)(NSString *) = ^NSString *(NSString *value) {
        return [value stringByReplacingOccurrencesOfString:@"\r\n" withString:@"\n"];
    };
    if (selection.location <= before.length && selection.length <= before.length - selection.location) {
        NSString *expected = [before stringByReplacingCharactersInRange:selection withString:text];
        if ([normalize(expected) isEqualToString:normalize(after)]) {
            return ![before isEqualToString:after] || (selection.length > 0
                && NSEqualRanges(afterSelection, NSMakeRange(selection.location + text.length, 0)));
        }
    }
    before = normalize(before); after = normalize(after); text = normalize(text);
    if ([before isEqualToString:after]) return NO;
    NSUInteger prefix = 0, suffix = 0;
    while (prefix < MIN(before.length, after.length)
           && [before characterAtIndex:prefix] == [after characterAtIndex:prefix]) prefix++;
    while (suffix < MIN(before.length - prefix, after.length - prefix)
           && [before characterAtIndex:before.length - suffix - 1] == [after characterAtIndex:after.length - suffix - 1]) suffix++;
    NSString *inserted = [after substringWithRange:NSMakeRange(prefix, after.length - prefix - suffix)];
    if ([inserted containsString:text]) return YES;
    if (text.length > after.length) return NO;
    // Shared letters at either edge belong to the replacement too. Require a
    // complete occurrence covering the diff, with unchanged surrounding text.
    NSUInteger changedEnd = after.length - suffix;
    NSUInteger first = changedEnd > text.length ? changedEnd - text.length : 0;
    NSUInteger last = MIN(prefix, after.length - text.length);
    for (NSUInteger start = first; start <= last; start++) {
        NSUInteger end = start + text.length;
        if (end >= changedEnd && start + after.length - end <= before.length
            && [[after substringWithRange:NSMakeRange(start, text.length)] isEqualToString:text]) return YES;
    }
    return NO;
}

@interface VIPasteTarget : NSObject
@property(nonatomic, strong) id elementObject;
@property(nonatomic) pid_t pid;
@property(nonatomic) BOOL webEditor;
@property(nonatomic, copy) NSString *role;
- (AXUIElementRef)element;
- (BOOL)isFocused;
- (NSString *)value;
- (NSRange)selection;
@end
@implementation VIPasteTarget
- (AXUIElementRef)element { return (__bridge AXUIElementRef)self.elementObject; }
- (NSString *)value {
    id value = VIAttribute(self.element, kAXValueAttribute);
    return [value isKindOfClass:NSString.class] ? value : nil;
}
- (NSRange)selection { return VISelection(self.element); }
- (BOOL)isFocused {
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != self.pid) return NO;
    AXUIElementRef focused = VIFocusedElement();
    BOOL matches = focused && CFEqual(self.element, focused);
    if (focused) CFRelease(focused);
    return matches;
}
@end
static VIPasteTarget *vi_target;

static VIPasteTarget *VIFindTarget(NSString **reason) {
    vi_focus_probes = nil;
    vi_accessibility_request_error = kAXErrorAPIDisabled;
    VIPasteTarget *target = nil;
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    *reason = AXIsProcessTrusted() ? @"noEditableField" : @"accessibilityDenied";
    if (!app) { *reason = @"noActiveApplication"; return nil; }
    if (AXIsProcessTrusted()) {
        // Chromium/Electron can expose no editor until manual accessibility is
        // enabled. This requests its AX tree, never grants a macOS permission.
        AXUIElementRef application = AXUIElementCreateApplication(app.processIdentifier);
        AXUIElementSetMessagingTimeout(application, .12);
        vi_accessibility_request_error = AXUIElementSetAttributeValue(application, CFSTR("AXManualAccessibility"), kCFBooleanTrue);
        CFRelease(application);
        AXUIElementRef element = VIFocusedElement();
        if (element) {
            AXUIElementSetMessagingTimeout(element, .12);
            pid_t pid = 0;
            if (AXUIElementGetPid(element, &pid) == kAXErrorSuccess && pid == app.processIdentifier
                && VIIsEditable(element, VIAttribute)) {
                target = [VIPasteTarget new];
                target.elementObject = (__bridge id)element;
                target.pid = pid;
                target.webEditor = VIIsWebEditor(element, VIAttribute);
                target.role = VIAttribute(element, kAXRoleAttribute);
                *reason = @"ready";
            } else if (VIFocusUnavailable(element, VIAttribute)) {
                *reason = @"focusUnavailable";
            }
            CFRelease(element);
        } else *reason = @"focusUnavailable";
    }
    return target;
}
static NSDictionary *VICapture(void) {
    NSString *reason;
    vi_target = VIFindTarget(&reason);
    return @{@"app": NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier ?: @"",
        @"editable": @(vi_target != nil), @"reason": reason};
}

static NSArray *VIKeyEvents(CGKeyCode key, CGEventFlags flags) {
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    if (!source) return nil;
    NSMutableArray *events = [NSMutableArray new];
    BOOL command = (flags & kCGEventFlagMaskCommand) != 0;
    CGKeyCode keys[4] = {55, key, key, 55};
    BOOL downs[4] = {YES, YES, NO, NO};
    int count = command ? 4 : 2;
    for (int i = 0; i < count; i++) {
        CGKeyCode code = command ? keys[i] : key;
        BOOL down = command ? downs[i] : i == 0;
        CGEventRef event = CGEventCreateKeyboardEvent(source, code, down);
        if (!event) { CFRelease(source); return nil; }
        // Release the modifier explicitly; a V-up carrying Command alone
        // leaves the global flags state latched for the next dictation.
        CGEventSetFlags(event, command && i == count - 1 ? 0 : flags);
        [events addObject:CFBridgingRelease(event)];
    }
    CFRelease(source);
    return events;
}
static BOOL VIPostKey(CGKeyCode key, CGEventFlags flags) {
    NSArray *events = VIKeyEvents(key, flags);
    if (!events.count) return NO;
    for (id event in events) CGEventPost(kCGHIDEventTap, (__bridge CGEventRef)event);
    return YES;
}

@interface VIPasteJob : NSObject
@property(nonatomic, strong) VIPasteTarget *target;
@property(nonatomic, copy) NSString *text, *before;
@property(nonatomic) NSRange selection;
@property(nonatomic, copy) NSDictionary *options;
@property(nonatomic, copy) NSArray *previous;
@property(nonatomic) NSInteger change;
@property(nonatomic) NSInteger initialChange;
@property(nonatomic) BOOL clipboardPrepared, pastePosted;
@property(nonatomic) BOOL destinationCaptured;
@property(nonatomic) int focusAttempts;
@property(nonatomic, copy) NSString *capturedApp;
@property(nonatomic, copy) NSString *captureReason;
@property(nonatomic, copy) NSArray *focusProbe;
@property(nonatomic) AXError accessibilityRequestError;
@property(nonatomic) pid_t destinationPID;
@property(nonatomic, strong) id destinationWindowObject;
@property(nonatomic, copy) void (^complete)(NSDictionary *);
- (void)begin;
- (VIPasteTarget *)captureTarget;
- (BOOL)capturedDestinationIsActive;
- (NSPasteboard *)pasteboard;
- (BOOL)modifiersHeld;
- (BOOL)postPasteShortcut;
- (void)postWhenReleased:(int)attempt;
- (void)verify:(int)attempt;
@end
@implementation VIPasteJob
- (void)finish:(NSString *)result reason:(NSString *)reason {
    NSMutableArray *held = [NSMutableArray new];
    const CGKeyCode modifiers[] = {54,55,56,60,58,61,59,62};
    for (int i = 0; i < 8; i++)
        if (CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, modifiers[i])) [held addObject:@(modifiers[i])];
    NSDictionary *diagnostics = @{
        @"revision": @"delivery-20261005-focus2",
        @"frontApp": NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier ?: @"",
        @"capturedApp": self.capturedApp ?: @"",
        @"targetRole": self.target.role ?: @"none", @"webEditor": @(self.target.webEditor),
        @"trusted": @(AXIsProcessTrusted()), @"heldModifiers": held,
        @"eventFlags": @(CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState)),
        @"directAttempted": @NO, @"pastePosted": @(self.pastePosted),
        @"baselineReadable": @(self.before != nil),
        @"focusAttempts": @(self.focusAttempts),
        @"focusProbe": self.focusProbe ?: @[],
        @"accessibilityRequestError": @(self.accessibilityRequestError),
        @"selectionKnown": @(self.target != nil && self.selection.location != NSNotFound)
    };
    self.complete(@{@"result":result,@"reason":reason,@"diagnostics":diagnostics});
}
- (void)begin {
    self.initialChange = self.pasteboard.changeCount;
    if (!self.text.length) { [self finish:@"failed" reason:@"emptyText"]; return; }
    [self postWhenReleased:0];
}
- (NSPasteboard *)pasteboard { return NSPasteboard.generalPasteboard; }
- (VIPasteTarget *)captureTarget {
    NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!self.destinationCaptured) {
        self.destinationCaptured = YES;
        self.capturedApp = front.bundleIdentifier;
        self.destinationPID = front.processIdentifier;
        if (self.destinationPID > 0) {
            AXUIElementRef application = AXUIElementCreateApplication(self.destinationPID);
            id window = VIAttribute(application, kAXFocusedWindowAttribute);
            self.destinationWindowObject = VIIsElement(window) ? window : nil;
            CFRelease(application);
        }
    }
    NSString *reason;
    VIPasteTarget *target = VIFindTarget(&reason);
    self.captureReason = reason;
    self.focusProbe = vi_focus_probes;
    self.accessibilityRequestError = vi_accessibility_request_error;
    return target;
}
- (BOOL)capturedDestinationIsActive {
    if (self.destinationPID <= 0 || self.destinationPID == NSProcessInfo.processInfo.processIdentifier
        || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != self.destinationPID) return NO;
    if (!self.destinationWindowObject) return YES;
    AXUIElementRef application = AXUIElementCreateApplication(self.destinationPID);
    id window = VIAttribute(application, kAXFocusedWindowAttribute);
    CFRelease(application);
    return VIIsElement(window) && CFEqual((__bridge CFTypeRef)window, (__bridge CFTypeRef)self.destinationWindowObject);
}
- (BOOL)modifiersHeld {
    // Check the actual left/right modifier keys. Aggregate event flags can
    // retain Command from a previous synthesized shortcut after key release.
    const CGKeyCode modifiers[] = {54, 55, 56, 60, 58, 61, 59, 62};
    for (int i = 0; i < 8; i++)
        if (CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, modifiers[i])) return YES;
    return NO;
}
- (BOOL)postPasteShortcut { return VIPostKey(9, kCGEventFlagMaskCommand); }
- (NSString *)clipboardBundleIdentifier { return NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.lowercaseString ?: @""; }
- (BOOL)prepareClipboard {
    NSPasteboard *board = self.pasteboard;
    NSMutableArray *previous = [NSMutableArray new];
    for (NSPasteboardItem *item in board.pasteboardItems) {
        NSMutableDictionary *saved = [NSMutableDictionary new];
        for (NSPasteboardType type in item.types) { NSData *data = [item dataForType:type]; if (data) saved[type] = data; }
        [previous addObject:saved];
    }
    self.previous = previous;
    [board clearContents];
    if (![board setString:self.text forType:NSPasteboardTypeString]) return NO;
    NSString *html = self.options[@"html"];
    NSString *bundle = [self clipboardBundleIdentifier];
    BOOL plain = NO;
    for (NSString *name in @[@"terminal", @"iterm", @"ghostty", @"warp", @"cursor", @"vscode", @"codex", @"zed", @"xcode", @"com.todesktop.230313mzl4w4u92"]) {
        if ([bundle containsString:name]) { plain = YES; break; }
    }
    if (!plain && [html isKindOfClass:NSString.class] && html.length) [board setString:html forType:NSPasteboardTypeHTML];
    self.change = board.changeCount;
    self.clipboardPrepared = YES;
    return YES;
}
- (void)copyFallback:(NSString *)reason {
    if (self.clipboardPrepared) {
        NSPasteboard *board = self.pasteboard;
        if (board.changeCount != self.change || ![[board stringForType:NSPasteboardTypeString] isEqualToString:self.text]) {
            [self finish:@"failed" reason:@"clipboardChanged"]; return;
        }
    } else {
        // A copy made while waiting for the shortcut belongs to the user;
        // keep the transcript in History on failure.
        if (self.pasteboard.changeCount != self.initialChange) {
            [self finish:@"failed" reason:@"clipboardChanged"]; return;
        }
        if (![self prepareClipboard]) {
            [self finish:@"failed" reason:@"clipboardUnavailable"]; return;
        }
    }
    [self finish:@"clipboardOnly" reason:reason];
}
- (void)restoreClipboard {
    if (!self.clipboardPrepared || ![self.options[@"restore"] boolValue]) return;
    NSPasteboard *board = self.pasteboard;
    if (board.changeCount != self.change || ![[board stringForType:NSPasteboardTypeString] isEqualToString:self.text]) return;
    NSMutableArray *items = [NSMutableArray new];
    for (NSDictionary *saved in self.previous) {
        NSPasteboardItem *item = [NSPasteboardItem new];
        for (NSString *type in saved) [item setData:saved[type] forType:type];
        [items addObject:item];
    }
    [board clearContents];
    if (items.count) [board writeObjects:items];
}
- (void)postWhenReleased:(int)attempt {
    if ([self modifiersHeld]) {
        if (attempt >= 20) { [self copyFallback:@"shortcutHeld"]; return; }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ [self postWhenReleased:attempt + 1]; });
        return;
    }
    // The recording target is for context only. Delivery uses the field that
    // is focused now, including a different field selected during dictation.
    if (self.focusAttempts > 0 && ![self capturedDestinationIsActive]) { [self copyFallback:@"focusChanged"]; return; }
    self.focusAttempts++;
    self.target = [self captureTarget];
    // Chromium's AX tree may arrive asynchronously after it is requested.
    // Acquire the baseline before posting once; observing text only after a
    // blind paste cannot distinguish a new insert from existing text.
    if (!self.target && [self.captureReason isEqual:@"focusUnavailable"] && self.focusAttempts < 6) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ [self postWhenReleased:0]; });
        return;
    }
    if (!self.target) {
        // Some editors expose no focused AX element at all. Their normal paste
        // command still works. Keep the text in the clipboard because consuming
        // it cannot be verified; never auto-send or post a second paste.
        // A known noneditable/protected field and missing AX permission retain
        // the copy-only behavior.
        if (![self.captureReason isEqual:@"focusUnavailable"]) { [self copyFallback:self.captureReason]; return; }
        if (![self capturedDestinationIsActive]) { [self copyFallback:@"focusChanged"]; return; }
        if (self.pasteboard.changeCount != self.initialChange) { [self finish:@"failed" reason:@"clipboardChanged"]; return; }
        if (![self prepareClipboard]) { [self finish:@"failed" reason:@"clipboardUnavailable"]; return; }
        if (![self capturedDestinationIsActive]) { [self copyFallback:@"focusChanged"]; return; }
        if (![self postPasteShortcut]) { [self copyFallback:@"eventUnavailable"]; return; }
        self.pastePosted = YES;
        [self finish:@"clipboardOnly" reason:@"verificationUnavailable"];
        return;
    }
    self.before = self.target.value;
    self.selection = self.target.selection;
    if (!self.target.isFocused) { [self copyFallback:@"focusChanged"]; return; }
    // AXSelectedText can return success without editing the field, including
    // in embedded web editors whose AX tree has no AXWebArea ancestor. Use the
    // editor's normal paste command once, then verify and restore the clipboard.
    if (self.pasteboard.changeCount != self.initialChange) { [self finish:@"failed" reason:@"clipboardChanged"]; return; }
    if (![self prepareClipboard]) { [self finish:@"failed" reason:@"clipboardUnavailable"]; return; }
    if (!self.target.isFocused) { [self copyFallback:@"focusChanged"]; return; }
    if (![self postPasteShortcut]) { [self copyFallback:@"eventUnavailable"]; return; }
    self.pastePosted = YES;
    [self verify:0];
}
- (void)verify:(int)attempt {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        // Focus may move after the editor consumed the paste. Verify the
        // receiving element first so its temporary clipboard is still restored.
        BOOL inserted = VIInsertionConfirmed(self.before, self.selection,
            self.target.value, self.target.selection, self.text);
        if (!inserted) {
            if (!self.target.isFocused) { [self copyFallback:@"focusChanged"]; return; }
            if (attempt < 13) { [self verify:attempt + 1]; return; }
            [self copyFallback:@"unverified"]; return;
        }
        // Verification proves the editor consumed the clipboard; restore it
        // before reporting completion so a subsequent manual paste is stable.
        [self restoreClipboard];
        NSString *send = self.options[@"autoSend"];
        if ([@[@"enter", @"tab", @"commandEnter"] containsObject:send]) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                if (self.target.isFocused) VIPostKey([send isEqual:@"tab"] ? 48 : 36, [send isEqual:@"commandEnter"] ? kCGEventFlagMaskCommand : 0);
            });
        }
        [self finish:@"inserted" reason:@"verified"];
    });
}
@end

// Called by Rust's blocking worker, never by the UI thread. All AppKit/AX state
// remains on the main queue; verification yields between reads instead of
// blocking the editor that needs to process Cmd+V.
char *no_tipe_paste_request(const char *json) {
    @autoreleasepool {
        NSDictionary *message = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        dispatch_semaphore_t ready = dispatch_semaphore_create(0);
        __block NSDictionary *result;
        dispatch_async(dispatch_get_main_queue(), ^{
            NSString *action = message[@"action"];
            if ([action isEqual:@"capture"]) result = VICapture();
            else if ([action isEqual:@"paste"]) {
                VIPasteJob *job = [VIPasteJob new];
                vi_target = nil;
                job.options = message; job.text = message[@"text"] ?: @"";
                job.complete = ^(NSDictionary *value) { result = value; dispatch_semaphore_signal(ready); };
                [job begin]; return;
            } else if ([action isEqual:@"copyFormatted"]) {
                NSPasteboard *board = NSPasteboard.generalPasteboard;
                [board clearContents];
                BOOL copied = [board setString:message[@"text"] ?: @"" forType:NSPasteboardTypeString];
                if ([message[@"html"] isKindOfClass:NSString.class]) [board setString:message[@"html"] forType:NSPasteboardTypeHTML];
                result = copied ? @{@"ok":@YES} : @{@"error":@"Could not copy the snippet"};
            } else if ([action isEqual:@"context"]) {
                id selected = vi_target ? VIAttribute(vi_target.element, kAXSelectedTextAttribute) : nil;
                result = @{@"selected": [selected isKindOfClass:NSString.class] ? selected : @""};
            } else result = @{@"error":@"Unknown paste action"};
            dispatch_semaphore_signal(ready);
        });
        dispatch_semaphore_wait(ready, DISPATCH_TIME_FOREVER);
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        return strdup([[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding].UTF8String);
    }
}
void no_tipe_paste_free(char *value) { free(value); }
