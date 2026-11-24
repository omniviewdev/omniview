import { cleanup, render } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { FindBar } from './FindBar';
import styles from './FindBar.module.css';
import { INITIAL_FIND } from './findModel';

// The bar's width is decided in its stylesheet, and jsdom has no layout, no cascade layers and no second engine to tell WebKit from Chromium: what is checked here is the stylesheet as TEXT (as the Settings window's is,
// `WindowSurface.css.test.ts`), the rules the bar's width rests on. What the widths come to in each engine is the probe's (`find.open`, in WebKit and in Chromium): that is the proof, and this is the guard that keeps the cause out.
//
// The cause: WebKit sizes a box that is positioned absolutely, as the bar is, from the PREFERRED widths of its parts. A part with a width has it; a part with none has its content's widest line; a flex basis is not read there.
// The field's box held the kit's field (an input and a count lane of 100 px, wider than the box) and said only `flex: 0 1 280px`, so the bar was 562 px in WebKit where its parts add up to 482, with 80 px of empty bar after
// "Close find". Chromium reads the basis and drew 482.

const css = await readFile(path.join(import.meta.dirname, 'FindBar.module.css'), 'utf8');

type Declarations = Readonly<Partial<Record<string, string>>>;
type Rule = { readonly selector: string; readonly declarations: Declarations };
type Flex = { readonly grow: number; readonly shrink: number; readonly basis: string };

/** The rules of a stylesheet's text, in its order and whatever layer they are in, each with its declarations by property. */
function rulesOf(text: string): Rule[] {
  const found: Rule[] = [];
  postcss.parse(text).walkRules((rule) => {
    const declarations: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
    found.push({ selector: rule.selector, declarations });
  });
  return found;
}

const NUMBER = /^\d+(?:\.\d+)?$/;
const LENGTH = /^\d+(?:\.\d+)?px$/;

/** What a `flex` shorthand comes to, as the specification reads it: a number alone is a grow factor over a basis of 0%, a length alone is a basis with a grow factor of 1, and a part that is not said is 1, 1 and 0%. */
function shorthand(value: string): Flex {
  switch (value) {
    case 'none':
      return { grow: 0, shrink: 0, basis: 'auto' };
    case 'auto':
      return { grow: 1, shrink: 1, basis: 'auto' };
    case 'initial':
      return { grow: 0, shrink: 1, basis: 'auto' };
    default: {
      const parts = value.split(/\s+/);
      const factors = parts.filter((part) => NUMBER.test(part)).map(Number);
      return { grow: factors[0] ?? 1, shrink: factors[1] ?? 1, basis: parts.find((part) => !NUMBER.test(part)) ?? '0%' };
    }
  }
}

/** What a box's `flex`, or its longhands (which win over the shorthand), come to; `undefined` for a box that says nothing about flex. */
function flexOf(declarations: Declarations): Flex | undefined {
  const { flex, 'flex-grow': grow, 'flex-shrink': shrink, 'flex-basis': basis } = declarations;
  if (flex === undefined && grow === undefined && shrink === undefined && basis === undefined) {
    return undefined;
  }

  const read: Flex = flex === undefined ? { grow: 0, shrink: 1, basis: 'auto' } : shorthand(flex.trim());
  return { grow: grow === undefined ? read.grow : Number(grow), shrink: shrink === undefined ? read.shrink : Number(shrink), basis: basis ?? read.basis };
}

/** The selectors of the boxes that give a flex basis in pixels and no width of the same size: the boxes WebKit sizes the bar wrongly from. */
function basesWithoutWidth(found: readonly Rule[]): string[] {
  return found
    .filter((rule) => {
      const basis = flexOf(rule.declarations)?.basis;
      return basis !== undefined && LENGTH.test(basis) && rule.declarations['inline-size'] !== basis && rule.declarations.width !== basis;
    })
    .map((rule) => rule.selector);
}

const rules = rulesOf(css);

/** The declarations of the one rule a selector has in the stylesheet. */
function declared(selector: string): Declarations {
  const found = rules.filter((rule) => rule.selector === selector);
  expect(found, `${selector} has one rule`).toHaveLength(1);
  return found[0]?.declarations ?? {};
}

afterEach(() => {
  cleanup();
});

describe('how the checks read a box\'s flex', () => {
  it.each<[string, Record<string, string>, Flex | undefined]>([
    ['nothing when the box says nothing about flex', { display: 'flex' }, undefined],
    ['the shorthand with its three parts', { flex: '0 1 280px' }, { grow: 0, shrink: 1, basis: '280px' }],
    ['a basis that is auto', { flex: '0 1 auto' }, { grow: 0, shrink: 1, basis: 'auto' }],
    ['none as a box that neither grows nor shrinks', { flex: 'none' }, { grow: 0, shrink: 0, basis: 'auto' }],
    ['auto as a box that does both', { flex: 'auto' }, { grow: 1, shrink: 1, basis: 'auto' }],
    ['a number alone as a grow factor over a basis of 0%', { flex: '2' }, { grow: 2, shrink: 1, basis: '0%' }],
    ['a length alone as a basis with a grow factor of 1', { flex: '280px' }, { grow: 1, shrink: 1, basis: '280px' }],
    ['a grow factor and a basis', { flex: '0 280px' }, { grow: 0, shrink: 1, basis: '280px' }],
    ['a shrink factor of 0', { flex: '1 0 200px' }, { grow: 1, shrink: 0, basis: '200px' }],
    ['the longhands', { 'flex-basis': '280px', 'flex-shrink': '0' }, { grow: 0, shrink: 0, basis: '280px' }],
    ['a longhand over the shorthand', { flex: '0 1 auto', 'flex-basis': '280px' }, { grow: 0, shrink: 1, basis: '280px' }],
  ])('reads %s', (_what, declarations, expected) => {
    expect(flexOf(declarations)).toEqual(expected);
  });
});

