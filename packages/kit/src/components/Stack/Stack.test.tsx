import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPACING_STEPS } from '../../generated/tokenNames';
import { Stack } from './Stack';

describe('Stack', () => {
  it('is a column by default and writes only the props it was given', () => {
    render(<Stack data-testid="stack">child</Stack>);
    const element = screen.getByTestId('stack');
    expect(element).toHaveProperty('dataset.ovDirection', 'column');
    for (const unset of ['ovGap', 'ovPad', 'ovAlign', 'ovJustify']) {
      expect(element.dataset[unset]).toBeUndefined();
    }
  });

  it('maps every layout prop to a data attribute', () => {
    render(
      <Stack data-testid="stack" direction="row" gap={8} pad={12} align="center" justify="between">
        child
      </Stack>,
    );
    const element = screen.getByTestId('stack');
    expect(element.dataset).toMatchObject({ ovDirection: 'row', ovGap: '8', ovPad: '12', ovAlign: 'center', ovJustify: 'between' });
  });

  it('passes data-* attributes through and nothing else', () => {
    // A cast stands for plain JavaScript, which types cannot stop.
    const Loose = Stack as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { 'data-testid': 'probe', className: 'restyled', style: { padding: 3 }, role: 'presentation' };
    render(<Loose {...loose} />);
    const element = screen.getByTestId('probe');
    expect(element.getAttribute('class')).not.toContain('restyled');
    expect(element.hasAttribute('style')).toBe(false);
    expect(element.hasAttribute('role')).toBe(false);
  });

  it('has closed props: no className, no style, no spacing outside the scale', () => {
    // @ts-expect-error className is not a prop of a kit part
    render(<Stack className="x" data-testid="a" />);
    // @ts-expect-error style is not a prop of a kit part
    render(<Stack style={{ gap: 5 }} data-testid="b" />);
    // @ts-expect-error 5 is not a step of the closed spacing scale
    render(<Stack gap={5} data-testid="c" />);
    // @ts-expect-error 10 is the interior inset of a table cell, not a layout step
    render(<Stack pad={10} data-testid="d" />);
    // @ts-expect-error a value outside the closed alignment set
    render(<Stack align="top" data-testid="e" />);
    expect(screen.getAllByTestId(/^[a-e]$/)).toHaveLength(5);
  });

  it('has a rule in its stylesheet for every step, direction, alignment and distribution it accepts', async () => {
    const css = await readFile(path.join(import.meta.dirname, 'Stack.module.css'), 'utf8');
    for (const step of SPACING_STEPS) {
      expect(css).toContain(`[data-ov-gap='${step}'] {\n    gap: var(--ov-spacing-${step});`);
      expect(css).toContain(`[data-ov-pad='${step}'] {\n    padding: var(--ov-spacing-${step});`);
    }

    for (const value of ['column', 'row']) {
      expect(css).toContain(`[data-ov-direction='${value}']`);
    }

    for (const value of ['start', 'center', 'end', 'stretch', 'baseline']) {
      expect(css).toContain(`[data-ov-align='${value}']`);
    }

    for (const value of ['start', 'center', 'end', 'between']) {
      expect(css).toContain(`[data-ov-justify='${value}']`);
    }

    // and no step the scale does not have
    expect([...css.matchAll(/\[data-ov-gap='(\d+)'\]/g)].map((match) => Number(match[1]))).toEqual([...SPACING_STEPS]);
  });
});
