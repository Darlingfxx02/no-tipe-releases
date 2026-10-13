#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <objc/runtime.h>

// These calls intentionally run in the application, not the inference helper:
// macOS must grant microphone access to the process that opens the audio device.
int no_tipe_microphone_status(void) {
    return (int)[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
}
bool no_tipe_accessibility_status(void) { return AXIsProcessTrusted(); }
void no_tipe_request_microphone(void) {
    if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusNotDetermined) {
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) { (void)granted; }];
    } else {
        [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"]];
    }
}
void no_tipe_request_accessibility(void) {
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]];
}

NSPoint VICloudOrigin(NSRect visible, NSSize size) {
    return NSMakePoint(NSMidX(visible) - size.width / 2, NSMinY(visible) + 4);
}
typedef struct { double top, cutoutWidth, maximumWidth, displayId, scaleFactor; } VICloudGeometry;
typedef struct { double x, y, width, height; } VICloudRect;
typedef struct { double displayX, displayY, x, y; } VICloudPosition;
static char vi_cloud_display;

extern void VIConfigureCloudInteraction(NSWindow *window);
extern void VISetCloudNotchPlacement(NSWindow *window, bool notch);

void VIConfigureCloudPlacement(NSWindow *window, bool notch) {
    VIConfigureCloudInteraction(window);
    // AppKit clamps even borderless windows below the menu bar. Only the top
    // recorder opts out; other Tao windows and the bottom island retain their
    // original constraint. VICloudPanel limits the override to this recorder.
    VISetCloudNotchPlacement(window, notch);
    // The wings must be visible beside the camera, above the menu-bar backing.
    // System pop-up menus remain above this level; transparent areas stay
    // click-through through the existing per-region hit test.
    NSInteger level = notch ? NSStatusWindowLevel : NSFloatingWindowLevel;
    if (window.level != level) window.level = level;
}

