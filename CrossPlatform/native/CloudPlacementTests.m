#import <AppKit/AppKit.h>
#import <objc/runtime.h>
extern NSPoint VICloudOrigin(NSRect, NSSize);
typedef struct { double top, cutoutWidth, maximumWidth, displayId, scaleFactor; } VICloudGeometry;
extern NSPoint VINotchOrigin(NSRect, NSSize, CGFloat);
extern VICloudGeometry VINotchGeometry(NSRect, NSRect, CGFloat, CGFloat, CGFloat);
extern BOOL VINotchAllowsPoint(double, double, double, VICloudGeometry);
extern NSInteger VICloudDisplayIndex(const NSRect *, size_t, NSPoint, NSInteger, BOOL);
extern void VIConfigureCloudPlacement(NSWindow *, bool);
typedef struct { double x, y; uint64_t buttons; bool valid; } VICloudPointer;
extern VICloudPointer VICloudPointerAt(NSWindow *, NSPoint, uint64_t, BOOL);
extern BOOL VIApplyCloudHover(NSWindow *, BOOL, BOOL);
typedef struct { double x, y, width, height; } VICloudRect;
typedef struct { double displayX, displayY, x, y; } VICloudPosition;
extern NSPoint VICloudFloatingOrigin(NSRect, NSSize, VICloudPosition, const VICloudRect *, size_t);
extern void no_tipe_present_cloud(void *, bool, const VICloudPosition *, const VICloudRect *, size_t, VICloudGeometry *);
extern bool no_tipe_update_cloud(void *, const VICloudRect *, size_t, bool, bool, bool, const VICloudPosition *, VICloudGeometry *, VICloudPointer *);
@interface VIPlacementTestWindow : NSWindow @end
@implementation VIPlacementTestWindow @end
@interface VIPlacementTestDelegate : NSObject<NSWindowDelegate> @end
@implementation VIPlacementTestDelegate @end
int main(void) {
    // Dragging even a compact recorder reserves its full future expansion.
    NSRect workAreas[] = {NSMakeRect(0, 40, 1512, 910), NSMakeRect(-1920, -1080, 1920, 1040)};
    VICloudRect compact[] = {{202, 317, 196, 63}};
    for (int w = 0; w < 2; w++) for (int x = 0; x <= 2; x++) for (int y = 0; y <= 2; y++) {
        NSRect work = workAreas[w];
        VICloudPosition p = {work.origin.x, work.origin.y, x / 2.0, y / 2.0};
        NSPoint origin = VICloudFloatingOrigin(work, NSMakeSize(600,400), p, compact, 1);
        NSCAssert(origin.x + 40 >= NSMinX(work) + 12 && origin.x + 560 <= NSMaxX(work) - 12, @"Compact recorder reserves the full width at both screen edges");
        NSCAssert(origin.y >= NSMinY(work) + 12 && origin.y + 400 <= NSMaxY(work) - 12, @"Compact recorder reserves full height at top and bottom edges");
        NSCAssert(NSEqualPoints(origin, VICloudFloatingOrigin(work, NSMakeSize(600,400), p, NULL, 0)), @"Startup reserves the same area before hit regions arrive");
        VICloudRect detached[] = {{178, 339, 44, 44}, {378, 339, 44, 44}};
        NSCAssert(NSEqualPoints(origin, VICloudFloatingOrigin(work, NSMakeSize(600,400), p, detached, 2)), @"Detached pixel controls at small recorder scales do not shift the window");
        for (int step = 0; step <= 120; step++) {
            double amount = (step <= 60 ? step : 120 - step) / 60.0;
            double width = 54 + (520 - 54) * amount, height = 37.8 + (360 - 37.8) * amount;
            VICloudRect animated = {300 - width / 2, 380 - height, width, height};
            NSCAssert(NSEqualPoints(origin, VICloudFloatingOrigin(work, NSMakeSize(600,400), p, &animated, 1)), @"Opening and closing animations never move the native window");
        }
    }
    VICloudPosition topLeft = {0, 0, 0, 0};
    VICloudRect expanded[] = {{40, 40, 520, 340}};
    NSPoint closed = VICloudFloatingOrigin(workAreas[0], NSMakeSize(600,400), topLeft, compact, 1);
    NSPoint opened = VICloudFloatingOrigin(workAreas[0], NSMakeSize(600,400), topLeft, expanded, 1);
    NSCAssert(NSEqualPoints(opened, closed), @"Settings open without moving the recorder");
    NSCAssert(NSEqualPoints(closed, VICloudFloatingOrigin(workAreas[0], NSMakeSize(600,400), topLeft, compact, 1)), @"Closing settings restores the chosen position");
    NSCAssert(NSEqualPoints(VICloudOrigin(NSMakeRect(0, 80, 1920, 980), NSMakeSize(600,400)), NSMakePoint(660,84)), @"Respect dock inset");
    NSCAssert(NSEqualPoints(VICloudOrigin(NSMakeRect(-1920, -1080, 1920, 1080), NSMakeSize(600,400)), NSMakePoint(-1260,-1076)), @"Display left/below primary");
    NSCAssert(NSEqualPoints(VICloudOrigin(NSMakeRect(1920, 1080, 1512, 920), NSMakeSize(600,400)), NSMakePoint(2376,1084)), @"Retina uses points, not double-scaled pixels");
    NSRect frame = NSMakeRect(0, 0, 1512, 982), visible = NSMakeRect(0, 40, 1512, 910);
    VICloudGeometry notch = VINotchGeometry(frame, visible, 32, 24, 180);
    NSCAssert(notch.top == 32 && notch.cutoutWidth == 180, @"Hardware cutout safe area");
    VICloudGeometry tallMenu = VINotchGeometry(frame, NSMakeRect(0,40,1512,902),32,40,180);
    NSCAssert(tallMenu.top == 32, @"Physical wings follow the camera, not a taller menu bar");
    NSCAssert(NSEqualPoints(VINotchOrigin(frame, NSMakeSize(600,400),756), NSMakePoint(456,582)), @"Attach at physical screen top");
    NSCAssert(!VINotchAllowsPoint(600, 300, 16, notch), @"Camera exclusion remains click-through");
    NSCAssert(VINotchAllowsPoint(600, 190, 16, notch), @"Left menu wing accepts input");
    NSCAssert(VINotchAllowsPoint(600, 410, 16, notch), @"Right voice wing accepts input");
    NSCAssert(!VINotchAllowsPoint(600, 410, 1, notch), @"Top activation lane stays clear");
    NSCAssert(VINotchAllowsPoint(600, 300, 48, notch), @"Expanded settings below camera accept input");
    VICloudGeometry external = VINotchGeometry(NSMakeRect(-1920,1080,1920,1080),NSMakeRect(-1920,1080,1920,1056),0,24,0);
    NSCAssert(external.top == 0 && external.cutoutWidth == 0, @"Virtual notch attaches to the display edge");
    NSCAssert(!VINotchAllowsPoint(600,300,1,external), @"Virtual notch leaves top activation lane clear");
    NSCAssert(VINotchAllowsPoint(600,300,16,external), @"Virtual notch accepts input below the activation lane");
    VICloudGeometry hidden = VINotchGeometry(frame, frame, 0,24,0);
    NSCAssert(hidden.top == 0, @"Auto-hidden menu does not detach the virtual dock");
    VICloudGeometry narrow = VINotchGeometry(NSMakeRect(0,0,400,900),NSMakeRect(0,0,400,876),0,24,0);
    NSCAssert(narrow.maximumWidth == 376, @"Expanded controls fit portrait monitors");
    VICloudGeometry invalid = VINotchGeometry(frame, visible, 0, 24, 180);
    NSCAssert(invalid.top == 0 && invalid.cutoutWidth == 0, @"Partial camera metrics use the virtual dock");
    NSRect displays[] = {frame, NSMakeRect(-1920,0,1920,1080), NSMakeRect(0,982,1920,1080)};
    NSCAssert(VICloudDisplayIndex(displays,3,NSMakePoint(-500,500),0,NO) == 1, @"Follow pointer to the external display at a negative origin");
    NSCAssert(VICloudDisplayIndex(displays,3,NSMakePoint(500,1500),1,NO) == 2, @"Follow pointer to a display above the laptop");
    NSCAssert(VICloudDisplayIndex(displays,3,NSMakePoint(-500,500),0,YES) == 0, @"Held control stays on the originating display");
    NSCAssert(VICloudDisplayIndex(displays,3,NSMakePoint(-500,500),3,YES) == 1, @"Disconnected display does not pin the recorder");
    NSCAssert(VICloudDisplayIndex(displays,3,NSMakePoint(5000,5000),1,NO) == 1, @"Desktop gaps retain the current display");
    NSCAssert(VICloudDisplayIndex(NULL,0,NSZeroPoint,-1,NO) == -1, @"No display is handled safely");
    @autoreleasepool {
        [NSApplication sharedApplication];
        // Hidden native fixtures exercise the real AppKit clamp, not just our
        // coordinate arithmetic. No windows are ordered on screen.
        for (NSScreen *screen in NSScreen.screens) {
            NSRect requested = NSMakeRect(NSMidX(screen.frame)-300, NSMaxY(screen.frame)-400,600,400);
            VIPlacementTestWindow *window = [[VIPlacementTestWindow alloc] initWithContentRect:requested styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
            VIPlacementTestWindow *other = [[VIPlacementTestWindow alloc] initWithContentRect:requested styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
            NSView *content = window.contentView;
            VIPlacementTestDelegate *delegate = [VIPlacementTestDelegate new];
            window.delegate = delegate;
            NSRect original = [window constrainFrameRect:requested toScreen:screen];
            VIConfigureCloudPlacement(window, true);
            NSCAssert([window isKindOfClass:NSPanel.class], @"Recorder uses panel activation policy");
            NSCAssert(window.styleMask & NSWindowStyleMaskNonactivatingPanel, @"Recorder clicks do not activate its application");
            NSCAssert(!window.canBecomeKeyWindow && !window.canBecomeMainWindow, @"Recorder preserves the active text field in another application");
            NSCAssert(window.contentView == content && window.delegate == delegate, @"Conversion preserves the webview and Tao delegate");
            NSCAssert(object_getClass(other) == VIPlacementTestWindow.class, @"Main and other windows retain their original class");
            NSCAssert(NSEqualRects([window constrainFrameRect:requested toScreen:screen],requested), @"Notch is not pushed below the menu bar");
            [window setFrameOrigin:requested.origin];
            NSCAssert(NSEqualRects(window.frame,requested), @"Actual window reaches the physical top edge");
            NSCAssert(NSEqualRects([other constrainFrameRect:requested toScreen:screen],original), @"Other windows keep AppKit constraints");
            NSCAssert(window.level == NSStatusWindowLevel, @"Wings render above the menu-bar backing");
            VIConfigureCloudPlacement(window, false);
            NSCAssert([window isKindOfClass:NSPanel.class] && (window.styleMask & NSWindowStyleMaskNonactivatingPanel), @"Repeated placement and island switches stay nonactivating");
            NSCAssert(NSEqualRects([window constrainFrameRect:requested toScreen:screen],original), @"Switching back restores bottom-island constraints");
            NSCAssert(window.level == NSFloatingWindowLevel, @"Bottom island returns to its original level");
            // Passive cursor samples must reach the renderer without enabling
            // mouse interception or making the recorder the active window.
            window.ignoresMouseEvents = YES;
            NSPoint pointer = [window convertPointToScreen:NSMakePoint(312, 375)];
            VICloudPointer sample = VICloudPointerAt(window, pointer, 0, YES);
            NSCAssert(sample.valid && sample.x == 312 && sample.y == 25, @"Native pointer uses top-left logical coordinates on every display");
            NSCAssert(window.ignoresMouseEvents && !window.canBecomeKeyWindow, @"Passive sampling preserves click-through and keyboard focus");
            NSCAssert(VICloudPointerAt(window, pointer, 1, YES).buttons == 1, @"Held mouse buttons are reported, so clicks are not petting");
            NSCAssert(!VICloudPointerAt(window, pointer, 0, NO).valid, @"Display transitions invalidate a stroke");
            NSCAssert(!VICloudPointerAt(window, [window convertPointToScreen:NSMakePoint(-1, 375)], 0, YES).valid, @"Pointers outside the webview are rejected");
            NSCAssert(!VIApplyCloudHover(window, YES, NO) && !window.ignoresMouseEvents && window.alphaValue == 1, @"Default mode keeps recorder controls visible and clickable");
            NSCAssert(!VIApplyCloudHover(window, NO, YES) && window.ignoresMouseEvents && window.alphaValue == 1, @"Hover mode passes clicks through before the cursor enters");
            for (int i = 0; i < 20; i++) {
                NSCAssert(VIApplyCloudHover(window, YES, YES) && window.ignoresMouseEvents && window.alphaValue == 1, @"Hover disables clicks before fading, without cutting off the webview transition");
            }
            NSCAssert(!VIApplyCloudHover(window, NO, YES) && window.ignoresMouseEvents && window.alphaValue == 1, @"Leaving starts the reveal without intercepting clicks during the fade");
            VIApplyCloudHover(window, YES, YES);
            NSCAssert(!VIApplyCloudHover(window, YES, NO) && !window.ignoresMouseEvents && window.alphaValue == 1, @"Disabling while hovered restores opacity and controls");
            NSCAssert(!window.canBecomeKeyWindow && !window.visible, @"Hover changes preserve focus policy and native visibility");
            // Exercise the installed app's placement entry points as well as
            // the arithmetic. This fixture is transparent and never activates.
            VICloudPosition floating = {screen.frame.origin.x, screen.frame.origin.y, 0, 0};
            VICloudGeometry geometry;
            no_tipe_present_cloud((__bridge void *)window, false, &floating, compact, 1, &geometry);
            NSPoint expected = VICloudFloatingOrigin(screen.visibleFrame, window.frame.size, floating, compact, 1);
            NSCAssert(NSEqualPoints(window.frame.origin, expected), @"Floating controls reach top-left without AppKit clamping the transparent webview");
            no_tipe_update_cloud((__bridge void *)window, compact, 1, false, false, false, &floating, &geometry, &sample);
            NSCAssert(NSEqualPoints(window.frame.origin, expected), @"Following the mouse does not reset a floating position");
            no_tipe_update_cloud((__bridge void *)window, expanded, 1, false, false, false, &floating, &geometry, &sample);
            NSCAssert(NSEqualPoints(window.frame.origin, expected), @"Expanding native controls keeps exactly the same window origin");
            no_tipe_update_cloud((__bridge void *)window, compact, 1, false, false, false, &floating, &geometry, &sample);
            NSCAssert(NSEqualPoints(window.frame.origin, expected), @"Closing controls restores the saved native position");
            NSCAssert(!window.canBecomeKeyWindow && !window.canBecomeMainWindow, @"Moving keeps the active text field in another app");
            [window orderOut:nil];
        }
    }
    puts("Cloud placement: geometry, hit testing, panel activation and native window constraints passed");
}
