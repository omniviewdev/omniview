import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';

const css = await readFile(path.join(import.meta.dirname, 'Field.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);
const ROW = '.root[data-ov-layout=\'row\']';

// The row layout (design 16 S126, S127): the mock's `.setting-row--setting` (base.css 1527 to 1541) with the settings page's own overrides (the 20 px gutter,
// the glyph of the lane hung in it, the slot of 24 px, the title of a row that cannot change: shell-page-settings.css 35 to 42). The old two layouts are
// judged by Field.test.tsx; these are the rules that are the row's alone.
describe('the stylesheet of the row layout', () => {
  it('is a flex row that sets its height from its content: the columns 16 px apart, 6 px of padding, 40 px at least, the control top-aligned', () => {
    const root = rule(ROW);
    expect(root.display).toBe('flex');
    expect(root['align-items']).toBe('flex-start');
    expect(root.gap).toBe('var(--ov-spacing-16)');
    expect(root['box-sizing']).toBe('border-box');
    expect(root['min-height']).toBe('40px');
    expect(root['padding-block']).toBe('var(--ov-spacing-6)');
  });

  it('leaves a gutter of 20 px at the start, in which the glyph of the lane hangs, so that every message starts where the title starts', () => {
    expect(rule(ROW)['padding-inline-start']).toBe('var(--ov-spacing-20)');
    expect(rule(`${ROW} .lane`).position).toBe('relative');
    const glyph = rule(`${ROW} .lane > svg`);
    expect(glyph.position).toBe('absolute');
    expect(glyph['inset-inline-start']).toBe('calc(-1 * var(--ov-spacing-20))');
    expect(glyph['inset-block-start']).toBe('0');
  });

  it('is as wide as its place and as tall as its content, whatever the container does with a flex item: it never grows, so a list that is taller than its rows stretches none', () => {
    const root = rule(ROW);
    expect(root.flex).toBe('0 0 auto');
    expect(root.width).toBe('100%');
  });

  it('puts the title, the description and the lane in a column that takes what the control leaves, and may shrink below its content', () => {
    const text = rule('.text');
    expect(text.display).toBe('flex');
    expect(text['flex-direction']).toBe('column');
    expect(text.flex).toBe('1 1 auto');
    expect(text['min-width']).toBe('0');
  });

  it('sets the title in weight 600, and keeps it legible when the row cannot change: the control is the dimmed part and the reason is the lane (design SP-16)', () => {
    expect(rule('.text > .label')['font-weight']).toBe('600');
    expect(rule('.text > .label')['overflow-wrap']).toBe('anywhere');
    expect(rule('.root[data-ov-unavailable=\'true\'] .text > .label').color).toBe('var(--ov-fg-muted)');
  });

  it('clamps the description to two lines of 16 px, hiding the rest: its height is one or two lines and never three', () => {
    const help = rule(`${ROW} .help`);
    expect(help.display).toBe('-webkit-box');
    expect(help['-webkit-box-orient']).toBe('vertical');
    expect(help['-webkit-line-clamp']).toBe('2');
    expect(help['line-clamp']).toBe('2');
    expect(help.overflow).toBe('hidden');
  });

  it('puts the control and then the slot at the end of the row, top-aligned and 8 px apart, and takes no more room than they need', () => {
    const control = rule('.control');
    expect(control.display).toBe('flex');
    expect(control['align-items']).toBe('flex-start');
    expect(control.gap).toBe('var(--ov-spacing-8)');
    expect(control.flex).toBe('0 0 auto');
    expect(control['margin-inline-start']).toBe('auto');
    expect(control['min-width']).toBe('0');
  });

  it('gives a select in the control column the 200 px the mock gives it in a row: its own minimum names a percentage that a column as wide as its contents cannot resolve', () => {
    expect(rule(`${ROW} .control > [data-ov-part='select'][data-ov-width='normal']`)['min-width']).toBe('200px');
  });

  it('reserves the trailing slot at 24 by 24 px with 2 px above and below, in every state, so that what it comes to hold moves nothing', () => {
    const slot = rule('.trailing');
    expect(slot.display).toBe('flex');
    expect(slot.flex).toBe('0 0 24px');
    expect(slot.width).toBe('24px');
    expect(slot.height).toBe('24px');
    expect(slot['margin-block']).toBe('var(--ov-spacing-2)');
    expect(slot['align-items']).toBe('center');
    expect(slot['justify-content']).toBe('center');
  });

  it('keeps the focus ring of what the slot holds inside the slot: the row has no room beyond its end (shell-page-settings.css 40)', () => {
    expect(rule(`${ROW} .trailing > :focus-visible`)['outline-offset']).toBe('-2px');
  });

  it('writes no colour of its own, no z-index and no animation of geometry', () => {
    const own = cssRules(css).filter((entry) => entry.selector.includes(ROW) || /^\.(?:text|control|trailing)\b/.test(entry.selector) || entry.selector.includes('.text >') || entry.selector.includes('.trailing >'));
    expect(own.length).toBeGreaterThanOrEqual(9);
    for (const entry of own) {
      for (const [property, value] of Object.entries(entry.declarations)) {
        if (property.endsWith('color')) {
          expect(value, `${entry.selector} ${property}`).toMatch(/^var\(--ov-[a-z0-9-]+\)$/);
        }

        expect(property, entry.selector).not.toMatch(/^(?:z-index|transition|animation)/);
      }
    }
  });
});
