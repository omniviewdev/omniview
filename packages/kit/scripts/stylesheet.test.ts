import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStylesheet, declaredLayerOrder, definedTokens } from './stylesheet.ts';

const ORDER = ['ov.tokens', 'ov.reset', 'ov.base', 'ov.plugin', 'ov.components', 'ov.shell'];
const STATEMENT = `@layer ${ORDER.join(', ')};`;
const GOOD = `${STATEMENT}
@layer ov.tokens { :root { --ov-fg: #FFFFFF; --ov-bg-window: #000000; } }
@layer ov.components { .a { color: var(--ov-fg); background: var(--ov-bg-window); --_local: 1px; } }
@font-face { font-family: x; src: url(x.woff2); }
`;

describe('declaredLayerOrder', () => {
  it('is the one statement of src/styles/layers.css', async () => {
    const css = await readFile(path.join(import.meta.dirname, '../src/styles/layers.css'), 'utf8');
    expect(declaredLayerOrder(css)).toEqual(ORDER);
  });

  it('refuses a file with no statement or with two', () => {
    expect(() => declaredLayerOrder('@layer ov.base { a { b: c } }')).toThrow(/exactly one/);
    expect(() => declaredLayerOrder('@layer a, b; @layer c, d;')).toThrow(/exactly one/);
  });
});

describe('checkStylesheet', () => {
  it('accepts a stylesheet that keeps the contract', () => {
    expect(checkStylesheet(GOOD, ORDER)).toEqual([]);
    expect([...definedTokens(GOOD)].sort()).toEqual(['--ov-bg-window', '--ov-fg']);
  });

  it('fails when the order statement is not the first rule, or differs', () => {
    expect(checkStylesheet(`@layer ov.tokens { :root { --ov-fg: #FFFFFF; } }\n${STATEMENT}`, ORDER)).toContainEqual(
      expect.stringContaining('the first rule must be'),
    );
    expect(checkStylesheet('@layer ov.base, ov.tokens;', ORDER)).toContainEqual(expect.stringContaining('the first rule must be'));
  });

  it('fails when the order is declared twice', () => {
    expect(checkStylesheet(`${GOOD}\n@layer ov.base, ov.shell;`, ORDER)).toContainEqual(expect.stringContaining('a second layer order statement'));
  });

  it('fails on a rule outside every layer', () => {
    expect(checkStylesheet(`${GOOD}\n.b { color: red; }`, ORDER)).toContainEqual('an unlayered rule: .b');
    expect(checkStylesheet(`${GOOD}\n@media (min-width: 1px) { .b { color: red; } }`, ORDER)).toContainEqual('an unlayered rule: @media');
  });

  it('fails on a layer that is not declared, which would sort after all of them', () => {
    expect(checkStylesheet(`${GOOD}\n@layer ov.componnets { .b { color: red; } }`, ORDER)).toContainEqual(
      expect.stringContaining('@layer ov.componnets is not a declared layer'),
    );
  });

  it('fails when a token is defined anywhere but ov.tokens', () => {
    expect(checkStylesheet(`${GOOD}\n@layer ov.components { :root { --ov-fg: red; } }`, ORDER)).toContainEqual('--ov-fg is defined outside ov.tokens');
  });

  it('fails when a token is read and not defined, with or without a fallback', () => {
    const misspelled = `${GOOD}\n@layer ov.components { .b { color: var(--ov-fg-mutd); } .c { color: var(--ov-fgg, red); } }`;
    expect(checkStylesheet(misspelled, ORDER)).toEqual([
      '--ov-fg-mutd is read by `color` but defined nowhere',
      '--ov-fgg is read by `color` but defined nowhere',
    ]);
  });

  it('fails on !important', () => {
    expect(checkStylesheet(`${GOOD}\n@layer ov.components { .b { color: var(--ov-fg) !important; } }`, ORDER)).toContainEqual('!important on color');
  });
});
