/// <reference types="@testing-library/jest-dom/vitest" />
import { vi, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend vitest's expect with jest-dom matchers using the same expect instance
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
} as unknown as typeof ResizeObserver;

// clipboard stub
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
});

// scrollIntoView stub (used by ChatMessageList)
Element.prototype.scrollIntoView = vi.fn();

// scrollTo stub (jsdom doesn't implement it)
Element.prototype.scrollTo = vi.fn();
window.scrollTo = vi.fn() as any;
