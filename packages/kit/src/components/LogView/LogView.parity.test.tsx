// What the log view does to look like the design mock's Logs tool body (design 16 S120). The parity probe (packages/kit/probes/log-probe.mjs) reads the pixels in WebKit and Chromium; jsdom has
// no layout, so what is asserted here is the CSS rule that makes it: each rule names the line of the mock's stylesheets that it answers.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declarationsOf } from '../../../scripts/cssRules.ts';

const css = await readFile(path.join(import.meta.dirname, 'LogView.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the cells of the list (the mock\'s table cells: base.css 1222-1235)', () => {
  // `th, td { padding: var(--int-row-pad) 10px }`, `th:first-child, td:first-child { padding-inline-start: 12px }`, `th:last-child, td:last-child { padding-inline-end: 12px }`:
  // the interior inset of a table cell is 10 px, and the first and last cell of a row take the 12 px of the table's edge. The clock is the first cell, the message the last.
  it('insets the clock 12 px at the start and 10 px at the end, the level 10 px both ways, and the message 10 px at the start and 12 px at the end', () => {
    expect(rule('.time')['padding-inline']).toBe('var(--ov-spacing-12) 10px');
    expect(rule('.level')['padding-inline']).toBe('10px');
    expect(rule('.text')['padding-inline']).toBe('10px var(--ov-spacing-12)');
  });

  it('insets the header cells as the cells below them, so a column head stands over its column', () => {
    expect(rule('.head')['padding-inline']).toBe('10px');
    expect(rule('.head[data-ov-column=\'time\']')['padding-inline-start']).toBe('var(--ov-spacing-12)');
    expect(rule('.head[data-ov-column=\'message\']')['padding-inline-end']).toBe('var(--ov-spacing-12)');
  });

  // The mock draws the clock in a `.dim` span inside its cell (`.plog__t--local`, shell-panel.css 108-111): the muted colour, as the column heads; the cell around it is the text colour.
  it('draws the clock in the muted colour and the rest of the row in the text colour', () => {
    expect(rule('.time').color).toBe('var(--ov-fg-muted)');
    expect(rule('.row').color).toBe('var(--ov-fg)');
    expect(rule('.level').color).toBeUndefined();
    expect(rule('.text').color).toBeUndefined();
  });
});