NSPoint VINotchOrigin(NSRect frame, NSSize size, CGFloat center) {
    return NSMakePoint(center - size.width / 2, NSMaxY(frame) - size.height);
}
VICloudGeometry VINotchGeometry(NSRect frame, NSRect visible, CGFloat safeTop, CGFloat menuHeight, CGFloat cutoutWidth) {
    (void)menuHeight;
    // A menu bar is not evidence of a camera housing. The renderer supplies
    // its own virtual dock when the physical metrics are zero.
    BOOL hardware = cutoutWidth > 0 && safeTop > 0;
    return (VICloudGeometry){hardware ? safeTop : 0, hardware ? cutoutWidth : 0,
        MIN(560, MAX(1, MIN(frame.size.width, visible.size.width) - 24)), 0, 1};
}
BOOL VINotchAllowsPoint(double windowWidth, double x, double y, VICloudGeometry geometry) {
    if (geometry.cutoutWidth <= 0) return y >= 2;
    return y >= 2 && !(y < geometry.top && fabs(x - windowWidth / 2) < geometry.cutoutWidth / 2);
}
NSInteger VICloudDisplayIndex(const NSRect *frames, size_t count, NSPoint cursor, NSInteger current, BOOL holding) {
    BOOL valid = current >= 0 && (size_t)current < count;
    if (holding && valid) return current;
    for (size_t i = 0; i < count; i++) if (NSPointInRect(cursor, frames[i])) return (NSInteger)i;
    return valid ? current : count ? 0 : -1;
}
static CGFloat VIFitCloud(CGFloat value, CGFloat low, CGFloat high) {
    return low <= high ? MIN(high, MAX(low, value)) : (low + high) / 2;
}
NSPoint VICloudFloatingOrigin(NSRect visible, NSSize size, VICloudPosition position, const VICloudRect *regions, size_t count) {
    // Reserve the maximum layout width (520) and full renderer height (400)
    // inside the 600 × 400 webview, including detached controls at small scales.
    // Dictation/settings and their animation must fit even while compact without
    // moving the native window as hit regions grow. Match recorder_position.rs.
    // Keep room for unexpected larger content without weakening this minimum.
    double left = 40, top = 0, right = 560, bottom = 400;
    for (size_t i = 0; i < count; i++) {
        left = MIN(left, regions[i].x); top = MIN(top, regions[i].y);
        right = MAX(right, regions[i].x + regions[i].width); bottom = MAX(bottom, regions[i].y + regions[i].height);
    }
    return NSMakePoint(
        VIFitCloud(NSMinX(visible) + position.x * visible.size.width - size.width / 2,
            NSMinX(visible) + 12 - left, NSMaxX(visible) - right - 12),
        VIFitCloud(NSMaxY(visible) - position.y * visible.size.height - (size.height - 348.5),
            NSMinY(visible) + 12 - (size.height - bottom), NSMaxY(visible) - (size.height - top) - 12));
}
bool no_tipe_cloud_drag_position(void *pointer, double x, double y, VICloudPosition *position) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    NSPoint cursor = NSEvent.mouseLocation;
    NSScreen *screen = nil;
    for (NSScreen *candidate in NSScreen.screens) if (NSPointInRect(cursor, candidate.frame)) { screen = candidate; break; }
    if (!screen) screen = window.screen ?: NSScreen.mainScreen;
    if (!screen) return false;
    NSRect work = screen.visibleFrame;
    *position = (VICloudPosition){screen.frame.origin.x, screen.frame.origin.y,
        MIN(1, MAX(0, (cursor.x + window.frame.size.width / 2 - x - NSMinX(work)) / work.size.width)),
        MIN(1, MAX(0, (NSMaxY(work) - cursor.y + 348.5 - y) / work.size.height))};
    return true;
}
static BOOL VIFollowCursor(NSWindow *window, bool notch, const VICloudPosition *position, const VICloudRect *regions, size_t count, VICloudGeometry *geometry) {
    VIConfigureCloudPlacement(window, notch);
    // A floating widget may place the transparent part of its window outside
    // the screen. Clamp the visible controls ourselves instead of AppKit
    // pushing the entire 600 × 400 webview below the menu bar.
    if (position && !notch) VISetCloudNotchPlacement(window, true);
    NSArray<NSScreen *> *screens = NSScreen.screens;
    if (!screens.count) return NO;
    NSPoint cursor = NSEvent.mouseLocation;
    NSNumber *previousDisplay = objc_getAssociatedObject(window, &vi_cloud_display);
    NSInteger current = -1;
    NSRect frames[screens.count];
    for (NSUInteger i = 0; i < screens.count; i++) {
        frames[i] = screens[i].frame;
        if (previousDisplay && [screens[i].deviceDescription[@"NSScreenNumber"] isEqual:previousDisplay]) current = (NSInteger)i;
    }
    if (current < 0 && [screens containsObject:window.screen]) current = (NSInteger)[screens indexOfObject:window.screen];
    NSScreen *screen = screens[VICloudDisplayIndex(frames, screens.count, cursor, current, NSEvent.pressedMouseButtons != 0)];
    if (position && !notch) {
        screen = screens[0]; // A disconnected display falls back to one reachable display.
        for (NSScreen *candidate in screens) {
            if (candidate.frame.origin.x == position->displayX && candidate.frame.origin.y == position->displayY) { screen = candidate; break; }
        }
    }
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    BOOL changedDisplay = ![previousDisplay isEqual:display];
    objc_setAssociatedObject(window, &vi_cloud_display, display, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSPoint origin;
    if (notch) {
        CGFloat safeTop = 0, cutoutWidth = 0, center = NSMidX(screen.frame);
        if (@available(macOS 12.0, *)) {
            safeTop = screen.safeAreaInsets.top;
            NSRect left = screen.auxiliaryTopLeftArea, right = screen.auxiliaryTopRightArea;
            if (safeTop > 0 && !NSIsEmptyRect(left) && !NSIsEmptyRect(right)) {
                cutoutWidth = MAX(0, NSMinX(right) - NSMaxX(left));
                center = (NSMinX(right) + NSMaxX(left)) / 2;
            }
        }
        *geometry = VINotchGeometry(screen.frame, screen.visibleFrame, safeTop, NSStatusBar.systemStatusBar.thickness, cutoutWidth);
        origin = VINotchOrigin(screen.frame, window.frame.size, center);
    } else {
        *geometry = (VICloudGeometry){0, 0, MIN(560, MAX(1, screen.visibleFrame.size.width - 24)), 0, 1};
        origin = position ? VICloudFloatingOrigin(screen.visibleFrame, window.frame.size, *position, regions, count)
            : VICloudOrigin(screen.visibleFrame, window.frame.size);
    }
    geometry->displayId = display.doubleValue;
    geometry->scaleFactor = screen.backingScaleFactor;
    BOOL moved = !NSEqualPoints(window.frame.origin, origin);
    if (moved) [window setFrameOrigin:origin];
    return moved || changedDisplay;
}
void no_tipe_present_cloud(void *pointer, bool notch, const VICloudPosition *position, const VICloudRect *regions, size_t count, VICloudGeometry *geometry) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    window.canHide = NO;
    window.hidesOnDeactivate = NO;
    // FullScreenAuxiliary alone only associates a regular NSWindow with its
    // own application's full-screen group. This overlay also belongs above
    // other apps' full-screen Spaces (and their Stage Manager sets).
    // https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehaviorFullScreenAuxiliary
        | NSWindowCollectionBehaviorCanJoinAllApplications;
    window.backgroundColor = NSColor.clearColor;
    window.opaque = NO;
    VIFollowCursor(window, notch, position, regions, count, geometry);
    window.ignoresMouseEvents = YES;
    [window orderFrontRegardless];
}

