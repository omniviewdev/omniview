import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { GAP, MARGIN } from './placement';

const css = await readFile(path.join(import.meta.dirname, 'HoverCard.module.css'), 'utf8');
const rules = cssRules(css);
const surface = declarationsOf(css, '.root');

describe('the hover card surface (design 12, "Hover card"; the mock, core.css .detail__card and shell-panel.css .psession-card)', () => {
  it('is drawn in the component layer, from tokens', () => {
    expect(css).toMatch(/^@layer ov\.components\s*\{/);
    expect(rules.every((rule) => rule.context[0] === '@layer ov.components')).toBe(true);
    expect(surface['background-color']).toBe('var(--ov-surface-sheet-raised)');
    expect(surface.border).toBe('1px solid var(--ov-border-popup)');
    expect(surface.color).toBe('var(--ov-fg)');
    expect(surface['border-radius']).toBe('var(--ov-radius-popup)');
    expect(surface.padding).toBe('var(--ov-spacing-12)');
    expect(surface['box-shadow']).toBe('var(--ov-shadow-popup)');
    expect(surface['font-size']).toBe('var(--ov-fs-13)');
    expect(surface['line-height']).toBe('var(--ov-lh-16)');
    expect(surface['font-family']).toBe('var(--ov-font-ui)');
    expect(surface['font-feature-settings']).toBe('var(--ov-font-features)');
  });

  it('wraps text at 336 px or the window less its margins, with its width the content\'s', () => {
    expect(surface['max-width']).toBe(`min(336px, calc(100vw - ${2 * MARGIN}px))`);
    expect(surface.width).toBe('max-content');
    expect(surface['white-space']).toBe('normal');
    expect(surface['overflow-wrap']).toBe('anywhere');
  });

  it('is fixed at the corner, positioned by the host: no UA popover inset, margin or auto sizing', () => {
    expect(surface.position).toBe('fixed');
    expect(surface.inset).toBe('auto');
    expect(surface.left).toBe('0');
    expect(surface.top).toBe('0');
    expect(surface.margin).toBe('0');
  });

  it('is a flex column of rows 8 px apart while open, and only while open: the UA hides a closed popover with display none', () => {
    expect(surface.display).toBeUndefined();
    const open = declarationsOf(css, '.root:popover-open');
    expect(open.display).toBe('flex');
    expect(open['flex-direction']).toBe('column');
    const body = declarationsOf(css, '.body');
    expect(body.display).toBe('flex');
    expect(body['flex-direction']).toBe('column');
    expect(body.gap).toBe('var(--ov-spacing-8)');
    expect(body['min-height']).toBe('0');
  });

  it('measures by the border box, so that the height the host limits it to is the box\'s', () => {
    expect(surface['box-sizing']).toBe('border-box');
  });

  it('has no scrim, no blur, no transition and no animation: nothing moves, so reduced motion changes nothing', () => {
    const properties: string[] = [];
    const atRules: string[] = [];
    postcss.parse(css).walkDecls((declaration) => {
      properties.push(declaration.prop);
    });
    postcss.parse(css).walkAtRules((rule) => {
      atRules.push(rule.name);
    });
    expect(properties.filter((property) => /^(?:transition|animation|backdrop|transform|filter|opacity)/.test(property))).toEqual([]);
    expect(atRules).toEqual(['layer']);
    expect(rules.some((rule) => rule.selector.includes('::backdrop'))).toBe(false);
  });

  it('bridges the gap to the anchor, so that the pointer can cross it onto the card: below and above, and no side beside', () => {
    const bridge = `calc(${GAP}px + 1px)`;
    const found = rules.filter((rule) => rule.selector.includes('::before'));
    expect(found.map((rule) => rule.selector).sort()).toEqual(['.root::before', '.root[data-placement=\'bottom\']::before', '.root[data-placement=\'top\']::before'].sort());
    expect(declarationsOf(css, '.root::before')).toEqual({ content: '\'\'', position: 'absolute' });
    expect(declarationsOf(css, '.root[data-placement=\'bottom\']::before')).toEqual({ inset: 'auto 0 100% 0', height: bridge });
    expect(declarationsOf(css, '.root[data-placement=\'top\']::before')).toEqual({ inset: '100% 0 auto 0', height: bridge });
  });

  it('scrolls what it holds inside, never the card itself: an overflow on the root would clip the bridge to the anchor', () => {
    expect(surface.overflow).toBe('visible');
    const clamped = rules.filter((rule) => rule.selector.includes('data-ov-clamped'));
    expect(clamped.map((rule) => rule.selector)).toEqual(['.root[data-ov-clamped=\'true\'] > .body']);
    expect(clamped[0]?.declarations).toEqual({ 'overflow-y': 'auto' });
    expect(rules.some((rule) => rule.selector === '.root' && 'overflow-y' in rule.declarations)).toBe(false);
  });

  it('has a live region that is visually hidden by the mock\'s rule (base.css 1592) and takes no space', () => {
    expect(declarationsOf(css, '.status')).toMatchObject({
      position: 'absolute',
      width: '1px',
      height: '1px',
      margin: '-1px',
      padding: '0',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
      border: '0',
    });
  });

  it('writes no hex, no colour function and no value outside the closed scales', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|color-mix)\(/);
    const spacing = [...css.matchAll(/(?:padding|gap|margin)[a-z-]*:\s*([^;]+);/g)].map((match) => match[1]);
    for (const value of spacing) {
      expect(value, String(value)).toMatch(/^(?:var\(--ov-spacing-(?:2|4|6|8|12|16|20|24)\)|0|-1px|auto)(?: (?:var\(--ov-spacing-\d+\)|0|auto))*$/);
    }
  });
});