// Negative controls (a check must trip on the fault it is named for, and on nothing else): the box as it was, in a sheet of its own, is found; the same box with the width its basis says is not.
describe('the check for a flex basis in pixels with no width of its size', () => {
  const found = (text: string): string[] => basesWithoutWidth(rulesOf(`@layer x { ${text} }`));

  it('finds the field\'s box as it was: a basis of 280 px and no width', () => {
    expect(found('.field { display: flex; flex: 0 1 280px; min-inline-size: 200px; }')).toEqual(['.field']);
  });

  it('finds a basis written as a longhand, and a width that is not the basis', () => {
    expect(found('.a { flex-basis: 280px; }')).toEqual(['.a']);
    expect(found('.a { flex: 0 1 280px; inline-size: 200px; }')).toEqual(['.a']);
    expect(found('.a { flex: 0 1 280px; width: 200px; }')).toEqual(['.a']);
  });

  it('finds each box that is wrong and none that is right', () => {
    expect(found('.a { flex: 0 1 280px; } .b { flex: 0 1 100px; inline-size: 100px; } .c { flex: 1 1 40px; }')).toEqual(['.a', '.c']);
  });

  it('finds nothing in a box with the width its basis says, as `inline-size` or as `width`', () => {
    expect(found('.field { display: flex; flex: 0 1 280px; inline-size: 280px; min-inline-size: 0; }')).toEqual([]);
    expect(found('.a { flex: 0 1 280px; width: 280px; }')).toEqual([]);
  });

  it('finds nothing in a box whose basis is not a length: auto and a share of the bar are not read from a width', () => {
    expect(found('.a { flex: 0 1 auto; } .b { flex: 1; } .c { flex: none; } .d { display: flex; }')).toEqual([]);
  });
});

describe('the find bar\'s stylesheet', () => {
  it('gives every box that has a flex basis in pixels a width of the same size: WebKit sizes the absolutely positioned bar from its parts\' widths and never from a basis', () => {
    expect(basesWithoutWidth(rules)).toEqual([]);
  });

  it('gives the field\'s box the 280 px of the written bar as its WIDTH, not only as its flex basis', () => {
    expect(declared('.field')['inline-size']).toBe('280px');
  });

  it('keeps the field\'s box shrinking, from a basis of 280 px, and never growing: it is the box that gives way when the bar is held to the room the panel has', () => {
    expect(flexOf(declared('.field'))).toEqual({ grow: 0, shrink: 1, basis: '280px' });
  });

  it('lets the field\'s box shrink as far as the bar needs, as the design mock\'s does: it has no least width of its own', () => {
    expect(declared('.field')['min-inline-size']).toBe('0');
  });

  it('leaves the bar as wide as its parts and no wider: no width of its own, and a cap at the panel\'s width less the inset the bar keeps on each side', () => {
    const bar = declared('.bar');
    for (const property of ['inline-size', 'width', 'min-inline-size', 'min-width', 'flex']) {
      expect(bar[property], property).toBeUndefined();
    }

    expect(bar.position).toBe('absolute');
    expect(bar['inset-inline-start']).toBe('var(--ov-spacing-12)');
    expect(bar['max-inline-size']).toBe('calc(100% - 2 * var(--ov-spacing-12))');
  });

  it('is the two rules of the two boxes the component draws, and no other: nothing in it is dead', () => {
    const classes = new Set(rules.flatMap((rule) => [...rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((found) => found[1])));
    expect([...classes].sort()).toEqual(['bar', 'field']);
    expect(rules).toHaveLength(2);
  });
});

describe('the bar the component draws', () => {
  const nothing = () => undefined;

  it('is the box of `.bar` and holds, in this order, the box of `.field` with the kit\'s field in it, and the row of buttons: the rules above are for these boxes, and the box of the field is a direct child of the bar', () => {
    render(<FindBar input={INITIAL_FIND} valid unavailable={false} result={undefined} platform="other" onQuery={nothing} onToggle={nothing} onStep={nothing} onFind={nothing} onClose={nothing} />);
    expect(styles.bar).toBeTruthy();
    expect(styles.field).toBeTruthy();
    const bar = document.querySelector('[data-shell-part="terminalFind"]');
    expect(bar).toHaveClass(styles.bar ?? '');
    const parts = [...(bar?.children ?? [])];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveClass(styles.field ?? '');
    expect(parts[0]?.querySelector('input[type="search"]')).not.toBeNull();
    expect(parts[1]).toHaveAttribute('role', 'group');
  });
});
