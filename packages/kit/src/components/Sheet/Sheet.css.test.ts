import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here, and what a browser paints from it is looked at in WebKit and Chromium
// (the real parts page: the frame's rectangle at both test viewports, the veil in three themes).
const css = await readFile(path.join(import.meta.dirname, 'Sheet.module.css'), 'utf8');
const rules = cssRules(css);
const rule = (selector: string) => declarationsOf(css, selector);

/** The value of `min(<px>, <100% or 100dvh> - 2 * var(--ov-spacing-24))` in a window: the frame's size, which the window clamps. */
function frameSize(value: string | undefined, viewport: { readonly width: number; readonly height: number }): number {
  const parts = /^min\((\d+)px, (100%|100dvh) - 2 \* var\(--ov-spacing-24\)\)$/.exec(value ?? '');
  expect(parts, `${value ?? 'no value'} is min(<size>px, <window> - 2 * var(--ov-spacing-24))`).not.toBeNull();
  const [, size = '', axis = ''] = parts ?? [];
  const room = axis === '100%' ? viewport.width : viewport.height;
  return Math.min(Number(size), room - 2 * 24);
}

describe('the Sheet stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const entry of rules) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the scrim while it is open: the whole window, a grid that centres the frame, and the browser\'s own rules for a modal dialog (its size, its margin, its border, its paint) put back to nothing', () => {
    expect(rule('.scrim[open]')).toMatchObject({
      position: 'fixed',
      inset: '0',
      display: 'grid',
      'grid-template': 'minmax(0, 1fr) / minmax(0, 1fr)',
      'place-items': 'center',
      'box-sizing': 'border-box',
      'inline-size': '100%',
      'block-size': '100%',
      'max-inline-size': 'none',
      'max-block-size': 'none',
      margin: '0',
      padding: '0',
      overflow: 'visible',
      border: '0',
      'background-color': 'transparent',
      color: 'inherit',
    });
  });

  it('leaves a dialog that is not open to the browser, which hides it: only the open state sets a display', () => {
    const closed = rules.filter((entry) => entry.selector === '.scrim');
    expect(closed.flatMap((entry) => Object.keys(entry.declarations))).not.toContain('display');
  });

  it('paints nothing of the browser\'s own over the page: the backdrop is transparent', () => {
    expect(rule('.scrim::backdrop')['background-color']).toBe('transparent');
  });

  it('draws no veil over the page, as the palette\'s scrim draws none: a veil in the dialog\'s own colour washed the light themes out (the comment in the stylesheet has the numbers)', () => {
    expect(rules.filter((entry) => /::(?:before|after)/.test(entry.selector))).toEqual([]);
    expect(rule('.scrim[open]')['background-color']).toBe('transparent');
    expect(rule('.scrim::backdrop')['background-color']).toBe('transparent');
    expect(rules.filter((entry) => 'opacity' in entry.declarations)).toEqual([]);
  });

  it('draws the frame 1060 by 640 px, clamped to the window less 24 px on each side, so at both test windows it is its own size', () => {
    const frame = rule('.frame');
    expect(frame['box-sizing']).toBe('border-box');
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      expect(frameSize(frame['inline-size'], viewport), `${String(viewport.width)} wide`).toBe(1060);
      expect(frameSize(frame['block-size'], viewport), `${String(viewport.height)} high`).toBe(640);
    }

    // Below that the window wins, and the margin is the 24 px step of the spacing scale.
    expect(frameSize(frame['inline-size'], { width: 1000, height: 600 })).toBe(952);
    expect(frameSize(frame['block-size'], { width: 1000, height: 600 })).toBe(552);
    expect(frame['inline-size']).toContain('var(--ov-spacing-24)');
    expect(frame['block-size']).toContain('var(--ov-spacing-24)');
  });

  it('paints the frame as the dialog surface: its fill, a 1 px popup edge, the popup radius and shadow, the text colour, and the UI font from the tokens', () => {
    expect(rule('.frame')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      overflow: 'hidden',
      border: '1px solid var(--ov-border-popup)',
      'border-radius': 'var(--ov-radius-popup)',
      'background-color': 'var(--ov-bg-dialog)',
      'box-shadow': 'var(--ov-shadow-popup)',
      color: 'var(--ov-fg)',
      'font-family': 'var(--ov-font-ui)',
      'font-feature-settings': 'var(--ov-font-features)',
      'font-size': 'var(--ov-fs-13)',
      'font-synthesis': 'none',
      'font-weight': '400',
      'letter-spacing': 'normal',
      'line-height': 'var(--ov-lh-16)',
    });
  });

  it('makes the header 41 px at the least, 6 px above and below and 12 px at the sides, the title and Close 8 px apart, and it never shrinks', () => {
    expect(rule('.header')).toMatchObject({
      display: 'flex',
      'align-items': 'center',
      gap: 'var(--ov-spacing-8)',
      'box-sizing': 'border-box',
      flex: '0 0 auto',
      'min-height': '41px',
      padding: 'var(--ov-spacing-6) var(--ov-spacing-12)',
    });
  });

  it('draws the title 13/16 at weight 600 in the text colour, taking the room that is left so that Close sits at the end, and wraps what is long', () => {
    expect(rule('.title')).toMatchObject({
      flex: '1 1 auto',
      'min-width': '0',
      margin: '0',
      'font-size': 'var(--ov-fs-13)',
      'line-height': 'var(--ov-lh-16)',
      'font-weight': '600',
      color: 'var(--ov-fg)',
      'overflow-wrap': 'anywhere',
    });
  });

  it('fills the rest of the frame with the body, which clips and has no padding: the consumer lays out its own columns and scrollers', () => {
    const body = rule('.body');
    expect(body).toMatchObject({ flex: '1 1 auto', 'min-height': '0', 'min-width': '0', overflow: 'hidden' });
    for (const property of ['padding', 'padding-block', 'padding-inline', 'margin', 'border']) {
      expect(body[property], property).toBeUndefined();
    }
  });

  it('gives the body\'s one child the whole of it: a single track, so a column layout fills it and a scroller inside has a height to scroll in', () => {
    expect(rule('.body')).toMatchObject({ display: 'grid', 'grid-template': 'minmax(0, 1fr) / minmax(0, 1fr)' });
  });

  it('has no z-index, no transition, no animation, no transform, no filter and no media query: the top layer needs no stacking, nothing moves, and reduced motion has nothing to change', () => {
    const properties: string[] = [];
    const atRules: string[] = [];
    postcss.parse(css).walkDecls((declaration) => {
      properties.push(declaration.prop);
    });
    postcss.parse(css).walkAtRules((atRule) => {
      atRules.push(atRule.name);
    });
    expect(properties.filter((property) => /^(?:z-index|transition|animation|transform|translate|scale|rotate|filter|backdrop|will-change)/.test(property))).toEqual([]);
    expect(atRules).toEqual(['layer']);
  });

  it('writes no hex, no colour function and nothing important: the colours are tokens and keywords, and the stylelint config holds the closed scales', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    expect(css).not.toContain('!important');
  });
});
