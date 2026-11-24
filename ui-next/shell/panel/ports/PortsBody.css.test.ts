import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The height of a row is decided in the stylesheet, and jsdom has no layout, no cascade layers and no second engine to tell WebKit from Chromium: what is checked here is the stylesheet as TEXT (as the Terminal's find bar's is,
// `find/FindBar.css.test.tsx`), the two rules a row's height rests on. What a row comes to in each engine is the probe's (`ports.rows`, in WebKit and in Chromium): that is the proof, and this is the guard that keeps the cause out.
//
// The cause: a cell is one line of 16 px, and a box in that line that sits on the baseline lifts the line above 16 px when its baseline is not the strut's. Two cells hold such a box: the state (the kit's inline-flex, aligned by its
// middle) and the mapping (a span in the code face, whose 16 px box has another font's ascent and descent). The row was 25.17 px in WebKit and 25.45 px in Chromium, where the design's is 24. A box aligned to the top of its line takes no
// part in the baseline, the line is the strut's 16 px, and the row is that and the 4 px above and below.

const css = await readFile(path.join(import.meta.dirname, 'PortsBody.module.css'), 'utf8');

type Declarations = Readonly<Partial<Record<string, string>>>;
type Rule = { readonly selector: string; readonly declarations: Declarations };

/** The rules of a stylesheet's text, in its order and whatever layer they are in, each with its selector (in single quotes, on one line) and its declarations by property. */
function rulesOf(text: string): Rule[] {
  const bare = text.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim().replaceAll(/\s+/g, ' ').replaceAll('"', '\''),
    declarations: Object.fromEntries(
      body
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration !== '')
        .map((declaration) => [declaration.slice(0, declaration.indexOf(':')).trim(), declaration.slice(declaration.indexOf(':') + 1).trim()]),
    ),
  }));
}

/** The vertical alignment the rules of a selector give, as the cascade reads them: the last of the rules that say one, a later rule of the same selector winning. `undefined` when the stylesheet has no such rule, or none says anything of it. */
const alignmentOf = (text: string, selector: string): string | undefined =>
  rulesOf(text)
    .filter((rule) => rule.selector === selector)
    .map((rule) => rule.declarations['vertical-align'])
    .filter((value) => value !== undefined)
    .at(-1);

describe('how the check reads a stylesheet', () => {
  it('finds the alignment a rule gives, and tells a rule that is not there, and a rule that says nothing of it, from one that says something else', () => {
    const sheet = '/* a comment { with: braces } */ @layer x { .a > * { vertical-align: top } .b { color: red; vertical-align: middle; } .c { color: red } }';
    expect(alignmentOf(sheet, '.a > *')).toBe('top');
    expect(alignmentOf(sheet, '.b')).toBe('middle');
    expect(alignmentOf(sheet, '.c')).toBeUndefined();
    expect(alignmentOf(sheet, '.d')).toBeUndefined();
  });

  it('reads a selector with double quotes as the same selector with single quotes, over lines', () => {
    expect(alignmentOf('@layer x {\n  .cell[data-column="status"]\n    > * { vertical-align: top; }\n}', '.cell[data-column=\'status\'] > *')).toBe('top');
  });
});

describe('the Ports stylesheet', () => {
  it('puts the box of the state cell on the top of its line: the line stays 16 px and the row 24', () => {
    expect(alignmentOf(css, '.cell[data-column=\'status\'] > *')).toBe('top');
  });

  it('puts the code-face span of the mapping cell on the top of its line, for the same reason', () => {
    expect(alignmentOf(css, '.cell[data-column=\'mapping\'] > span')).toBe('top');
  });

  // The cell itself stays in the middle of the row: it is the cell's own box, and the row's height is its block size, which the two rules above leave as it is.
  it('keeps the cell in the middle of the row', () => {
    expect(alignmentOf(css, '.cell')).toBe('middle');
  });
});

/** The selectors of a rule's list, each one whole: a comma inside the parentheses of a function does not split one. */
const listOf = (rule: Rule): string[] => rule.selector.split(/,\s*(?![^(]*\))/).map((part) => part.trim());

