#import <AppKit/AppKit.h>

// Decode the shipped bytes directly: NSWorkspace and named-image lookups may
// still resolve a cached icon after a same-path application replacement.
bool no_tipe_set_application_icon(const unsigned char *bytes, size_t length) {
    if (!NSThread.isMainThread || !bytes || !length) return false;
    NSData *data = [NSData dataWithBytes:bytes length:length];
    NSImage *image = [[NSImage alloc] initWithData:data];
    if (!image.isValid) return false;
    NSApplication *application = NSApplication.sharedApplication;
    application.applicationIconImage = image;
    [application.dockTile display];
    return application.applicationIconImage == image;
}
