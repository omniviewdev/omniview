import path from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

const root = path.join(import.meta.dirname, '..');
const configFile = path.join(root, 'stylelint.config.mjs');

async function lint(code: string, file = 'src/components/Probe/Probe.module.css'): Promise<string[]> {
  const result = await stylelint.lint({ code, codeFilename: path.join(root, file), configFile });
  return (result.results[0]?.warnings ?? []).map((warning) => warning.rule);
}

describe('the stylelint config accepts a stylesheet that uses the closed scales and the tokens', () => {
  it('passes', async () => {
    const css = `@layer ov.components {
      .a {
        --_swatch: 1;
        color: var(--ov-fg);
        background-color: var(--ov-bg-island);
        font: inherit;
        font-size: var(--ov-fs-13);
        line-height: var(--ov-lh-16);
        font-weight: 600;
        font-family: var(--ov-font-code);
        gap: var(--ov-spacing-8);
        padding: var(--ov-spacing-4) var(--ov-spacing-12);
        margin: 0 auto;
        border-radius: var(--ov-radius-island);
      }
      .b { border-radius: 50%; fill: var(--_swatch); }
    }`;
    expect(await lint(css)).toEqual([]);
  });
});

describe('the stylelint config rejects', () => {
  const cases: Array<[string, string, string]> = [
    ['the font shorthand', '.a { font: 14px/1.5 Arial; }', 'declaration-property-value-allowed-list'],
    ['a font size off the type scale', '.a { font-size: 14px; }', 'declaration-property-value-allowed-list'],
    ['a font size that is a literal of the scale', '.a { font-size: 13px; }', 'declaration-property-value-allowed-list'],
    ['a font weight of 500', '.a { font-weight: 500; }', 'declaration-property-value-allowed-list'],
    ['a unitless line height', '.a { line-height: 1.5; }', 'declaration-property-value-allowed-list'],
    ['letter spacing', '.a { letter-spacing: 0.08em; }', 'declaration-property-value-allowed-list'],
    ['spacing off the scale', '.a { padding: 5px; }', 'declaration-property-value-allowed-list'],
    ['a margin of 7px', '.a { margin: 0 7px; }', 'declaration-property-value-allowed-list'],
    ['a gap that is a literal of the scale', '.a { gap: 8px; }', 'declaration-property-value-allowed-list'],
    ['a radius off the scale', '.a { border-radius: 999px; }', 'declaration-property-value-allowed-list'],
    ['a hex colour', '.a { color: #fff; }', 'color-no-hex'],
    ['a named colour', '.a { color: red; }', 'color-named'],
    ['a colour function', '.a { background-color: rgb(0 0 0); }', 'function-disallowed-list'],
    ['a colour mix', '.a { background-color: color-mix(in srgb, var(--ov-fg), red); }', 'function-disallowed-list'],
    ['a token that is not defined', '.a { color: var(--ov-fg-mutd); }', 'no-unknown-custom-properties'],
    ['a fallback on a token', '.a { color: var(--ov-fg, red); }', 'declaration-property-value-disallowed-list'],
    ['a token declared outside the generated sheet', '.a { --ov-fg: red; }', 'property-disallowed-list'],
    ['a custom property that is not private', '.a { --swatch: 1; }', 'property-disallowed-list'],
    ['a rule for body', 'body { margin: 0; }', 'selector-disallowed-list'],
    ['a rule for html', 'html { margin: 0; }', 'selector-disallowed-list'],
    ['a rule for every element', '* { margin: 0; }', 'selector-disallowed-list'],
    ['!important', '.a { color: var(--ov-fg) !important; }', 'declaration-no-important'],
    ['an @import', '@import url(other.css);', 'at-rule-disallowed-list'],
    ['a backdrop filter', '.a { backdrop-filter: blur(4px); }', 'property-disallowed-list'],
  ];
  for (const [name, css, rule] of cases) {
    it(name, async () => {
      expect(await lint(css)).toContain(rule);
    });
  }
});

describe('the stylelint config makes three exceptions', () => {
  it('lets the font stylesheet name its families, and only the kit\'s two, only there', async () => {
    const face = '@font-face { font-family: \'Int UI Inter\'; src: url(\'../../fonts/Inter-Regular.latin.woff2\') format(\'woff2\'); font-style: normal; font-weight: 400; font-display: swap; unicode-range: U+0020-007E; }';
    expect(await lint(face, 'src/styles/fonts.css')).toEqual([]);
    expect(await lint('@font-face { font-family: \'Comic Sans\'; src: url(x.woff2); font-weight: 400; }', 'src/styles/fonts.css')).toContain('declaration-property-value-allowed-list');
    expect(await lint('@font-face { font-family: \'Int UI Inter\'; src: url(x.woff2); font-weight: 500; }', 'src/styles/fonts.css')).toContain('declaration-property-value-allowed-list');
    expect(await lint(face, 'src/components/Probe/Probe.module.css')).toContain('declaration-property-value-allowed-list');
  });

  it('lets the generated stylesheet define tokens and derive RGB surface paints, not mix arbitrary colours', async () => {
    expect(await lint('.a { --ov-fg: #D1D3D9; }', 'src/generated/tokens.css')).toEqual([]);
    expect(await lint('.a { --ov-surface-content: rgb(25 26 28 / 94%); }', 'src/generated/tokens.css')).toEqual([]);
    expect(await lint('.a { --ov-surface-content: color-mix(in srgb, transparent, currentcolor); }', 'src/generated/tokens.css')).toContain('function-disallowed-list');
  });

  it('lets the host\'s document reset write a rule for body, and only that file', async () => {
    expect(await lint('body { margin: 0; }', '../../ui-next/global.css')).toEqual([]);
    expect(await lint('body { margin: 0; }', '../../ui-next/App.module.css')).toContain('selector-disallowed-list');
  });
});
