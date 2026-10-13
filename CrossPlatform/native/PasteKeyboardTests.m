#import "Paste.m"
int main(void) {
    @autoreleasepool {
        NSArray *paste = VIKeyEvents(9, kCGEventFlagMaskCommand);
        NSCAssert(paste.count == 4, @"Paste includes modifier down and release");
        int keys[] = {55,9,9,55}; CGEventType types[] = {kCGEventFlagsChanged,kCGEventKeyDown,kCGEventKeyUp,kCGEventFlagsChanged};
        for (int i = 0; i < 4; i++) {
            CGEventRef event = (__bridge CGEventRef)paste[i];
            NSCAssert(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) == keys[i], @"Correct physical key order");
            NSCAssert(CGEventGetType(event) == types[i], @"Modifier changes bracket the V down/up events");
        }
        NSCAssert((CGEventGetFlags((__bridge CGEventRef)paste[1]) & kCGEventFlagMaskCommand) != 0, @"V carries Command");
        NSCAssert(CGEventGetFlags((__bridge CGEventRef)paste.lastObject) == 0, @"The final event clears synthesized modifier flags");
        NSArray *enter = VIKeyEvents(36, 0);
        NSCAssert(enter.count == 2 && CGEventGetFlags((__bridge CGEventRef)enter.lastObject) == 0, @"Plain auto-send does not synthesize Command");
        puts("Paste keyboard: 12 regression checks passed");
    }
}