/** The declarations of the rules that have this selector in their list, as the cascade reads them: a property is what the last rule that says it says, and nothing when no rule has the selector. */
const declaredFor = (text: string, selector: string): Declarations =>
  Object.fromEntries(
    rulesOf(text)
      .filter((rule) => listOf(rule).includes(selector))
      .flatMap((rule) => Object.entries(rule.declarations)),
  );

describe('how the check reads two rules for one selector', () => {
  it('reads the last of them, which the cascade uses: a later rule that says middle undoes the top that an earlier one says', () => {
    expect(alignmentOf('@layer x { .a > * { vertical-align: top } .a > * { vertical-align: middle } }', '.a > *')).toBe('middle');
    expect(alignmentOf('@layer x { .a > * { vertical-align: top } .a > * { color: red } }', '.a > *')).toBe('top');
  });

  it('reads a property as the last rule that says it says it, and keeps what an earlier rule says of the others', () => {
    expect(declaredFor('.a { color: red; position: sticky } .a { color: blue }', '.a')).toEqual({ color: 'blue', position: 'sticky' });
  });
});

/** The widths, in percent, that the rules for a column give. */
const sharesOf = (text: string): string[] =>
  rulesOf(text)
    .filter((rule) => rule.selector.includes('data-column'))
    .map((rule) => rule.declarations['inline-size'] ?? '')
    .filter((width) => /^\d+(?:\.\d+)?%$/.test(width));

