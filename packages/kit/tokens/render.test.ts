import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { TOKEN_NAMES } from '../src/generated/tokenNames.ts';
import { COLOR_ROLES, SPACING, SURFACE_FILLS } from './manifest.ts';
import { renderTokenNames, renderTokensCss, tokenNames } from './render.ts';
import { DEFAULT_THEME_ID, THEME_DEFINITIONS } from './themes.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = async (file: string): Promise<string> => readFile(path.join(root, file), 'utf8');

describe('the generated token files', () => {
  it('are what the manifest produces now (run `pnpm --filter @omniviewdev/kit run generate`)', async () => {
    expect(await generated('src/generated/tokens.css')).toBe(renderTokensCss(THEME_DEFINITIONS, DEFAULT_THEME_ID));
    expect(await generated('src/generated/tokenNames.ts')).toBe(renderTokenNames(THEME_DEFINITIONS, DEFAULT_THEME_ID));
  });

  it('name every token exactly once, in the typed list and in the stylesheet', async () => {
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length);
    expect([...TOKEN_NAMES]).toEqual([...tokenNames()]);

    const defined = new Set<string>();
    postcss.parse(await generated('src/generated/tokens.css')).walkDecls(/^--ov-/, (decl) => {
      defined.add(decl.prop);
    });
    expect([...defined].sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it('define each colour role once per theme block, with a block per theme', async () => {
    const stylesheet = postcss.parse(await generated('src/generated/tokens.css'));
    for (const theme of THEME_DEFINITIONS) {
      const blocks: postcss.Rule[] = [];
      stylesheet.walkRules((rule) => {
        if (rule.selector.includes(`[data-ov-theme='${theme.id}']`)) {
          blocks.push(rule);
        }
      });
      expect(blocks, theme.id).toHaveLength(1);
      const names = (blocks[0]?.nodes ?? []).filter((node): node is postcss.Declaration => node.type === 'decl').map((decl) => decl.prop);
      const expected = [...COLOR_ROLES, 'surface-backdrop', ...Object.keys(SURFACE_FILLS).map((role) => `surface-${role}`)];
      expect(names.filter((prop) => prop.startsWith('--ov-')).sort(), theme.id).toEqual(expected.map((role) => `--ov-${role}`).sort());
      expect(names).toContain('color-scheme');
    }
  });

  it('derives each material fill from its own theme without changing the solid palette', () => {
    const css = renderTokensCss(THEME_DEFINITIONS, DEFAULT_THEME_ID);
    for (const theme of THEME_DEFINITIONS) {
      const block = css.split(`[data-ov-theme='${theme.id}'] {`)[1]?.split('}')[0];
      for (const [role, { colour, opacity }] of Object.entries(SURFACE_FILLS)) {
        const hex = theme.colors[colour];
        expect(hex, `${theme.id} ${colour}`).toMatch(/^#[a-f0-9]{6}$/i);
        const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(' ');
        expect(block).toContain(`--ov-${colour}: ${hex};`);
        expect(block).toContain(`--ov-surface-${role}: rgb(${rgb} / max(var(--_material-floor, 100%), var(--_${opacity}-opacity, 100%)));`);
      }
    }
  });

  it('accepts whole percentages only; unselected values, including 100, use the solid default', () => {
    const css = renderTokensCss(THEME_DEFINITIONS, DEFAULT_THEME_ID);
    for (const role of ['chrome', 'content', 'menu', 'sheet']) {
      const matches = [...css.matchAll(new RegExp(`:root\\[data-ov-${role}-opacity='([^']+)'\\] \\{ --_${role}-opacity: ([^;]+); \\}`, 'g'))];
      expect(matches.map((match) => [match[1], match[2]])).toEqual(Array.from({ length: 100 }, (_, value) => [String(value), `${value}%`]));
    }
  });

  it('makes the backing and every material fill opaque on system accessibility overrides', () => {
    const stylesheet = postcss.parse(renderTokensCss(THEME_DEFINITIONS, DEFAULT_THEME_ID));
    const overrides = new Map<string, Record<string, string>>();
    stylesheet.walkAtRules('media', (media) => {
      media.walkRules(':root', (rule) => {
        const declarations = Object.fromEntries(rule.nodes.filter((n): n is postcss.Declaration => n.type === 'decl').map((d) => [d.prop, d.value]));
        for (const query of media.params.split(', ')) {
          overrides.set(query, declarations);
        }
      });
    });
    for (const query of ['(forced-colors: active)', '(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']) {
      expect(overrides.get(query), query).toMatchObject({ '--_material-floor': '100%', '--ov-surface-backdrop': 'var(--ov-bg-window)' });
    }
  });

  it('declare the closed scales and nothing beside them', async () => {
    const css = await generated('src/generated/tokens.css');
    for (const step of SPACING) {
      expect(css).toContain(`--ov-spacing-${step}: ${step}px;`);
    }

    expect(css).not.toMatch(/--ov-spacing-(?:1|3|5|7|9|10|11)\b/);
    expect(css).toContain('--ov-fs-12: calc(12px * var(--ov-text-scale));');
    expect(css).toContain('[data-ov-density=\'compact\']');
    expect(css).toContain('--ov-row-height: 22px;');
  });

  it('carry the two elevations a part draws so far, the tooltip\'s and the popup\'s, the same in every theme', async () => {
    const css = await generated('src/generated/tokens.css');
    expect(css).toContain('--ov-shadow-tooltip: 0 2px 8px #0006;');
    expect(css).toContain('--ov-shadow-popup: 0 8px 24px #00000040;');
    expect(css.match(/--ov-shadow-tooltip:/g)).toHaveLength(1);
    expect(css.match(/--ov-shadow-popup:/g)).toHaveLength(1);
    expect(TOKEN_NAMES.filter((name) => name.startsWith('--ov-shadow-'))).toEqual(['--ov-shadow-tooltip', '--ov-shadow-popup']);
  });
});
