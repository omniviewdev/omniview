import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';

const css = await readFile(path.join(import.meta.dirname, 'control.module.css'), 'utf8');
const face = (selector: string) => declarationsOf(css, selector);

// The face that TextInput, SecretInput, Select and the number field share: the mock's `input` (base.css 1015 to 1044), one stylesheet, so that
// one state is painted one way wherever it appears.
describe('the stylesheet of a field face', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s input: the control height, a 1 px control border, the control radius, the island fill, 13/16 type, insets of 9 and 6 px', () => {
    const base = face('.face');
    expect(base['min-height']).toBe('var(--ov-control-height)');
    expect(base['box-sizing']).toBe('border-box');
    expect(base.border).toBe('1px solid var(--_border)');
    expect(base['border-radius']).toBe('var(--ov-radius-control)');
    expect(base['background-color']).toBe('var(--_bg)');
    expect(base.color).toBe('var(--_fg)');
    expect(base['font-family']).toBe('var(--ov-font-ui)');
    expect(base['font-size']).toBe('var(--ov-fs-13)');
    expect(base['line-height']).toBe('var(--ov-lh-16)');
    expect(base['padding-block']).toBe('var(--ov-spacing-4)');
    expect(base['padding-inline']).toBe('9px 6px');
    expect(base['--_border']).toBe('var(--ov-border-control)');
    expect(base['--_bg']).toBe('var(--ov-bg-island)');
    expect(base['--_fg']).toBe('var(--ov-fg)');
    expect(face('.face::placeholder').color).toBe('var(--ov-fg-muted)');
    expect(face('.face::placeholder').opacity).toBe('1');
  });

  it('takes the code face for an identifier', () => {
    expect(face('.face[data-ov-mono=\'true\']')['font-family']).toBe('var(--ov-font-code)');
    expect(face('.face[data-ov-mono=\'true\']')['font-variant-ligatures']).toBe('none');
  });

  it('rings the focus in the accent: a 2 px outline outside the edge, whose own border takes the island colour', () => {
    const focus = face('.face:focus-visible');
    expect(focus.outline).toBe('2px solid var(--_ring)');
    expect(focus['outline-offset']).toBe('0');
    expect(focus['--_border']).toBe('var(--ov-bg-island)');
    expect(face('.face')['--_ring']).toBe('var(--ov-accent)');
  });

  it('paints invalid with the error roles and a warning with the warning roles, in the border at rest and in the ring when focused', () => {
    expect(face('.face[aria-invalid=\'true\']')['--_border']).toBe('var(--ov-error-control-inactive)');
    expect(face('.face[aria-invalid=\'true\']:focus-visible')['--_ring']).toBe('var(--ov-error-control)');
    expect(face('.face[aria-invalid=\'true\']:focus-visible')['--_border']).toBe('var(--ov-bg-island)');
    expect(face('.face[data-ov-validation=\'warning\']')['--_border']).toBe('var(--ov-warning-control-inactive)');
    expect(face('.face[data-ov-validation=\'warning\']:focus-visible')['--_ring']).toBe('var(--ov-warning-control)');
    expect(face('.face[data-ov-validation=\'warning\']:focus-visible')['--_border']).toBe('var(--ov-bg-island)');
  });

  it('paints a read-only field as a fact on the inline surface, and an unavailable one with the disabled roles', () => {
    const readonly = face('.face[readonly]:not([aria-disabled=\'true\'])');
    expect(readonly['--_bg']).toBe('var(--ov-bg-inline)');
    expect(readonly['--_border']).toBe('var(--ov-border-subtle)');
    const disabled = face('.face[aria-disabled=\'true\']');
    expect(disabled['--_bg']).toBe('var(--ov-bg-island)');
    expect(disabled['--_fg']).toBe('var(--ov-fg-disabled)');
    expect(disabled['--_border']).toBe('var(--ov-border-disabled)');
    expect(disabled.cursor).toBe('default');
    expect(face('.face[aria-disabled=\'true\']::placeholder').color).toBe('var(--ov-fg-disabled)');
  });

  it('writes no colour of its own: a role or a private property that holds one', () => {
    for (const entry of cssRules(css)) {
      for (const [property, value] of Object.entries(entry.declarations)) {
        if (/color$|^--_(?:border|bg|fg|ring)$/.test(property)) {
          expect(value, `${entry.selector} ${property}`).toMatch(/^var\(--(?:ov|_)-?[a-z0-9-]+\)$/);
        }
      }
    }
  });
});
