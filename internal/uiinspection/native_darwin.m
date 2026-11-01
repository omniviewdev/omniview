//go:build darwin && !server && cgo

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>
#include <stdlib.h>
#include <string.h>
#include "native_darwin.h"

// Stop counting after the second match: ambiguous windows must never be mutated.
static void findWebView(NSView *view, WKWebView **found, unsigned int *count) {
    if (view == nil || *count > 1) {
        return;
    }
    if ([view isKindOfClass:[WKWebView class]]) {
        *found = (WKWebView *)view;
        ++*count;
    }
    for (NSView *child in view.subviews) {
        findWebView(child, found, count);
        if (*count > 1) {
            return;
        }
    }
}

static char *copyString(NSString *value) {
    const char *utf8 = value.UTF8String;
    return utf8 == NULL ? NULL : strdup(utf8);
}

// The Go caller synchronously dispatches both handle lookup and this complete
// operation to the main thread. No native objects escape the autorelease pool.
OmniviewInspectionStatus omniviewInspectWindow(void *handle, bool apply, bool enabled) {
    OmniviewInspectionStatus status = {0};
    @autoreleasepool {
        if (![NSThread isMainThread]) {
            status.error = copyString(@"Native inspection requires the main thread");
            return status;
        }
        if (@available(macOS 13.3, *)) {
            status.supported = true;
            @try {
                if (handle == NULL) {
                    status.error = copyString(@"Window is missing, closed, or not yet native");
                    return status;
                }
                NSWindow *window = (NSWindow *)handle;
                if (![window isKindOfClass:[NSWindow class]]) {
                    status.error = copyString(@"Native handle is not an NSWindow");
                    return status;
                }
                WKWebView *webView = nil;
                unsigned int count = 0;
                findWebView(window.contentView, &webView, &count);
                if (count != 1) {
                    status.error = copyString(count == 0
                        ? @"Window contains no WKWebView"
                        : @"Window contains multiple WKWebViews");
                    return status;
                }
                if (apply) {
                    webView.inspectable = enabled;
                }
                status.enabled = webView.inspectable;
                if (status.enabled && !apply) {
                    NSBundle *bundle = [NSBundle mainBundle];
                    NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"];
                    if (name.length == 0) {
                        name = [bundle objectForInfoDictionaryKey:@"CFBundleName"];
                    }
                    status.application = copyString(name);
                    // Safari labels the app page with its URL host, not document.title.
                    status.target = copyString(webView.URL.host);
                }
                if (status.enabled != enabled) {
                    status.error = copyString(@"Native inspection does not match the startup policy");
                }
            } @catch (NSException *exception) {
                status.error = copyString([NSString stringWithFormat:@"Native inspection failed: %@", exception.reason]);
            }
        }
    }
    return status;
}

void omniviewFreeInspectionStatus(OmniviewInspectionStatus status) {
    free(status.application);
    free(status.target);
    free(status.error);
}
