import type {} from '@testing-library/jest-dom/vitest';
import { vi, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { readFileSync } from 'node:fs';

// Node's native Web Storage can shadow DOM globals on newer Node releases.
// Persistence belongs to this JSDOM origin, not the test runner's process.
const domWindow = (globalThis as typeof globalThis & {
  jsdom: { window: Pick<Window, 'localStorage' | 'sessionStorage'> };
}).jsdom.window;
vi.stubGlobal('localStorage', domWindow.localStorage);
vi.stubGlobal('sessionStorage', domWindow.sessionStorage);

// Existing persistence tests exercise production's legacy keys explicitly.
// Run the real pre-React bootstrap so tests use the browser's key resolver,
// rather than treating an absent identity as production.
window.__OMNIVIEW_INSTANCE__ = {
  schemaVersion: 1,
  instanceID: 'stable',
  displayName: 'Omniview',
  generation: '',
  kind: 'production',
};
const instanceBootstrap = /<script>([\s\S]*?)<\/script>/.exec(readFileSync('index.html', 'utf8'))?.[1];
if (!instanceBootstrap) {
  throw new Error('Missing instance bootstrap script');
}

new Function(instanceBootstrap)();

// Extend vitest's expect with jest-dom matchers
expect.extend(matchers);

// matchMedia stub (required for MUI)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ResizeObserver stub
window.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// scrollIntoView stub (jsdom doesn't implement it)
Element.prototype.scrollIntoView = vi.fn();

// scrollTo stub (jsdom doesn't implement it)
Element.prototype.scrollTo = vi.fn();
window.scrollTo = vi.fn() as any;
