#import "Paste.m"

@interface VITestTarget : VIPasteTarget
@property(nonatomic, copy) NSString *contents;
@property(nonatomic) NSRange selectedRange;
@property(nonatomic) BOOL focused, supportsDirect, selectionUnavailable;
@property(nonatomic) int setterCalls;
@end
@implementation VITestTarget
- (NSString *)value { return self.contents; }
- (NSRange)selection { return self.selectionUnavailable ? NSMakeRange(NSNotFound, 0) : self.selectedRange; }
- (BOOL)isFocused { return self.focused; }
- (BOOL)insertText:(NSString *)text {
    // Reproduce an AX setter reporting success without changing a web editor.
    self.setterCalls++;
    return self.supportsDirect;
}
@end
@interface VITestJob : VIPasteJob
@property(nonatomic, strong) VITestTarget *current;
@property(nonatomic, strong) VITestTarget *fallbackTarget;
@property(nonatomic, strong) NSPasteboard *board;
@property(nonatomic) BOOL moveFocusAfterInsertion, copyDuringPaste, ignorePaste;
@property(nonatomic) BOOL destinationChanged, changeDestinationDuringCopy;
@property(nonatomic, copy) NSString *captureFailureReason;
@property(nonatomic) int posts, heldChecks, captureMisses;
@property(nonatomic, copy) NSDictionary *outcome;
@end
@implementation VITestJob
- (NSPasteboard *)pasteboard { return self.board; }
- (VIPasteTarget *)captureTarget {
    if (self.captureMisses-- > 0) { self.captureReason = @"focusUnavailable"; return nil; }
    self.captureReason = self.captureFailureReason ?: @"noEditableField";
    return self.current;
}
- (BOOL)capturedDestinationIsActive { return !self.destinationChanged; }
- (BOOL)modifiersHeld { return self.heldChecks-- > 0; }
- (NSString *)clipboardBundleIdentifier { if (self.changeDestinationDuringCopy) self.destinationChanged = YES; return @"com.apple.TextEdit"; }
- (BOOL)postPasteShortcut {
    self.posts++;
    if (self.ignorePaste) return YES;
    VITestTarget *receiver = self.current ?: self.fallbackTarget;
    receiver.contents = [receiver.contents stringByReplacingCharactersInRange:receiver.selectedRange withString:self.text];
    receiver.selectedRange = NSMakeRange(receiver.selectedRange.location + self.text.length, 0);
    if (self.moveFocusAfterInsertion) self.current.focused = NO;
    if (self.copyDuringPaste) { [self.board clearContents]; [self.board setString:@"new user copy" forType:NSPasteboardTypeString]; }
    return YES;
}
@end
static VITestTarget *Target(NSString *text, BOOL direct) {
    VITestTarget *target = [VITestTarget new];
    target.contents = text; target.selectedRange = NSMakeRange(text.length, 0);
    target.focused = YES; target.supportsDirect = direct;
    return target;
}
static VITestJob *Job(VITestTarget *target, NSPasteboard *board) {
    VITestJob *job = [VITestJob new];
    job.current = target; job.board = board; job.text = @" dictated";
    job.options = @{@"restore":@YES, @"autoSend":@"none", @"delay":@1500};
    __weak VITestJob *weak = job;
    job.complete = ^(NSDictionary *outcome) { weak.outcome = outcome; };
    return job;
}
static void Await(VITestJob *job) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
    while (!job.outcome && deadline.timeIntervalSinceNow > 0)
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];
    NSCAssert(job.outcome, @"Delivery timed out");
}
int main(void) {
    @autoreleasepool {
        // Use a private board: regression checks never alter the user's copy.
        NSPasteboard *board = [NSPasteboard pasteboardWithUniqueName];
        [board setString:@"original copy" forType:NSPasteboardTypeString];
        [board setData:[@"rich format" dataUsingEncoding:NSUTF8StringEncoding] forType:NSPasteboardTypeRTF];
        VITestTarget *first = Target(@"first", YES), *second = Target(@"second", YES);
        VITestJob *active = Job(second, board);
        active.target = first; // The obsolete recording-time field.
        [active begin]; Await(active);
        NSCAssert([first.contents isEqual:@"first"] && [second.contents isEqual:@"second dictated"], @"Use the currently active field");
        NSCAssert([active.outcome[@"result"] isEqual:@"inserted"] && active.posts == 1, @"Verified insertion uses one Cmd+V");
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"]
            && [[board dataForType:NSPasteboardTypeRTF] isEqual:[@"rich format" dataUsingEncoding:NSUTF8StringEncoding]], @"Restore the original clipboard after active-field insertion");
        NSCAssert(!second.webEditor && second.setterCalls == 0
            && [active.outcome[@"diagnostics"][@"pastePosted"] boolValue], @"An editor without AXWebArea bypasses the silent no-op AX setter");

        VITestTarget *lateSelection = Target(@"prefix old suffix", YES);
        VITestJob *replace = Job(lateSelection, board);
        replace.text = @"older"; replace.heldChecks = 1;
        [replace begin];
        lateSelection.selectedRange = NSMakeRange(7, 3); // Selected after recording/shortcut began.
        Await(replace);
        NSCAssert([lateSelection.contents isEqual:@"prefix older suffix"] && replace.posts == 1
            && [replace.outcome[@"result"] isEqual:@"inserted"], @"Late selection replacement reports inserted");
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"], @"Replacement restores the clipboard");

        VITestTarget *missingRange = Target(@"prefix old suffix", YES);
        missingRange.selectedRange = NSMakeRange(7, 3); missingRange.selectionUnavailable = YES;
        VITestJob *opaqueReplacement = Job(missingRange, board); opaqueReplacement.text = @"bold";
        [opaqueReplacement begin]; Await(opaqueReplacement);
        NSCAssert([missingRange.contents isEqual:@"prefix bold suffix"] && opaqueReplacement.posts == 1
            && [opaqueReplacement.outcome[@"result"] isEqual:@"inserted"], @"Shared suffix replacement without AX selection reports inserted");

        VITestTarget *identical = Target(@"same", YES); identical.selectedRange = NSMakeRange(0, 4);
        VITestJob *identicalReplacement = Job(identical, board); identicalReplacement.text = @"same";
        [identicalReplacement begin]; Await(identicalReplacement);
        NSCAssert([identical.contents isEqual:@"same"] && identical.selectedRange.length == 0
            && [identicalReplacement.outcome[@"result"] isEqual:@"inserted"], @"Identical selected text is a verified replacement");

        VITestJob *compatibility = Job(Target(@"web", NO), board);
        [compatibility begin]; Await(compatibility);
        NSCAssert([compatibility.outcome[@"result"] isEqual:@"inserted"] && compatibility.posts == 1, @"One compatibility paste");
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"]
            && [[board dataForType:NSPasteboardTypeRTF] isEqual:[@"rich format" dataUsingEncoding:NSUTF8StringEncoding]], @"Restore every clipboard format before completion");

        VITestTarget *web = Target(@"browser", YES);
        web.webEditor = YES; // A browser can advertise a writable AXSelectedText setter.
        VITestJob *webPaste = Job(web, board);
        [webPaste begin]; Await(webPaste);
        NSCAssert([webPaste.outcome[@"result"] isEqual:@"inserted"] && webPaste.posts == 1
            && [web.contents isEqual:@"browser dictated"], @"Web editors use one normal paste even when AX claims direct insertion support");
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"], @"Verified browser insertion restores the clipboard");

        VITestJob *changedFocus = Job(Target(@"web", NO), board);
        changedFocus.moveFocusAfterInsertion = YES;
        [changedFocus begin]; Await(changedFocus);
        NSCAssert([changedFocus.outcome[@"result"] isEqual:@"inserted"]
            && [[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"], @"Focus change after insertion still restores the clipboard");

        VITestJob *newCopy = Job(Target(@"web", NO), board);
        newCopy.copyDuringPaste = YES;
        [newCopy begin]; Await(newCopy);
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@"new user copy"], @"Never overwrite a newer copy");

        VITestJob *waiting = Job(first, board);
        waiting.heldChecks = 2;
        [waiting begin]; waiting.current = second; Await(waiting);
        NSCAssert([second.contents isEqual:@"second dictated dictated"] && [first.contents isEqual:@"first"], @"Capture focus after shortcut release");

        VITestJob *noField = Job(nil, board);
        [noField begin]; Await(noField);
        NSCAssert([noField.outcome[@"result"] isEqual:@"clipboardOnly"] && noField.posts == 0
            && [[board stringForType:NSPasteboardTypeString] isEqual:@" dictated"], @"No field keeps a manual-paste fallback");

        VITestJob *opaqueEditor = Job(nil, board);
        opaqueEditor.captureFailureReason = @"focusUnavailable";
        opaqueEditor.fallbackTarget = Target(@"opaque editor", NO);
        [opaqueEditor begin]; Await(opaqueEditor);
        NSCAssert([opaqueEditor.fallbackTarget.contents isEqual:@"opaque editor dictated"] && opaqueEditor.posts == 1,
            @"An editor without a focused AX element still receives one normal paste");
        NSCAssert([opaqueEditor.outcome[@"result"] isEqual:@"clipboardOnly"]
            && [opaqueEditor.outcome[@"reason"] isEqual:@"verificationUnavailable"]
            && [opaqueEditor.outcome[@"diagnostics"][@"pastePosted"] boolValue]
            && [[board stringForType:NSPasteboardTypeString] isEqual:@" dictated"],
            @"Unverifiable insertion retains the transcript without claiming verified success");

        [board clearContents]; [board setString:@"original copy" forType:NSPasteboardTypeString];
        VITestJob *lazyFocus = Job(Target(@"lazy web editor", NO), board);
        lazyFocus.captureMisses = 2;
        [lazyFocus begin];
        NSCAssert(lazyFocus.posts == 0 && [[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"],
            @"Wait for delayed focus before touching the clipboard or posting paste");
        Await(lazyFocus);
        NSCAssert([lazyFocus.outcome[@"result"] isEqual:@"inserted"] && lazyFocus.posts == 1
            && [lazyFocus.current.contents isEqual:@"lazy web editor dictated"] && lazyFocus.focusAttempts == 3,
            @"Delayed AX focus still produces verified insertion, never a blind clipboard completion");
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@"original copy"],
            @"Recovering delayed focus restores the original clipboard");

        VITestJob *switchedDuringFocus = Job(Target(@"other window", NO), board);
        switchedDuringFocus.captureMisses = 2;
        [switchedDuringFocus begin]; switchedDuringFocus.destinationChanged = YES; Await(switchedDuringFocus);
        NSCAssert(switchedDuringFocus.posts == 0 && [switchedDuringFocus.outcome[@"reason"] isEqual:@"focusChanged"],
            @"Focus retries never retarget another application or window");

        VITestJob *copiedDuringFocus = Job(Target(@"web editor", NO), board);
        copiedDuringFocus.captureMisses = 1;
        [copiedDuringFocus begin];
        [board clearContents]; [board setString:@"copy during focus wait" forType:NSPasteboardTypeString];
        Await(copiedDuringFocus);
        NSCAssert(copiedDuringFocus.posts == 0 && [copiedDuringFocus.outcome[@"reason"] isEqual:@"clipboardChanged"]
            && [[board stringForType:NSPasteboardTypeString] isEqual:@"copy during focus wait"],
            @"A recovered normal editor also preserves a copy made during the focus wait");

        VITestJob *denied = Job(nil, board);
        denied.captureFailureReason = @"accessibilityDenied";
        [denied begin]; Await(denied);
        NSCAssert(denied.posts == 0 && [denied.outcome[@"reason"] isEqual:@"accessibilityDenied"],
            @"Missing permission never posts a compatibility paste");
        for (NSNumber *duringCopy in @[@NO, @YES]) {
            VITestJob *moved = Job(nil, board);
            moved.captureFailureReason = @"focusUnavailable";
            moved.destinationChanged = !duringCopy.boolValue;
            moved.changeDestinationDuringCopy = duringCopy.boolValue;
            [moved begin]; Await(moved);
            NSCAssert(moved.posts == 0 && [moved.outcome[@"reason"] isEqual:@"focusChanged"],
                @"A changed active app/window cancels compatibility insertion");
        }

        VITestJob *newCopyWhileWaiting = Job(nil, board);
        newCopyWhileWaiting.captureFailureReason = @"focusUnavailable";
        newCopyWhileWaiting.heldChecks = 1;
        [newCopyWhileWaiting begin];
        [board clearContents]; [board setString:@"user copy while waiting" forType:NSPasteboardTypeString];
        Await(newCopyWhileWaiting);
        NSCAssert(newCopyWhileWaiting.posts == 0 && [newCopyWhileWaiting.outcome[@"reason"] isEqual:@"clipboardChanged"]
            && [[board stringForType:NSPasteboardTypeString] isEqual:@"user copy while waiting"],
            @"Compatibility insertion preserves a new copy made before shortcut release");

        [board clearContents];
        VITestJob *empty = Job(Target(@"web", NO), board);
        [empty begin]; Await(empty);
        NSCAssert(board.pasteboardItems.count == 0, @"Restore an empty clipboard");
        VITestJob *blank = Job(Target(@"web", YES), board);
        blank.text = @"";
        NSInteger emptyChange = board.changeCount;
        [blank begin]; Await(blank);
        NSCAssert([blank.outcome[@"result"] isEqual:@"failed"] && board.changeCount == emptyChange, @"Empty result leaves the clipboard untouched");

        VITestJob *unverified = Job(Target(@"web", YES), board);
        [unverified begin];
        unverified.current.contents = @"unrelated edit";
        unverified.current.focused = NO;
        [board clearContents]; [board setString:@"newer copy" forType:NSPasteboardTypeString];
        Await(unverified);
        NSCAssert([unverified.outcome[@"result"] isEqual:@"failed"] && unverified.posts == 1
            && [[board stringForType:NSPasteboardTypeString] isEqual:@"newer copy"], @"Failed verification preserves a newer copy without a duplicate paste");
        VITestJob *ignored = Job(Target(@"unchanged", YES), board);
        ignored.ignorePaste = YES;
        [ignored begin]; Await(ignored);
        NSCAssert([ignored.outcome[@"result"] isEqual:@"clipboardOnly"] && [ignored.outcome[@"reason"] isEqual:@"unverified"]
            && ignored.posts == 1 && [ignored.current.contents isEqual:@"unchanged"], @"An ignored paste remains unverified and is never retried");
        VITestJob *formatted = Job(nil, board);
        formatted.options = @{@"restore":@NO, @"autoSend":@"none", @"html":@"<strong> dictated</strong>"};
        [formatted begin]; Await(formatted);
        NSCAssert([[board stringForType:NSPasteboardTypeString] isEqual:@" dictated"], @"Formatted snippet retains its plain-text representation");
        NSCAssert([[board stringForType:NSPasteboardTypeHTML] isEqual:@"<strong> dictated</strong>"], @"Formatted snippet retains HTML for compatible destinations");
        [board releaseGlobally];
        puts("Paste sessions: regression checks passed, including late and opaque selection replacement");
    }
}