// What the columns are sized by (the mock's fit: `fitSolve`, in its core.js, with no script). FIXED columns are their content: Mapping, Status and the commands, and Connection while no forward names one (a column of dashes is a fixed column in the
// mock too), each a width of 1% over a text that does not wrap. FLEXIBLE columns are Resource and, once a forward names a connection, Connection: they ask for no width, so the automatic layout gives each the widest line of its content and, when the
// table is wider than all of them, shares the extra in proportion to those widths, which is the mock's `nat + (avail - natural) * nat / total`. What a flexible cell shows sits in a box whose least is zero and whose most is its content (`.fit`), so
// that the column asks for the room its names need and gives it back when the table is narrower, down to the floor of its head (a measure of text, with the insets of its cell: 160 px for Resource, 72 + 2 x 10 for Connection). None is a share of
// the table (a Connection column of 40% put Mapping at 620 px where the mock's stands at 888).
describe('the Ports stylesheet: how the columns are sized', () => {
  const FIXED = '[data-column=\'mapping\'], [data-column=\'status\'], [data-column=\'actions\']';
  const DASHES = '.table:not([data-ports-names]) :is(.head, .cell)[data-column=\'connection\']';
  const NAMED = '.table[data-ports-names] .head[data-column=\'connection\']';

  it('lets the Resource column take its share of what the others leave: it asks for no width, and keeps a floor of 160 px', () => {
    const head = declaredFor(css, '.head[data-column=\'resource\']');
    expect(head['inline-size']).toBeUndefined();
    expect(head['min-inline-size']).toBe('160px');
  });

  it.each(['.head', '.cell'])('fits Mapping, Status and the commands to their content: the %s of each asks for one percent', (cell) => {
    expect(declaredFor(css, `${cell}:is(${FIXED})`)['inline-size']).toBe('1%');
  });

  it('fits the Connection column to its content while no forward names a connection: a column of dashes is a fixed column', () => {
    expect(declaredFor(css, DASHES)['inline-size']).toBe('1%');
  });

  it('lets the Connection column share the room once a forward names a connection: it asks for no width, and keeps a floor of 72 px of text and the two 10 px insets of its cell', () => {
    const head = declaredFor(css, NAMED);
    expect(head['inline-size']).toBeUndefined();
    expect(head['min-inline-size']).toBe('92px');
    const always = rulesOf(css).filter((rule) => listOf(rule).some((selector) => selector.includes('[data-column=\'connection\']') && !selector.includes('[data-ports-names]')));
    expect(always.length).toBeGreaterThan(0);
    expect(always.every((rule) => rule.declarations['inline-size'] === undefined)).toBe(true);
  });

  it('sizes no column as a share of the table but the 1% that fits it', () => {
    expect(new Set(sharesOf(css))).toEqual(new Set(['1%']));
  });

  it('finds a share that is not 1%: the check trips on the sizes the Connection column had', () => {
    expect(sharesOf('.head[data-column=\'resource\'] { inline-size: 60%; } .head[data-column=\'connection\'] { inline-size: 40%; }')).toEqual(['60%', '40%']);
  });

  it('holds what a flexible cell shows in a box whose least is zero and whose most is its content: the column asks for what its names need, and gives it back', () => {
    const fit = declaredFor(css, '.fit');
    expect(fit.display).toBe('grid');
    expect(fit['grid-template-columns']).toBe('minmax(0, max-content)');
  });

  it('caps the weight of the Resource column at the mock\'s 240 px text cap and the insets of its cell, on the cell and not on its content: a name that is wider asks for no more room than that, and still shows as much as the column has', () => {
    const cell = declaredFor(css, '.cell[data-column=\'resource\']');
    expect(cell['max-inline-size']).toBe('calc(240px + var(--ov-spacing-12) + 10px)');
    // What the cell shows is not held to the cap: the box of the content is as wide as the column, so a name is cut where the column ends and not at 240 px.
    expect(declaredFor(css, '.fit')['max-inline-size']).toBeUndefined();
    expect(declaredFor(css, '.cell[data-column=\'resource\'] .fit')['max-inline-size']).toBeUndefined();
  });

  it('cuts a name of a connection at the mock\'s 240 px, in the box that holds it, and does not hold the cell to a width of zero', () => {
    expect(declaredFor(css, '.cell[data-column=\'connection\']')['max-inline-size']).toBeUndefined();
    expect(declaredFor(css, '.cell[data-column=\'connection\'] .clipped')['max-inline-size']).toBe('240px');
  });

  it('pins the Resource column to the start of the scroller, on the panel\'s plane, and its head above the other heads', () => {
    const cell = declaredFor(css, '.cell[data-column=\'resource\']');
    expect(cell.position).toBe('sticky');
    expect(cell['inset-inline-start']).toBe('0');
    expect(cell['background-color']).toBe('var(--ov-bg-island)');
    const head = declaredFor(css, '.head[data-column=\'resource\']');
    expect(head['inset-inline-start']).toBe('0');
    const sticky = rulesOf(css)
      .filter((rule) => listOf(rule).includes('.head'))
      .map((rule) => rule.declarations['z-index'])
      .find((value) => value !== undefined);
    expect(Number(head['z-index'])).toBeGreaterThan(Number(sticky));
  });
});

describe('the Ports stylesheet: what it says of the empty state and of the focus', () => {
  it('sets the hint of the empty state in the secondary text of the design, 12 and 16, where the kit\'s compact state gives its hint the body size', () => {
    const hint = declaredFor(css, '.ports [data-ov-part=\'hint\']');
    expect(hint['font-size']).toBe('var(--ov-fs-12)');
    expect(hint['line-height']).toBe('var(--ov-lh-16)');
  });

  it('draws the ring of the scroller, which the host gives the focus to when it puts a menu away, inside the scroller: the shell\'s ring, 2 px of the accent, inset', () => {
    const ring = declaredFor(css, '.scroll:focus-visible');
    expect(ring.outline).toBe('2px solid var(--ov-accent)');
    expect(ring['outline-offset']).toBe('-2px');
  });
});

describe('the Ports stylesheet: the ring of the body', () => {
  it('draws the shell\'s ring inside the body too, which takes the keyboard while the list is read again: the same ring as the scroller\'s', () => {
    const ring = declaredFor(css, '.ports:focus-visible');
    expect(ring.outline).toBe('2px solid var(--ov-accent)');
    expect(ring['outline-offset']).toBe('-2px');
  });
});
