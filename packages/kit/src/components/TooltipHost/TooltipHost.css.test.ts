import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { GAP, MARGIN } from './placement';

const css = await readFile(path.join(import.meta.dirname, 'TooltipHost.module.css'), 'utf8');
const rules = () => {
  const found: Array<{ selector: string; declarations: Record<string, string> }> = [];
  postcss.parse(css).walkRules((rule) => {
    const declarations: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
    found.push({ selector: rule.selector, declarations });
  });
  return found;
};

const surface = () => rules().find((rule) => rule.selector === '.root')?.declarations ?? {};

describe('the tooltip surface (design 12, the tooltip host; the mock, core.css .tooltip)', () => {
  it('is drawn in the component layer, from tokens', () => {
    expect(css).toMatch(/^@layer ov\.components\s*\{/);
    const declarations = surface();
    expect(declarations['background-color']).toBe('var(--ov-bg-feedback)');
    expect(declarations.border).toBe('1px solid var(--ov-bg-feedback)');
    expect(declarations.color).toBe('var(--ov-fg)');
    expect(declarations['border-radius']).toBe('var(--ov-radius-control)');
    expect(declarations.padding).toBe('var(--ov-spacing-8) var(--ov-spacing-12)');
    expect(declarations['box-shadow']).toBe('var(--ov-shadow-tooltip)');
    expect(declarations['font-size']).toBe('var(--ov-fs-13)');
    expect(declarations['line-height']).toBe('var(--ov-lh-16)');
    expect(declarations['font-family']).toBe('var(--ov-font-ui)');
    expect(declarations['font-feature-settings']).toBe('var(--ov-font-features)');
  });

  it('wraps plain text at 300 px or the window less its margins, and keeps the lines the text has', () => {
    const declarations = surface();
    expect(declarations['max-width']).toBe(`min(300px, calc(100vw - ${2 * MARGIN}px))`);
    expect(declarations.width).toBe('max-content');
    expect(declarations['white-space']).toBe('pre-line');
    expect(declarations['overflow-wrap']).toBe('anywhere');
  });

  it('is fixed at the corner, positioned by the host: no UA popover inset, margin or auto sizing', () => {
    const declarations = surface();
    expect(declarations.position).toBe('fixed');
    expect(declarations.inset).toBe('auto');
    expect(declarations.left).toBe('0');
    expect(declarations.top).toBe('0');
    expect(declarations.margin).toBe('0');
  });

  it('has no scrim, no blur, no transition and no animation: nothing moves, so reduced motion changes nothing (design 12)', () => {
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
    expect(rules().some((rule) => rule.selector.includes('::backdrop'))).toBe(false);
  });

  it('bridges the gap to the trigger, so the pointer can cross it onto the tip, on each side', () => {
    const bridge = `calc(${GAP}px + 1px)`;
    const found = rules().filter((rule) => rule.selector.includes('::before'));
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const side of ['bottom', 'top']) {
      expect(found.find((rule) => rule.selector.includes(`data-placement='${side}'`))?.declarations.height, side).toBe(bridge);
    }

    for (const side of ['right', 'left']) {
      expect(found.find((rule) => rule.selector.includes(`data-placement='${side}'`))?.declarations.width, side).toBe(bridge);
    }
  });

  it('scrolls its text inside, never the tooltip itself: an overflow on the root would clip the bridge to the trigger', () => {
    const root = surface();
    expect(root.overflow).toBe('visible');
    expect(rules().some((rule) => rule.selector.startsWith('.root[data-ov-clamped') && !rule.selector.includes('>') && 'overflow-y' in rule.declarations)).toBe(false);
    const body = rules().find((rule) => rule.selector === '.root[data-ov-clamped=\'true\'] > [data-ov-tip-body]');
    expect(body?.declarations['overflow-y']).toBe('auto');
  });

  it('limits the border box, not the content box, and lets the text shrink into what is left: border-box, a flex column that is open, a body that may shrink', () => {
    const root = surface();
    expect(root['box-sizing']).toBe('border-box');
    // The popover UA rule hides a closed popover with `display: none`; an author `display` on `.root` itself would override it and show the tip always.
    expect(root.display).toBeUndefined();
    const open = rules().find((rule) => rule.selector === '.root:popover-open');
    expect(open?.declarations.display).toBe('flex');
    expect(open?.declarations['flex-direction']).toBe('column');
    const body = rules().find((rule) => rule.selector === '.root > [data-ov-tip-body]');
    expect(body?.declarations['min-height']).toBe('0');
    expect(body?.declarations['max-height']).toBeUndefined();
  });
});
