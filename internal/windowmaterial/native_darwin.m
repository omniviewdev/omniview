//go:build ui_next && darwin && !ios && !server && cgo && !purego

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include "desktop.h"

// The window owns its effects. Wails keeps its original WKWebView, delegates,
// drag overlay, toolbar and window buttons for the entire window lifetime.
@interface OVWindowMaterialState : NSObject
@property(nonatomic, weak) WKWebView *web;
@property(nonatomic, strong) NSColor *solidBackground;
@property(nonatomic, strong) NSColor *underPageColor;
@property(nonatomic, strong) NSVisualEffectView *vibrancy;
@property(nonatomic, strong) NSView *glass;
@property(nonatomic) NSAutoresizingMaskOptions webMask;
@property(nonatomic) BOOL webTranslatesMask;
@end
@implementation OVWindowMaterialState
@end

static char stateKey;

static BOOL requiresOpaque(void) {
    NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
    return workspace.accessibilityDisplayShouldReduceTransparency || workspace.accessibilityDisplayShouldIncreaseContrast;
}

static BOOL supportsGlass(void) {
#if __has_include(<AppKit/NSGlassEffectView.h>)
    if (@available(macOS 26.0, *)) return NSClassFromString(@"NSGlassEffectView") != Nil;
#endif
    return NO;
}

// This one key is the entire private API surface. Even the read is restricted
// to next-native builds running macOS 26+. An accepted write is not enough:
// if WebKit doesn't return the requested value the window stays solid.
static BOOL webBackground(WKWebView *web, NSNumber *draws) API_AVAILABLE(macos(26.0));
static BOOL webBackground(WKWebView *web, NSNumber *draws) {
    @try {
        id value = [web valueForKey:@"drawsBackground"];
        if (![value isKindOfClass:NSNumber.class]) return NO;
        if (!draws || [value isEqualToNumber:draws]) return YES;
        [web setValue:draws forKey:@"drawsBackground"];
        value = [web valueForKey:@"drawsBackground"];
        return [value isKindOfClass:NSNumber.class] && [value isEqualToNumber:draws];
    } @catch (NSException *exception) {
        return NO;
    }
}

static NSResponder *webResponder(NSWindow *window, WKWebView *web) {
    NSResponder *responder = window.firstResponder;
    if ([responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:web]) return responder;
    return nil;
}

static void restoreResponder(NSWindow *window, NSResponder *responder) {
    if (responder && window.firstResponder != responder && [(NSView *)responder window] == window) {
        [window makeFirstResponder:responder];
    }
}

static void leaveGlass(NSWindow *window, OVWindowMaterialState *state) {
#if __has_include(<AppKit/NSGlassEffectView.h>)
    if (@available(macOS 26.0, *)) {
        NSGlassEffectView *glass = (NSGlassEffectView *)state.glass;
        NSView *parent = glass.superview;
        if (!parent) return;
        WKWebView *web = state.web;
        NSResponder *responder = webResponder(window, web);
        NSRect frame = glass.frame;
        glass.contentView = nil;
        [parent addSubview:web positioned:NSWindowAbove relativeTo:glass];
        web.translatesAutoresizingMaskIntoConstraints = state.webTranslatesMask;
        web.autoresizingMask = state.webMask;
        web.frame = frame;
        [glass removeFromSuperview];
        restoreResponder(window, responder);
    }
#endif
}

static BOOL enterGlass(NSWindow *window, OVWindowMaterialState *state, BOOL clear) {
#if __has_include(<AppKit/NSGlassEffectView.h>)
    if (@available(macOS 26.0, *)) {
        WKWebView *web = state.web;
        NSGlassEffectView *glass = (NSGlassEffectView *)state.glass;
        if (!glass) {
            glass = [[NSGlassEffectView alloc] initWithFrame:web.frame];
            if (!glass) return NO;
            glass.cornerRadius = 0; // the NSWindow clips the outer corners
            state.glass = glass;
        }
        glass.style = clear ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
        if (glass.contentView != web) {
            NSView *parent = web.superview;
            if (!parent) return NO;
            NSResponder *responder = webResponder(window, web);
            state.webMask = web.autoresizingMask;
            state.webTranslatesMask = web.translatesAutoresizingMaskIntoConstraints;
            glass.autoresizingMask = state.webMask;
            glass.frame = web.frame;
            // Take exactly the webview's slot. Its drag overlay stays above it.
            [parent addSubview:glass positioned:NSWindowBelow relativeTo:web];
            [web removeFromSuperview];
            glass.contentView = web;
            web.frame = glass.bounds;
            restoreResponder(window, responder);
        }
        return YES;
    }
#endif
    return NO;
}