typedef struct { double x, y; uint64_t buttons; bool valid; } VICloudPointer;
VICloudPointer VICloudPointerAt(NSWindow *window, NSPoint screenPoint, uint64_t buttons, BOOL allowed) {
    NSPoint local = [window convertPointFromScreen:screenPoint];
    NSSize size = window.contentView.bounds.size;
    // WebKit uses logical points with a top-left origin, including on Retina.
    return (VICloudPointer){local.x, size.height-local.y, buttons,
        allowed && local.x >= 0 && local.x <= size.width && local.y >= 0 && local.y <= size.height};
}
// Leave the panel ordered so passive cursor sampling can reveal it again.
// Click-through is enabled for the whole mode, before the first hover sample.
// The webview animates opacity; native alpha must stay untouched so it cannot
// cut off that fade. Input is disabled synchronously, before the renderer hears
// about the hover, and stays disabled throughout either transition.
BOOL VIApplyCloudHover(NSWindow *window, BOOL inside, BOOL hideOnHover) {
    BOOL hidden = hideOnHover && inside;
    window.ignoresMouseEvents = hideOnHover || !inside;
    return hidden;
}
bool no_tipe_update_cloud(void *pointer, const VICloudRect *regions, size_t count, bool notch, bool hideOnHover, bool dragging, const VICloudPosition *position, VICloudGeometry *geometry, VICloudPointer *sample) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    if (!window.visible) return false;
    BOOL moved = VIFollowCursor(window, notch, position, regions, count, geometry);
    *sample = VICloudPointerAt(window, NSEvent.mouseLocation, NSEvent.pressedMouseButtons, !moved);
    double x = sample->x, y = sample->y;
    BOOL inside = NO;
    // With a physical cutout, the controls occupy the two wings beside it.
    // Keep the camera and the top activation lane excluded during transitions.
    BOOL allowed = (!notch || !moved) && (!notch || VINotchAllowsPoint(window.contentView.bounds.size.width, x, y, *geometry));
    sample->valid = sample->valid && allowed;
    if (allowed) for (size_t i = 0; i < count; i++) {
        VICloudRect r = regions[i];
        if (x >= r.x && x <= r.x+r.width && y >= r.y && y <= r.y+r.height) { inside = YES; break; }
    }
    BOOL hidden = VIApplyCloudHover(window, inside, hideOnHover);
    if (dragging && (sample->buttons & 1)) window.ignoresMouseEvents = NO;
    if (hidden) sample->valid = false;
    return hidden;
}

typedef bool (*NoTipeModifierCallback)(unsigned short, unsigned long long, bool);
static id vi_local_monitor, vi_global_monitor;
void no_tipe_monitor_modifiers(NoTipeModifierCallback callback) {
    if (vi_local_monitor) [NSEvent removeMonitor:vi_local_monitor];
    if (vi_global_monitor) [NSEvent removeMonitor:vi_global_monitor];
    NSEventMask mask = NSEventMaskFlagsChanged | NSEventMaskKeyDown;
    BOOL (^receive)(NSEvent *) = ^BOOL(NSEvent *event) {
        return callback(event.keyCode, event.modifierFlags, event.type == NSEventTypeFlagsChanged);
    };
    vi_local_monitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) { return receive(event) ? nil : event; }];
    vi_global_monitor = [NSEvent addGlobalMonitorForEventsMatchingMask:mask handler:^(NSEvent *event) { receive(event); }];
}
