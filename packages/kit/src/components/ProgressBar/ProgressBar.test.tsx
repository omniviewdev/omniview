import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { ProgressBar, type ProgressBarProps } from './ProgressBar';
import { Interactive } from './ProgressBar.examples';

const label = 'Upload bundle';
const progressbar = () => screen.getByRole('progressbar', { name: label });
const fillSelector = ':scope > [data-ov-part="fill"]';

describe('ProgressBar', () => {
  it.each([
    [-5, 0],
    [0, 0],
    [42.5, 42.5],
    [100, 100],
    [110, 100],
  ])('exposes and paints %s as %s percent', (value, percent) => {
    render(<ProgressBar label={label} value={value} />);
    const bar = progressbar();
    const fill = bar.querySelector<HTMLSpanElement>(fillSelector);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe(String(percent));
    expect(bar.hasAttribute('aria-valuetext')).toBe(false);
    expect(bar.hasAttribute('data-ov-indeterminate')).toBe(false);
    expect(fill?.style.getPropertyValue('--_percent')).toBe(String(percent));
    expect(fill?.getAttribute('aria-hidden')).toBe('true');
  });

  it('drops the numeric measurement when indeterminate and restores it without replacing the track', () => {
    const { rerender } = render(<ProgressBar label={label} value={25} />);
    const bar = progressbar();
    rerender(<ProgressBar label={label} value="indeterminate" valueText="Preparing upload…" />);
    expect(progressbar()).toBe(bar);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuetext')).toBe('Preparing upload…');
    expect(bar.getAttribute('data-ov-indeterminate')).toBe('true');
    expect(bar.getAttribute('data-ov-motion')).toBe('stripe');
    expect(bar.querySelector<HTMLSpanElement>(fillSelector)?.style.getPropertyValue('--_percent')).toBe('');

    rerender(<ProgressBar label={label} value="indeterminate" indeterminateMotion="sweep" />);
    expect(bar.getAttribute('data-ov-motion')).toBe('sweep');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.hasAttribute('aria-valuetext')).toBe(false);

    rerender(<ProgressBar label={label} value={0} indeterminateMotion="sweep" />);
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.hasAttribute('data-ov-motion')).toBe(false);
  });

  it('does not expose NaN as a numeric value', () => {
    render(<ProgressBar label={label} value={Number.NaN} />);
    const bar = progressbar();
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('data-ov-indeterminate')).toBe('true');
  });

  it('keeps the measurement and reported text when paused', () => {
    render(<ProgressBar label={label} value={40} paused valueText="Paused at 2 of 5 files" />);
    const bar = progressbar();
    expect(bar.getAttribute('data-ov-paused')).toBe('true');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe('Paused at 2 of 5 files');
    expect(bar.hasAttribute('data-ov-motion')).toBe(false);
  });

  it('passes data attributes through but owns the role, accessible name, children and styling', () => {
    const Loose = ProgressBar as unknown as ComponentType<Record<string, unknown>>;
    const props: Record<string, unknown> = {
      label,
      value: 40,
      'data-testid': 'probe',
      'data-ov-part': 'overridden',
      'aria-label': 'Overridden',
      role: 'button',
      className: 'restyled',
      style: { width: '10px' },
      tabIndex: 0,
      children: 'Extra content',
    };
    render(<Loose {...props} />);
    const bar = progressbar();
    expect(screen.getByTestId('probe')).toBe(bar);
    expect(bar.getAttribute('data-ov-part')).toBe('progress-bar');
    expect(bar.getAttribute('class')).not.toContain('restyled');
    expect(bar.hasAttribute('style')).toBe(false);
    expect(bar.hasAttribute('tabindex')).toBe(false);
    expect(bar.textContent).toBe('');
  });

  it('requires a label and a typed value, without arbitrary attributes', () => {
    // @ts-expect-error the bar requires an accessible name
    const noLabel: ProgressBarProps = { value: 0 };
    // @ts-expect-error the only string value is the indeterminate marker
    const textValue: ProgressBarProps = { label, value: '40%' };
    // @ts-expect-error motion comes from a closed set
    const customMotion: ProgressBarProps = { label, value: 'indeterminate', indeterminateMotion: 'pulse' };
    // @ts-expect-error a consumer cannot restyle a kit part
    const customStyle: ProgressBarProps = { label, value: 0, style: { width: '10px' } };
    expect([noLabel, textValue, customMotion, customStyle]).toHaveLength(4);
  });
});

