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

  // The mock's Time column is `--plog-time: 112px` and, for UTC, 120 px (shell-panel.css 92 and 93: the clock is 8 px wider with its Z). The kit's column is the same custom property on the root, and the head follows it.
  it('is 112 px wide, and 120 px when the view shows UTC (the Z is one character more), in the rows and in the head', () => {
    expect(rule('.root')['--_time']).toBe('112px');
    expect(rule('.root[data-ov-timestamps=\'utc\']')['--_time']).toBe('120px');
    expect(rule('.time').flex).toBe('0 0 var(--_time)');
    expect(rule('.head[data-ov-column=\'time\']')['flex-basis']).toBe('var(--_time)');
  });
});

describe('the Source column (the mock\'s Logs table of a session with more than one source: shell-panel.css 103, base.css 1368 and 1585, shell-panel.js 332 and 1702)', () => {
  // Measured in the mock at 1440 x 900, both engines (L2): Time x 0 w 112, Level x 112 w 96, Source x 208 w 168, Message x 376; a head 25 px high, its cells 24 px; the chip 18 px high at the cell's 10 px
  // inset (x 218) and 3 px under the row's top, its swatch 8 x 8 at 7 px into the chip (1 px edge and 6 px inset), the name 4 px after it; a name too long for the cell fills it (148 px of chip).
  it('is 168 px wide with the 10 px inset of every cell, in the head as in the rows, and takes no more or less room than that', () => {
    expect(rule('.root')['--_source']).toBe('168px');
    expect(rule('.source').flex).toBe('0 0 var(--_source)');
    expect(rule('.source')['padding-inline']).toBe('10px');
    expect(rule('.source')['box-sizing']).toBe('border-box');
    expect(rule('.head[data-ov-column=\'source\']')['flex-basis']).toBe('var(--_source)');
  });

  it('draws the chip as the mock\'s `.chip`: 12/16 muted type, a 1 px subtle edge, the control radius, a 6 px inset, a 4 px gap, one line that gives way to the cell', () => {
    const chip = rule('.chip');
    expect(chip['font-size']).toBe('var(--ov-fs-12)');
    expect(chip['line-height']).toBe('var(--ov-lh-16)');
    expect(chip.color).toBe('var(--ov-fg-muted)');
    expect(chip.border).toBe('1px solid var(--ov-border-subtle)');
    expect(chip['border-radius']).toBe('var(--ov-radius-control)');
    expect(chip.padding).toBe('0 var(--ov-spacing-6)');
    expect(chip.gap).toBe('var(--ov-spacing-4)');
    expect(chip['white-space']).toBe('nowrap');
    expect(chip['max-width']).toBe('100%');
    expect(chip['min-width']).toBe('0');
    // The mock's chip has no fill.
    expect(chip['background-color']).toBeUndefined();
  });

  it('draws the swatch as the mock\'s `.swatch`: an 8 px square with the mark radius (2 px), in the hue of the source', () => {
    const swatch = rule('.chip::before');
    expect(swatch.width).toBe('8px');
    expect(swatch.height).toBe('8px');
    expect(swatch.flex).toBe('0 0 8px');
    expect(swatch['border-radius']).toBe('var(--ov-radius-mark)');
    expect(swatch['background-color']).toBe('var(--_accent)');
  });

  // The mock's `dataHues` (core.js 253) are `--blue`, `--green`, `--amber`, `--purple`, `--cyan`, `--red` and the muted foreground; the kit's roles carry the same values in its default theme
  // (#71A1FE, #6DB083, #D59637, #A894F6, #6AAEA6, #F57E84 and #9FA2A8), and are the roles the hues of an ANSI span already take (`.plog__a`).
  it('maps the seven hues of the series to the roles the hues of an ANSI span take, so a chip and a coloured span of one hue agree', () => {
    const roles = { blue: '--ov-link', green: '--ov-success-fg', amber: '--ov-warning-fg', purple: '--ov-chart-purple', cyan: '--ov-chart-teal', red: '--ov-error-fg', gray: '--ov-fg-muted' } as const;
    for (const [hue, role] of Object.entries(roles)) {
      expect(rule(`.chip[data-ov-hue='${hue}']`)['--_accent'], hue).toBe(`var(${role})`);
      expect(rule(`.text [data-ov-hue='${hue}']`).color, hue).toBe(`var(${role})`);
    }
  });

  it('is not the reader\'s to select, as the clock and the level are not (the old viewer: badges and timestamps `user-select: none`, HLT-18)', () => {
    expect(rule('.source')['user-select']).toBe('none');
  });
});
