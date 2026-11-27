#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <assert.h>
#include "../desktop.h"

void ovMaterialEnvironmentChanged(uintptr_t handle) { assert(handle == 1); }

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        if (NSScreen.screens.count == 0) return 77;
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 480, 320)
            styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskResizable)
            backing:NSBackingStoreBuffered defer:NO];
        window.opaque = NO; // Wails' WebviewWindow initializer
        window.backgroundColor = NSColor.blackColor;
        NSView *root = window.contentView;
        WKWebView *web = [[WKWebView alloc] initWithFrame:root.bounds];
        web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [root addSubview:web];
        NSView *dragOverlay = [[NSView alloc] initWithFrame:root.bounds];
        [root addSubview:dragOverlay];
        NSButton *closeButton = [window standardWindowButton:NSWindowCloseButton];
        [window makeFirstResponder:web];
        NSResponder *responder = window.firstResponder;
        void *pointer = (__bridge void *)window;
        void *observer = ovObserveMaterial(pointer, 1);

        OVMaterialResult solid = ovApplyMaterial(pointer, OVOpaque, false, false);
        assert(solid.effective == OVOpaque && window.opaque && root.subviews.count == 2);
        OVMaterialResult glass = ovApplyMaterial(pointer, OVGlass, false, false);
        if (solid.reason == OVAccessibility) {
            assert(glass.effective == OVOpaque && glass.reason == OVAccessibility);
        } else if (@available(macOS 26.0, *)) {
            if (solid.glassAvailable) {
                assert(glass.effective == OVGlass && !window.opaque);
                NSView *glassView = root.subviews.firstObject;
                assert([glassView isKindOfClass:NSClassFromString(@"NSGlassEffectView")]);
                assert([web isDescendantOf:glassView] && web.window == window && root.subviews.lastObject == dragOverlay);
                assert(window.firstResponder == responder && root.subviews.count == 2);
                OVMaterialResult clear = ovApplyMaterial(pointer, OVGlass, true, false);
                assert(clear.effective == OVGlass && root.subviews.firstObject == glassView);
#if __has_include(<AppKit/NSGlassEffectView.h>)
                assert(((NSGlassEffectView *)glassView).style == NSGlassEffectViewStyleClear);
#endif
                [window setContentSize:NSMakeSize(600, 380)];
                [root layoutSubtreeIfNeeded];
                assert(NSEqualSizes(web.bounds.size, root.bounds.size));
                OVMaterialResult vibrancy = ovApplyMaterial(pointer, OVTranslucent, false, false);
                NSView *effect = root.subviews.firstObject;
                assert(vibrancy.effective == OVTranslucent && [effect isKindOfClass:NSVisualEffectView.class]);
                assert(root.subviews.count == 3 && web.superview == root && root.subviews.lastObject == dragOverlay);
                assert(web.autoresizingMask == (NSViewWidthSizable | NSViewHeightSizable));
                assert(NSEqualRects(web.frame, root.bounds) && window.firstResponder == responder);
                ovApplyMaterial(pointer, OVGlass, false, false);
                assert(root.subviews.count == 2 && root.subviews.firstObject == glassView);
                ovApplyMaterial(pointer, OVTranslucent, false, false);
                assert(root.subviews.firstObject == effect); // reuse, never stack
            } else {
                assert(glass.effective == OVTranslucent || (glass.effective == OVInPage && glass.reason == OVWebViewUnavailable));
            }
        } else {
            assert(glass.effective == OVInPage && !glass.glassAvailable && window.opaque);
        }
        OVMaterialResult forced = ovApplyMaterial(pointer, OVGlass, true, true);
        assert(forced.effective == OVOpaque && forced.reason == OVAccessibility && window.opaque);
        assert(root.subviews.count == 2 && root.subviews.firstObject == web && root.subviews.lastObject == dragOverlay);
        assert(closeButton == [window standardWindowButton:NSWindowCloseButton]);
        ovStopObservingMaterial(observer);
    }
    return 0;
}