static void enterVibrancy(OVWindowMaterialState *state) {
    WKWebView *web = state.web;
    NSVisualEffectView *view = state.vibrancy;
    if (!view) {
        view = [[NSVisualEffectView alloc] initWithFrame:web.frame];
        view.material = NSVisualEffectMaterialUnderWindowBackground;
        view.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        view.state = NSVisualEffectStateFollowsWindowActiveState;
        state.vibrancy = view;
    }
    view.frame = web.frame;
    view.autoresizingMask = web.autoresizingMask;
    if (view.superview != web.superview) [web.superview addSubview:view positioned:NSWindowBelow relativeTo:web];
}

static void restoreSolid(NSWindow *window, OVWindowMaterialState *state) API_AVAILABLE(macos(26.0));
static void restoreSolid(NSWindow *window, OVWindowMaterialState *state) {
    // Wails marks even MacBackdropNormal windows nonopaque at construction.
    window.opaque = YES;
    if (!state) return;
    leaveGlass(window, state);
    [state.vibrancy removeFromSuperview];
    window.backgroundColor = state.solidBackground;
    webBackground(state.web, @YES);
#if MAC_OS_X_VERSION_MAX_ALLOWED >= 120000
    state.web.underPageBackgroundColor = state.underPageColor;
#endif
}

OVMaterialResult ovApplyMaterial(void *pointer, OVMaterial requested, bool clear, bool highContrast) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    BOOL forced = highContrast || requiresOpaque();
    OVMaterialResult result = { OVOpaque, forced ? OVAccessibility : OVSupported, false };
    if (@available(macOS 26.0, *)) {
        OVWindowMaterialState *state = objc_getAssociatedObject(window, &stateKey);
        WKWebView *web = state.web;
        if (!web) {
            // Wails creates its WKWebView directly under the content view. If
            // that contract changes, leave the unknown hierarchy alone.
            for (NSView *child in window.contentView.subviews) {
                if ([child isKindOfClass:WKWebView.class]) { web = (WKWebView *)child; break; }
            }
        }
        BOOL solid = forced || requested == OVOpaque;
        BOOL supported = web != nil && webBackground(web, solid ? nil : @NO);
        result.glassAvailable = supported && supportsGlass();
        if (solid) {
            restoreSolid(window, state);
            return result;
        }
        if (!supported) {
            if (!state && web) webBackground(web, @YES); // roll back even a partially accepted first write
            restoreSolid(window, state);
            return (OVMaterialResult){ OVInPage, OVWebViewUnavailable, false };
        }
        if (!state) {
            state = [OVWindowMaterialState new];
            state.web = web;
            state.solidBackground = window.backgroundColor;
#if MAC_OS_X_VERSION_MAX_ALLOWED >= 120000
            state.underPageColor = web.underPageBackgroundColor;
#endif
            objc_setAssociatedObject(window, &stateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
#if MAC_OS_X_VERSION_MAX_ALLOWED >= 120000
        web.underPageBackgroundColor = NSColor.clearColor;
#endif
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        if (requested == OVGlass && result.glassAvailable) {
            [state.vibrancy removeFromSuperview];
            if (enterGlass(window, state, clear)) {
                result.effective = OVGlass;
                return result;
            }
            result.glassAvailable = false;
        }
        leaveGlass(window, state);
        enterVibrancy(state);
        result.effective = OVTranslucent;
        result.reason = requested == OVGlass ? OVUnsupported : OVSupported;
        return result;
    }
    // No undocumented WK call on older macOS, even for a persisted glass request.
    window.opaque = YES;
    if (!forced && requested != OVOpaque) return (OVMaterialResult){ OVInPage, OVUnsupported, false };
    return result;
}

@interface OVMaterialObserver : NSObject
@property(nonatomic, strong) id token;
@property(nonatomic) uintptr_t handle;
@property(nonatomic) BOOL forced;
@end
@implementation OVMaterialObserver
@end

void *ovObserveMaterial(void *window, uintptr_t handle) {
    OVMaterialObserver *observer = [OVMaterialObserver new];
    observer.handle = handle;
    observer.forced = requiresOpaque();
    __weak OVMaterialObserver *weakObserver = observer;
    observer.token = [NSWorkspace.sharedWorkspace.notificationCenter
        addObserverForName:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil
        queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
            OVMaterialObserver *owner = weakObserver;
            BOOL forced = requiresOpaque();
            if (owner.handle != 0 && owner.forced != forced) {
                owner.forced = forced;
                ovMaterialEnvironmentChanged(owner.handle);
            }
        }];
    return (__bridge_retained void *)observer;
}

void ovStopObservingMaterial(void *pointer) {
    OVMaterialObserver *observer = (__bridge_transfer OVMaterialObserver *)pointer;
    observer.handle = 0;
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:observer.token];
}
