import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { TOKEN_NAMES } from '../src/generated/tokenNames.ts';
import { COLOR_ROLES, SPACING } from './manifest.ts';
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
      expect(names.filter((prop) => prop.startsWith('--ov-')).sort(), theme.id).toEqual(COLOR_ROLES.map((role) => `--ov-${role}`).sort());
      expect(names).toContain('color-scheme');
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
