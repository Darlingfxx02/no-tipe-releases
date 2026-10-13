#import <Foundation/Foundation.h>
extern BOOL VIInsertionConfirmed(NSString *, NSRange, NSString *, NSRange, NSString *);
int main(void) {
    @autoreleasepool {
        NSRange missing = NSMakeRange(NSNotFound, 0);
        NSCAssert(VIInsertionConfirmed(@"Hello ", NSMakeRange(6,0), @"Hello world", NSMakeRange(11,0), @"world"), @"Insertion at cursor");
        NSCAssert(VIInsertionConfirmed(@"Hello old", NSMakeRange(6,3), @"Hello new", NSMakeRange(9,0), @"new"), @"Selection replacement");
        NSCAssert(VIInsertionConfirmed(@"prefix old suffix", missing, @"prefix older suffix", missing, @"older"), @"Replacement sharing a prefix without selection support");
        NSCAssert(VIInsertionConfirmed(@"prefix old suffix", missing, @"prefix bold suffix", missing, @"bold"), @"Replacement sharing a suffix without selection support");
        NSCAssert(VIInsertionConfirmed(@"prefix first\nold suffix", NSMakeRange(7,9), @"prefix first\r\nnew suffix", missing, @"first\nnew"), @"Selection replacement with normalized newlines");
        NSCAssert(VIInsertionConfirmed(@"same", NSMakeRange(0,4), @"same", NSMakeRange(4,0), @"same"), @"Same text replacement needs collapsed selection");
        NSCAssert(!VIInsertionConfirmed(@"same", NSMakeRange(0,4), @"same", NSMakeRange(0,4), @"same"), @"Unchanged selection is not proof");
        NSCAssert(!VIInsertionConfirmed(@"already here", missing, @"already here!", missing, @"already"), @"Existing matching phrase is not proof");
        NSCAssert(!VIInsertionConfirmed(@"new old", missing, @"new other", missing, @"new"), @"Unchanged matching text elsewhere is not proof");
        NSCAssert(VIInsertionConfirmed(@"", missing, @"new\n", missing, @"new"), @"Editor formatting around fresh text remains verifiable");
        NSCAssert(VIInsertionConfirmed(@"prefix suffix", missing, @"prefix fresh suffix", missing, @"fresh "), @"Editors without selection support");
        NSCAssert(VIInsertionConfirmed(@"", missing, @"first\r\nsecond", missing, @"first\nsecond"), @"Newline normalization");
        NSCAssert(VIInsertionConfirmed(@"🙂 ", NSMakeRange(3,0), @"🙂 Привет 🌊", missing, @"Привет 🌊"), @"UTF16 selection with emoji and Cyrillic");
        NSCAssert(!VIInsertionConfirmed(nil, missing, @"text", missing, @"text"), @"Unreadable baseline is unverified");
        NSCAssert(!VIInsertionConfirmed(@"", missing, nil, missing, @"text"), @"Unreadable result is unverified");
        NSCAssert(!VIInsertionConfirmed(@"", missing, @"", missing, @""), @"Empty text is not insertion");
        puts("Paste insertion evidence: 16 checks passed");
    }
}
