#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <objc/message.h>

static char vi_notch_placement, vi_original_cloud_class, vi_cloud_activation_guard;

// Replace only the recorder's TaoWindow with an NSPanel, retaining its webview
// and delegate. Do not subclass TaoWindow: its sendEvent: dispatches to the
// runtime superclass, which would recurse. NSPanel adds no NSWindow storage.
@interface VICloudPanel : NSPanel
@end
@implementation VICloudPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
- (NSRect)constrainFrameRect:(NSRect)frame toScreen:(NSScreen *)screen {
    if ([objc_getAssociatedObject(self, &vi_notch_placement) boolValue]) return frame;
    return [super constrainFrameRect:frame toScreen:screen];
}
- (void)dealloc {
    // AppKit may have registered KVO on the original class during window
    // creation. Restore that class before its teardown removes the observers.
    // This file uses manual reference counting so it can dispatch exactly once
    // to the original dealloc instead of ARC adding an NSPanel super call.
    Class original = objc_getAssociatedObject(self, &vi_original_cloud_class);
    if (original) {
        object_setClass(self, original);
        void (*destroy)(id, SEL) = (void *)class_getMethodImplementation(original, @selector(dealloc));
        destroy(self, @selector(dealloc));
    } else {
        [super dealloc];
    }
}
@end

void VIConfigureCloudInteraction(NSWindow *window) {
    if (![window isKindOfClass:VICloudPanel.class]) {
        Class original = object_getClass(window);
        if (class_getInstanceSize(VICloudPanel.class) > class_getInstanceSize(original)) {
            [NSException raise:NSInternalInconsistencyException format:@"Recorder panel layout exceeds its window allocation"];
        }
        objc_setAssociatedObject(window, &vi_original_cloud_class, original, OBJC_ASSOCIATION_ASSIGN);
        object_setClass(window, VICloudPanel.class);
    }
    BOOL styleChanged = !(window.styleMask & NSWindowStyleMaskNonactivatingPanel);
    if (!styleChanged && [objc_getAssociatedObject(window, &vi_cloud_activation_guard) boolValue]) return;
    window.styleMask |= NSWindowStyleMaskNonactivatingPanel;
    NSPanel *panel = (NSPanel *)window;
    panel.floatingPanel = YES;
    panel.becomesKeyOnlyIfNeeded = YES;
    // Converting Tao's already-created NSWindow does not run NSPanel's
    // initializer. Setting the style mask alone leaves WindowServer activation
    // enabled, including on macOS 27. Synchronize that state for this panel only.
    // https://github.com/electron/electron/issues/53889
    SEL preventActivation = NSSelectorFromString(@"_setPreventsActivation:");
    if ([panel respondsToSelector:preventActivation]) {
        ((void (*)(id, SEL, BOOL))objc_msgSend)(panel, preventActivation, YES);
        objc_setAssociatedObject(window, &vi_cloud_activation_guard, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
}

void VISetCloudNotchPlacement(NSWindow *window, bool notch) {
    objc_setAssociatedObject(window, &vi_notch_placement, @(notch), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
