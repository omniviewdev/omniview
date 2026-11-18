// Whether the page runs in the app's own window and not in a browser tab. Framework-free, like the rest of `core/`: React only draws the answer.

/** The two bridges a desktop web view gives the Wails runtime, as far as this reads them. A web view's objects are host objects: nothing here is assumed to be there. */
type Bridge = {
  readonly chrome?: { readonly webview?: { readonly postMessage?: unknown } };
  readonly webkit?: { readonly messageHandlers?: { readonly external?: { readonly postMessage?: unknown } } };
};

/**
 * True in the desktop app's window. Its web view carries the message handler the Wails runtime talks to the app through: `window.chrome.webview` in WebView2
 * (Windows) and `window.webkit.messageHandlers.external` in WKWebView and WebKitGTK (macOS and Linux). A browser that serves the app (server mode, or the
 * development server opened in a tab) has neither: the runtime picks its own transport by these same two properties (`@wailsio/runtime`, `system.js`) and warns
 * "Browser Environment Detected" when it finds none. The handler is there when the first script runs, so a frame drawn from this answer needs no second paint.
 */
export function isNativeWindow(scope: unknown = window): boolean {
  try {
    const { chrome, webkit } = scope as Bridge;
    return typeof chrome?.webview?.postMessage === 'function' || typeof webkit?.messageHandlers?.external?.postMessage === 'function';
  } catch {
    // A context that refuses the read (a sandboxed frame) is not the app's window; the runtime treats it the same way.
    return false;
  }
}
