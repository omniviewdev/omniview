// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The stylesheet of Button and IconButton, as text: jsdom lays nothing out, so what the stylesheet must say is asserted here and
// what the browser paints from it is probed in WebKit and Chromium (packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'command.module.css'), 'utf8');

describe('the command stylesheet (Button and IconButton)', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
  });

  it('has a rule for every variant, tone, size and shape its parts accept; the base is the secondary variant', () => {
    for (const variant of ['primary', 'ghost']) {
      expect(css, variant).toContain(`[data-ov-variant='${variant}']`);
    }

    expect(css).toContain('[data-ov-tone=\'danger\']');
    for (const size of ['compact', 'row']) {
      expect(css, size).toContain(`[data-ov-size='${size}']`);
    }

    expect(css).toContain('[data-ov-shape=\'icon\']');
  });

  it('is 28 px tall from the control token, and 24 or 22 from the row target', () => {
    expect(css).toMatch(/min-height:\s*var\(--ov-control-height\)/);
    expect(css).toMatch(/height:\s*var\(--ov-row-target\)/);
  });

  it('paints from tokens: the control border, the accent, the error control, the hover and pressed overlays, the disabled roles', () => {
    for (const token of [
      '--ov-border-control', '--ov-accent', '--ov-fg-over-accent', '--ov-error-fg', '--ov-error-control', '--ov-hover-row', '--ov-hover-toolbar',
      '--ov-pressed', '--ov-fg-disabled', '--ov-bg-island', '--ov-border-disabled', '--ov-icon', '--ov-icon-disabled',
    ]) {
      expect(css, token).toContain(`var(${token})`);
    }
  });

  it('paints a unavailable command by its aria-disabled attribute, never by opacity, and no hover or pressed paint reaches it', () => {
    expect(css).toContain('[aria-disabled=\'true\']');
    expect(css).not.toMatch(/opacity\s*:/);
    for (const [, selector] of css.matchAll(/([^{}]*:(?:hover|active)[^{}]*)\{/g)) {
      expect(selector, selector).toContain(':not([aria-disabled=\'true\'])');
    }
  });

  it('draws a focus ring only for the keyboard, outside the box, with the accent', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ov-accent\)[^}]*outline-offset:\s*2px/);
    expect(css).not.toMatch(/:focus\s*\{/);
  });

  it('spins the loader of a busy command, and holds it still under reduced motion', () => {
    expect(css).toContain('[data-ov-busy=\'true\']');
    expect(css).toMatch(/@keyframes/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation:\s*none/s);
  });

  it('keeps the label whole and the text off a native button face', () => {
    expect(css).toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/font-feature-settings:\s*var\(--ov-font-features\)/);
    expect(css).toMatch(/cursor:\s*pointer/);
    expect(css).toMatch(/cursor:\s*default/);
  });
});
