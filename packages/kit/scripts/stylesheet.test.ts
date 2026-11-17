import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStylesheet, declaredLayerOrder, definedTokens, fontFiles, HOST_FONT_URL } from './stylesheet.ts';

const ORDER = ['ov.tokens', 'ov.reset', 'ov.base', 'ov.plugin', 'ov.components', 'ov.shell'];
const STATEMENT = `@layer ${ORDER.join(', ')};`;
const GOOD = `${STATEMENT}
@layer ov.tokens { :root { --ov-fg: #FFFFFF; --ov-bg-window: #000000; } }
@layer ov.components { .a { color: var(--ov-fg); background: var(--ov-bg-window); --_local: 1px; } }
@font-face { font-family: x; src: url("./fonts/x.woff2") format("woff2"); }
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

  it('fails on a font inlined as a data URI: the files ship beside the stylesheet, never inside it', () => {
    const inlined = `${GOOD}\n@font-face { font-family: y; src: url("data:font/woff2;base64,AAAA") format("woff2"); }`;
    expect(checkStylesheet(inlined, ORDER)).toContainEqual(expect.stringContaining('inlined'));
  });

  it('fails on a font that is not a WOFF2 file under ./fonts/', () => {
    for (const source of ['url("/fonts/y.woff2")', 'url("./y.woff2")', 'url("./fonts/y.otf")', 'url("https://example.test/y.woff2")', 'url("./fonts/../y.woff2")']) {
      expect(checkStylesheet(`${GOOD}\n@font-face { font-family: y; src: ${source} format("woff2"); }`, ORDER), source).toContainEqual(expect.stringContaining('./fonts/'));
    }
  });

  it('takes the host bundler URL for a font only when asked: hashed under /assets/', () => {
    const hostBuild = GOOD.replace('./fonts/x.woff2', '/assets/x-D-AKqIY-.woff2');
    expect(checkStylesheet(hostBuild, ORDER)).toContainEqual(expect.stringContaining('./fonts/'));
    expect(checkStylesheet(hostBuild, ORDER, HOST_FONT_URL)).toEqual([]);
    expect(checkStylesheet(GOOD.replace('./fonts/x.woff2', '/elsewhere/x.woff2'), ORDER, HOST_FONT_URL)).toContainEqual(expect.stringContaining('assets'));
  });
});

describe('fontFiles', () => {
  it('names the files the font faces of a stylesheet refer to, once each', () => {
    const css = `${GOOD}\n@font-face { font-family: y; src: url('./fonts/y.woff2') format("woff2"); }\n@font-face { font-family: y; src: url(./fonts/x.woff2); }`;
    expect(fontFiles(css)).toEqual(['x.woff2', 'y.woff2']);
    expect(fontFiles(STATEMENT)).toEqual([]);
  });
});
