#import <Foundation/Foundation.h>
#include <dlfcn.h>

// Same explicit Pause command used by the original app's MediaRemoteAdapter.
// Resolve at runtime: an unavailable OS service must never prevent recording.
bool no_tipe_media_command(bool play) {
    typedef Boolean (*SendCommand)(int, CFDictionaryRef);
    static SendCommand send;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        void *framework = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_LAZY);
        if (framework) send = (SendCommand)dlsym(framework, "MRMediaRemoteSendCommand");
    });
    // kMRPlay = 0, kMRPause = 1. Ownership is verified by the Rust session.
    return send ? send(play ? 0 : 1, NULL) : false;
}
