import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { MissingValue, type MissingValueProps } from './MissingValue';
import * as examples from './MissingValue.examples';

describe('MissingValue', () => {
  it('is the dash of the design, one span that reads as an image with a name', () => {
    const { container } = render(<MissingValue />);
    const dash = container.firstElementChild as HTMLElement;
    expect(dash.tagName).toBe('SPAN');
    expect(dash.textContent).toBe('\u2014');
    expect(dash.getAttribute('role')).toBe('img');
    expect(dash.getAttribute('aria-label')).toBe('Not applicable');
    expect(screen.getByRole('img', { name: 'Not applicable' })).toBe(dash);
    for (const attribute of ['title', 'tabindex', 'style', 'aria-describedby']) {
      expect(dash.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('takes the name the caller gives it: what is missing, in words', () => {
    render(<MissingValue name="No restart count" />);
    expect(screen.getByRole('img', { name: 'No restart count' }).textContent).toBe('\u2014');
  });

  it('puts the reason in the accessible name, after the name, so a keyboard and a screen reader reach it without a hover', () => {
    render(<MissingValue name="Not available" reason="The value has not been reported yet" />);
    const dash = screen.getByRole('img', { name: 'Not available: The value has not been reported yet' });
    expect(dash.getAttribute('aria-label')).toBe('Not available: The value has not been reported yet');
    expect(dash.hasAttribute('title')).toBe(false);
    // the reason is not drawn: the cell shows the dash and nothing else
    expect(dash.textContent).toBe('\u2014');
  });

  it('takes the default name with a reason, and an empty reason for none', () => {
    const { rerender } = render(<MissingValue reason="The source is offline" />);
    expect(screen.getByRole('img', { name: 'Not applicable: The source is offline' })).toBeDefined();
    rerender(<MissingValue name="Nothing yet" reason="" />);
    expect(screen.getByRole('img', { name: 'Nothing yet' })).toBeDefined();
    rerender(<MissingValue name="Nothing yet" reason="   " />);
    expect(screen.getByRole('img', { name: 'Nothing yet' })).toBeDefined();
  });

  it('never draws a phrase: Unknown, Not applicable and Not reported are names, and the cell reads as the dash alone', () => {
    const { container } = render(<MissingValue name="Unknown" reason="Not reported" />);
    expect(container.textContent).toBe('\u2014');
    expect(container.textContent).not.toMatch(/unknown|not applicable|not reported/i);
  });

  it('is one element: no wrapper for a reason, no tip of its own', () => {
    const { container } = render(<MissingValue name="Not available" reason="Offline" />);
    expect(container.querySelectorAll('*')).toHaveLength(1);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = MissingValue as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', tabIndex: 3, role: 'button' };
    render(<Loose {...loose} />);
    const dash = screen.getByTestId('probe');
    expect(dash.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'tabindex']) {
      expect(dash.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(dash.getAttribute('role')).toBe('img');
  });

  it('has closed props: a name and a reason that are text, no className, no style', () => {
    // Types only: these are never rendered.
    const accepted: MissingValueProps[] = [{}, { name: 'No value' }, { name: 'No value', reason: 'Offline' }, { name: undefined, reason: undefined }, { 'data-testid': 'probe' }];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: MissingValueProps = { className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: MissingValueProps = { style: { color: 'red' } };
    // @ts-expect-error the name is text
    const elementName: MissingValueProps = { name: <b>No value</b> };
    // @ts-expect-error the reason is text
    const numberReason: MissingValueProps = { reason: 3 };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: MissingValueProps = { title: 'hint' };
    // @ts-expect-error the dash is not a command
    const withClick: MissingValueProps = { onClick: () => undefined };
    expect([accepted, withClass, withStyle, elementName, numberReason, withTitle, withClick]).toHaveLength(7);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(<MissingValue name="Not available" reason="Offline" />);
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The stylesheet, as the rules it holds (jsdom lays nothing out; a browser's layout is probed in packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'MissingValue.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the MissingValue stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('paints the dash in the muted role and takes the type of the cell it sits in', () => {
    expect(rule('.root')).toMatchObject({ color: 'var(--ov-fg-muted)', 'font-family': 'var(--ov-font-ui)', 'font-feature-settings': 'var(--ov-font-features)' });
    const declared = Object.keys(rule('.root'));
    for (const property of ['font-size', 'line-height', 'font-weight', 'display', 'padding', 'margin']) {
      expect(declared, property).not.toContain(property);
    }
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a MissingValue is shown in.
type Row = { readonly name: string };
const MATRIX: Readonly<Record<string, Row>> = {
  NotApplicable: { name: 'Not applicable' },
  Named: { name: 'No value' },
  WithReason: { name: 'Not available: The source has not reported it yet' },
};

describe('MissingValue examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: the dash, named ${row.name}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const dash = screen.getByRole('img', { name: row.name });
      expect(dash.textContent).toBe('\u2014');
      // the dash is the only thing drawn, and it is not a control
      expect(container.textContent).toBe('\u2014');
      expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
      expect(container.querySelector('[title]')).toBeNull();
    });
  }
});
