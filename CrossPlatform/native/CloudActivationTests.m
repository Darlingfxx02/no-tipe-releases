#import <AppKit/AppKit.h>
#import <objc/message.h>

extern void VIConfigureCloudInteraction(NSWindow *);

// Inspect AppKit's activation policy on hidden fixtures. Checking only the
// NSPanel class/style mask missed the regression on macOS 27.
static BOOL PreventsActivation(NSWindow *window) {
    SEL getter = NSSelectorFromString(@"_preventsActivation");
    NSCAssert([window respondsToSelector:getter], @"Native activation diagnostics unavailable");
    return ((BOOL (*)(id, SEL))objc_msgSend)(window, getter);
}

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        NSRect frame = NSMakeRect(0, 0, 600, 400);
        NSWindow *cloud = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        NSWindow *main = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        NSCAssert(!PreventsActivation(cloud), @"Fixture starts as an activating window");
        VIConfigureCloudInteraction(cloud);
        NSCAssert(PreventsActivation(cloud), @"Recorder's native policy prevents application activation");
        NSCAssert(!cloud.canBecomeKeyWindow && !cloud.canBecomeMainWindow, @"Recorder cannot steal the active input field");
        NSCAssert(!PreventsActivation(main), @"Main window retains normal tray-open activation");
        NSInteger number = cloud.windowNumber;
        for (int i = 0; i < 50; i++) VIConfigureCloudInteraction(cloud);
        NSCAssert(cloud.windowNumber == number && PreventsActivation(cloud), @"Repeated updates preserve the same nonactivating window");
        cloud.styleMask &= ~NSWindowStyleMaskNonactivatingPanel;
        ((void (*)(id, SEL, BOOL))objc_msgSend)(cloud, NSSelectorFromString(@"_setPreventsActivation:"), NO);
        VIConfigureCloudInteraction(cloud);
        NSCAssert(PreventsActivation(cloud), @"Reapplying the panel style also repairs native activation");
        NSCAssert(!cloud.visible && !main.visible, @"Native regression checks never order windows on screen");
        puts("Cloud activation: 7 native activation-policy regression checks passed");
    }
}