it('changes the measurement, pause and mode on one bar in the interactive example', () => {
  render(<Interactive />);
  const bar = screen.getByRole('progressbar', { name: 'Download archive' });
  const advance = screen.getByRole('button', { name: 'Advance' });
  expect(bar.getAttribute('aria-valuenow')).toBe('30');

  fireEvent.click(advance);
  expect(bar.getAttribute('aria-valuenow')).toBe('40');
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(bar.getAttribute('data-ov-paused')).toBe('true');
  fireEvent.click(advance);
  expect(bar.getAttribute('aria-valuenow')).toBe('40');

  fireEvent.click(screen.getByRole('button', { name: 'Set unknown' }));
  expect(bar.getAttribute('data-ov-paused')).toBe('true');
  expect(bar.getAttribute('data-ov-indeterminate')).toBe('true');
  expect(bar.getAttribute('aria-valuetext')).toBe('Paused. Total unknown');
  expect(bar.hasAttribute('aria-valuenow')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(bar.hasAttribute('data-ov-paused')).toBe(false);
  expect(bar.getAttribute('data-ov-motion')).toBe('stripe');
  fireEvent.click(screen.getByRole('button', { name: 'Set measured' }));
  expect(bar.getAttribute('aria-valuenow')).toBe('40');
  expect(screen.getByRole('progressbar', { name: 'Download archive' })).toBe(bar);
});

const css = await readFile(path.join(import.meta.dirname, 'ProgressBar.module.css'), 'utf8');
const stripe = '.root[data-ov-motion=\'stripe\']:not([data-ov-paused]) > .fill';
const sweep = '.root[data-ov-motion=\'sweep\']:not([data-ov-paused]) > .fill';
const rule = (selector: string) => declarationsOf(css, selector);
const animatedRule = (selector: string) => declarationsOf(css, selector, 'prefers-reduced-motion: no-preference');

describe('the ProgressBar stylesheet', () => {
  it('uses a 4 px, rounded track and paints measured or paused progress with tokens', () => {
    expect(cssRules(css).every(({ context }) => context[0] === '@layer ov.components')).toBe(true);
    expect(rule('.root')).toMatchObject({
      '--_fill': 'var(--ov-accent)',
      'block-size': '4px',
      'inline-size': '100%',
      overflow: 'hidden',
      'border-radius': 'var(--ov-radius-mark)',
      'background-color': 'var(--ov-progress-track)',
    });
    expect(rule('.fill')).toMatchObject({
      'inline-size': 'calc(var(--_percent, 0) * 1%)',
      'block-size': '100%',
      'background-color': 'var(--_fill)',
    });
    expect(rule('.root[data-ov-paused=\'true\']')['--_fill']).toBe('var(--ov-fg-secondary)');
  });

  it('keeps the full-width stripe and moving segment distinct', () => {
    expect(animatedRule(stripe)).toMatchObject({ 'background-size': '200% 100%', animation: 'stripe 800ms linear infinite' });
    expect(animatedRule(sweep)).toMatchObject({
      'inline-size': '40%',
      'background-image': 'none',
      animation: 'sweep 1.4s linear infinite',
      '--_sweep-from': '-100%',
      '--_sweep-to': '250%',
    });
  });

  it('mirrors the off-track sweep endpoints in RTL', () => {
    expect(animatedRule('.root[data-ov-motion=\'sweep\']:not([data-ov-paused]):dir(rtl) > .fill')).toMatchObject({
      '--_sweep-from': '100%',
      '--_sweep-to': '-250%',
    });
    expect(css).toMatch(/@keyframes sweep\s*\{\s*from\s*\{\s*transform: translateX\(var\(--_sweep-from\)\);\s*\}\s*to\s*\{\s*transform: translateX\(var\(--_sweep-to\)\);/);
  });

  it('draws static track-colour bands when paused or under reduced motion', () => {
    expect(rule('.root[data-ov-indeterminate=\'true\'] > .fill')).toMatchObject({
      'inline-size': '100%',
      'background-image': 'repeating-linear-gradient(90deg, var(--_fill) 0 8px, var(--ov-progress-track) 8px 16px)',
    });
    const motionRules = cssRules(css).filter((entry) => entry.declarations.animation !== undefined);
    expect(motionRules).toHaveLength(2);
    for (const entry of motionRules) {
      expect(entry.selector).toContain(':not([data-ov-paused])');
      expect(entry.context).toContain('@media (prefers-reduced-motion: no-preference)');
    }
  });
});
