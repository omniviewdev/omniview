import '@testing-library/jest-dom';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { webcrypto } from 'crypto';

// jsdom doesn't provide TextEncoder/TextDecoder — polyfill from Node's util
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = NodeTextDecoder;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = NodeTextEncoder;
}

// jsdom doesn't provide window.matchMedia — stub it for MUI CssVarsProvider
if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

// jsdom doesn't provide crypto.getRandomValues — polyfill from Node
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.getRandomValues === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
  });
}

// Ensure crypto.randomUUID is available (jsdom may have crypto but not randomUUID)
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  (globalThis.crypto as any).randomUUID = () => webcrypto.randomUUID();
}

// Mock ResizeObserver (jsdom doesn't have it)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// Mock requestAnimationFrame / cancelAnimationFrame
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}
