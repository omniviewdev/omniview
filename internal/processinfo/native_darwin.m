//go:build darwin && !server && cgo

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include "native_darwin.h"

OmniviewProcessWindow omniviewObserveProcessWindow(void *handle, int expectedPID) {
    OmniviewProcessWindow result = {0, "Window is missing, closed, or not yet native"};
    @autoreleasepool {
        if (![NSThread isMainThread]) {
            result.error = "Native window lookup requires the main thread";
            return result;
        }
        if (handle == NULL) {
            return result;
        }
        // Compare pointers against live public AppKit windows before messaging
        // the handle. Unknown or stale pointers must never be dereferenced.
        NSWindow *window = nil;
        for (NSWindow *candidate in NSApp.windows) {
            if ((__bridge void *)candidate == handle) {
                window = candidate;
                break;
            }
        }
        if (window == nil || window.windowNumber <= 0) {
            return result;
        }
        NSInteger number = window.windowNumber;
        CFArrayRef info = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)number);
        if (info == NULL) {
            result.error = "Public window ownership is unavailable";
            return result;
        }
        BOOL verified = NO;
        for (NSDictionary *entry in (__bridge NSArray *)info) {
            NSNumber *windowID = entry[(id)kCGWindowNumber];
            NSNumber *owner = entry[(id)kCGWindowOwnerPID];
            if (windowID != nil && owner != nil && windowID.longLongValue == number && owner.intValue == expectedPID) {
                verified = YES;
                break;
            }
        }
        CFRelease(info);
        if (!verified) {
            result.error = "Public window owner does not match the host";
            return result;
        }
        result.windowID = (int64_t)number;
        result.error = NULL;
    }
    return result;
}
