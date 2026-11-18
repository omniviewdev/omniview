import { describe, expect, it } from 'vitest';
import { isNativeWindow } from './native';

const handler = { postMessage: () => undefined };

describe('isNativeWindow', () => {
  it('is false in a browser: no bridge at all', () => {
    expect(isNativeWindow({})).toBe(false);
  });

  it('is false in a browser that has a `chrome` object or a `webkit` object of its own, with no Wails bridge in them', () => {
    // Chrome has `window.chrome` (loadTimes, runtime); Safari and Playwright's WebKit have `window.webkit` and its `messageHandlers`, with the page's own handlers.
    expect(isNativeWindow({ chrome: { runtime: {}, loadTimes: () => ({}) } })).toBe(false);
    expect(isNativeWindow({ webkit: {} })).toBe(false);
    expect(isNativeWindow({ webkit: { messageHandlers: {} } })).toBe(false);
    expect(isNativeWindow({ webkit: { messageHandlers: { playwright: handler } } })).toBe(false);
  });

  it('is true in the macOS and Linux web view: the `external` message handler the Wails runtime posts to', () => {
    expect(isNativeWindow({ webkit: { messageHandlers: { external: handler } } })).toBe(true);
  });

  it('is true in the Windows web view: `chrome.webview.postMessage`', () => {
    expect(isNativeWindow({ chrome: { webview: handler } })).toBe(true);
  });

  it('wants a handler that can be posted to, not the name of one', () => {
    expect(isNativeWindow({ webkit: { messageHandlers: { external: {} } } })).toBe(false);
    expect(isNativeWindow({ webkit: { messageHandlers: { external: null } } })).toBe(false);
    expect(isNativeWindow({ chrome: { webview: { postMessage: 'yes' } } })).toBe(false);
    expect(isNativeWindow({ chrome: { webview: null } })).toBe(false);
  });

  it('is false where the read itself is refused', () => {
    const refusing = {
      get chrome(): never {
        throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError');
      },
    };
    expect(isNativeWindow(refusing)).toBe(false);
  });

  it('reads the real window by default, which is a browser under jsdom', () => {
    expect(isNativeWindow()).toBe(false);
  });
});
