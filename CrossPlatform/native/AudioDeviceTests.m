#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
extern BOOL VIInputTransportAllowed(UInt32);
extern char *no_tipe_audio_devices(void);
extern void no_tipe_audio_free(char *);
int main(void) {
    @autoreleasepool {
        NSCAssert(VIInputTransportAllowed(kAudioDeviceTransportTypeBuiltIn), @"Built-in microphone");
        NSCAssert(VIInputTransportAllowed(kAudioDeviceTransportTypeUSB), @"Wired USB microphone");
        NSCAssert(VIInputTransportAllowed(kAudioDeviceTransportTypeVirtual), @"Explicit virtual input");
        NSCAssert(!VIInputTransportAllowed(kAudioDeviceTransportTypeBluetooth), @"Do not activate headset call mode");
        NSCAssert(!VIInputTransportAllowed(kAudioDeviceTransportTypeBluetoothLE), @"Do not activate a wireless headset microphone");
        NSCAssert(!VIInputTransportAllowed(kAudioDeviceTransportTypeContinuityCaptureWired), @"Ignore wired phone microphone");
        NSCAssert(!VIInputTransportAllowed(kAudioDeviceTransportTypeContinuityCaptureWireless), @"Ignore wireless phone microphone");
        NSCAssert(!VIInputTransportAllowed(kAudioDeviceTransportTypeAggregate), @"Aggregate may hide a phone/headset microphone");
        NSCAssert(!VIInputTransportAllowed(kAudioDeviceTransportTypeUnknown), @"Do not open an unclassified input");
        char *json = no_tipe_audio_devices();
        NSCAssert(json, @"Read native device inventory without opening a stream");
        NSDictionary *catalog = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        no_tipe_audio_free(json);
        NSCAssert([catalog[@"devices"] isKindOfClass:NSArray.class] && [catalog[@"blocked"] isKindOfClass:NSArray.class], @"Valid device catalog");
        printf("Audio devices: 11 checks passed; %lu safe inputs, %lu excluded inputs\n", [catalog[@"devices"] count], [catalog[@"blocked"] count]);
    }
}
