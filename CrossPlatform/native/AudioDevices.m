#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>

// Inspect devices without opening a microphone, changing the system default,
// or touching the output stream. Bluetooth input opens a headset call profile;
// Continuity input activates the phone. Neither is used for dictation.
BOOL VIInputTransportAllowed(UInt32 transport) {
    switch (transport) {
        case kAudioDeviceTransportTypeBuiltIn:
        case kAudioDeviceTransportTypeUSB:
        case kAudioDeviceTransportTypeFireWire:
        case kAudioDeviceTransportTypePCI:
        case kAudioDeviceTransportTypeThunderbolt:
        case kAudioDeviceTransportTypeDisplayPort:
        case kAudioDeviceTransportTypeHDMI:
        case kAudioDeviceTransportTypeVirtual:
            return YES;
        default:
            // Aggregates can hide a Bluetooth/phone input. Unknown transports
            // are also excluded rather than opening them speculatively.
            return NO;
    }
}
static UInt32 VIUIntProperty(AudioObjectID object, AudioObjectPropertySelector selector) {
    AudioObjectPropertyAddress address = {selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 value = 0, size = sizeof(value);
    AudioObjectGetPropertyData(object, &address, 0, NULL, &size, &value);
    return value;
}
static NSString *VIName(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    CFStringRef name = NULL;
    UInt32 size = sizeof(name);
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &name) != noErr) return nil;
    return CFBridgingRelease(name);
}
static BOOL VIHasInput(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput, kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || !size) return NO;
    AudioBufferList *list = calloc(1, size);
    if (!list) return NO;
    BOOL hasInput = NO;
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, list) == noErr) {
        for (UInt32 i = 0; i < list->mNumberBuffers; i++) hasInput |= list->mBuffers[i].mNumberChannels > 0;
    }
    free(list);
    return hasInput;
}
char *no_tipe_audio_devices(void) {
    @autoreleasepool {
        AudioObjectPropertyAddress address = {kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
        UInt32 size = 0;
        if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr) return NULL;
        AudioDeviceID *ids = calloc(1, MAX(size, sizeof(AudioDeviceID)));
        if (!ids) return NULL;
        if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, ids) != noErr) { free(ids); return NULL; }
        AudioDeviceID systemDefault = VIUIntProperty(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultInputDevice);
        NSMutableArray *devices = [NSMutableArray new], *blocked = [NSMutableArray new];
        NSString *defaultName = nil, *builtInName = nil;
        for (UInt32 i = 0; i < size / sizeof(AudioDeviceID); i++) {
            if (!VIHasInput(ids[i])) continue;
            NSString *name = VIName(ids[i]);
            if (!name.length) continue;
            UInt32 transport = VIUIntProperty(ids[i], kAudioDevicePropertyTransportType);
            if (!VIInputTransportAllowed(transport)) { [blocked addObject:name]; continue; }
            if (ids[i] == systemDefault) defaultName = name;
            if (transport == kAudioDeviceTransportTypeBuiltIn && !builtInName) builtInName = name;
            [devices addObject:[@{@"id":name, @"name":name, @"default":@NO} mutableCopy]];
        }
        free(ids);
        defaultName = defaultName ?: builtInName ?: [devices.firstObject objectForKey:@"name"];
        for (NSMutableDictionary *device in devices) device[@"default"] = @([device[@"name"] isEqual:defaultName]);
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"devices":devices, @"blocked":blocked} options:0 error:nil];
        return data ? strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String) : NULL;
    }
}
void no_tipe_audio_free(char *value) { free(value); }
