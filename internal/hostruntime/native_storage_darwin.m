//go:build darwin && !server

#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>
#import <dispatch/dispatch.h>
#include <stdint.h>

extern void omniviewNativeStorageComplete(uintptr_t token);

int omniviewNativeBundleMatches(const char *expected) {
    @autoreleasepool {
        NSString *identity = [[NSBundle mainBundle] bundleIdentifier];
        return identity != nil && [identity isEqualToString:[NSString stringWithUTF8String:expected]];
    }
}

// All WebKit work, including defaultDataStore creation, belongs to the native
// main queue. The Go caller registers this only after ApplicationStarted.
void omniviewRemoveNativeStorage(uintptr_t token) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            WKWebsiteDataStore *store = [WKWebsiteDataStore defaultDataStore];
            [store removeDataOfTypes:[WKWebsiteDataStore allWebsiteDataTypes]
                      modifiedSince:[NSDate distantPast]
                  completionHandler:^{
                omniviewNativeStorageComplete(token);
            }];
        }
    });
}
