import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from './cssRules.ts';

const CSS = `
@layer ov.components {
  .root { color: var(--ov-fg); padding: 0 var(--ov-spacing-6); }
  .root[data-ov-tone='success'], .root[data-ov-tone='info'] { color: var(--ov-success-fg); }
  .root[data-ov-tone='success'] { border-color: var(--ov-success-border); }
  .root:hover { background-image: none; }
  @media (prefers-reduced-motion: reduce) {
    .root { animation: none; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
}
`;

describe('cssRules', () => {
  it('lists every style rule in source order with the at-rules around it, and no keyframe step', () => {
    const rules = cssRules(CSS);
    expect(rules.map((rule) => rule.selector)).toEqual([
      '.root',
      '.root[data-ov-tone=\'success\'], .root[data-ov-tone=\'info\']',
      '.root[data-ov-tone=\'success\']',
      '.root:hover',
      '.root',
    ]);
    expect(rules[0]?.context).toEqual(['@layer ov.components']);
    expect(rules[4]?.context).toEqual(['@layer ov.components', '@media (prefers-reduced-motion: reduce)']);
    expect(rules[0]?.declarations).toEqual({ color: 'var(--ov-fg)', padding: '0 var(--ov-spacing-6)' });
  });
});

describe('declarationsOf', () => {
  it('merges the rules that name the selector, one of a list included, in source order', () => {
    expect(declarationsOf(CSS, '.root[data-ov-tone=\'success\']')).toEqual({ color: 'var(--ov-success-fg)', 'border-color': 'var(--ov-success-border)' });
    expect(declarationsOf(CSS, '.root[data-ov-tone=\'info\']')).toEqual({ color: 'var(--ov-success-fg)' });
  });

  it('means the rules outside a media query unless it is told which at-rule', () => {
    expect(declarationsOf(CSS, '.root')).toEqual({ color: 'var(--ov-fg)', padding: '0 var(--ov-spacing-6)' });
    expect(declarationsOf(CSS, '.root', 'prefers-reduced-motion')).toEqual({ animation: 'none' });
  });

  it('throws, naming the selector, when no rule has it: a test of a missing rule fails', () => {
    expect(() => declarationsOf(CSS, '.missing')).toThrow('no rule for the selector .missing');
    expect(() => declarationsOf(CSS, '.root[data-ov-tone=\'error\']')).toThrow(/data-ov-tone='error'/);
    expect(() => declarationsOf(CSS, '.root:hover', 'prefers-reduced-motion')).toThrow(/within prefers-reduced-motion/);
  });
});
