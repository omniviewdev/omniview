import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = await readFile(path.join(import.meta.dirname, 'WindowSurface.module.css'), 'utf8');
const HIDDEN = '.window[data-visible=\'false\']';

// jsdom computes no cascade layers and the host reads no CSS from a test: what the host's runtime looks for in the window's stylesheet is read here as text. The Wails runtime finds the regions that move the window by
// `--wails-draggable` in the computed style (the top row's own test reads it the same way): the caption moves the window, and Close, the one control in it, does not.

const block = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('the Settings window\'s stylesheet', () => {
  it('makes the caption the region that moves the window, and the controls in it not', () => {
    expect(block('.caption')).toContain('--wails-draggable: drag;');
    expect(block('.caption button')).toContain('--wails-draggable: no-drag;');
  });

  it('lays out and paints nothing while the host has the window hidden', () => {
    expect(block(HIDDEN)).toContain('content-visibility: hidden;');
  });

  it('fills the window it is in', () => {
    expect(block('.window')).toContain('block-size: 100dvh;');
  });
});
