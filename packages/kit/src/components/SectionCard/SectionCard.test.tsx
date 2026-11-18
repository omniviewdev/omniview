import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { SectionCard, type SectionCardProps } from './SectionCard';
import * as examples from './SectionCard.examples';

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

describe('SectionCard', () => {
  it('is a plain div: a lane with the heading in it, and no landmark role', () => {
    const { container } = render(<SectionCard title="Details" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('DIV');
    expect(root).toHaveProperty('dataset.ovPart', 'section-card');
    for (const attribute of ['role', 'aria-label', 'aria-labelledby', 'tabindex', 'title', 'style']) {
      expect(root.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(root.children).toHaveLength(1);
    const lane = root.firstElementChild as HTMLElement;
    expect(lane).toHaveProperty('dataset.ovPart', 'lane');
    expect(within(lane).getByRole('heading', { name: 'Details' }).getAttribute('data-ov-part')).toBe('heading');
  });

  it('draws the title as an h2 unless it is told another level, and the level is the outline, not the look', () => {
    const { rerender } = render(<SectionCard title="Details" />);
    expect(screen.getByRole('heading', { name: 'Details' }).tagName).toBe('H2');
    const look = screen.getByRole('heading').className;
    for (const level of [2, 3, 4] as const) {
      rerender(<SectionCard title="Details" level={level} />);
      const heading = screen.getByRole('heading', { name: 'Details' });
      expect(heading.tagName).toBe(`H${String(level)}`);
      expect(heading.getAttribute('aria-level')).toBeNull();
      expect(heading.hasAttribute('data-ov-level')).toBe(false);
      expect(heading.className).toBe(look);
    }
  });

  it('marks the heading as text that clips, for the shared tip host', () => {
    render(<SectionCard title="Details" />);
    expect(screen.getByRole('heading', { name: 'Details' }).hasAttribute('data-ov-clip')).toBe(true);
  });

  it('puts the meta after the title, in the same group, and draws none when there is none', () => {
    const { container, rerender } = render(<SectionCard title="Replicas" meta="3" />);
    const meta = container.querySelector('[data-ov-part="meta"]')!;
    expect(meta.textContent).toBe('3');
    expect(meta.previousElementSibling).toBe(screen.getByRole('heading'));
    expect(meta.parentElement).toBe(screen.getByRole('heading').parentElement);
    rerender(<SectionCard title="Replicas" />);
    expect(container.querySelector('[data-ov-part="meta"]')).toBeNull();
    rerender(<SectionCard title="Replicas" meta="" />);
    expect(container.querySelector('[data-ov-part="meta"]')).toBeNull();
  });

  it('puts the actions at the end of the lane, after the group of title and meta, and draws none when there are none', () => {
    const { container, rerender } = render(<SectionCard title="Replicas" actions={<button type="button">View all</button>} />);
    const lane = container.querySelector('[data-ov-part="lane"]')!;
    const actions = container.querySelector('[data-ov-part="actions"]')!;
    expect(lane.lastElementChild).toBe(actions);
    expect(actions.parentElement).toBe(lane);
    expect(actions.querySelectorAll('button')).toHaveLength(1);
    expect(lane.children).toHaveLength(2);
    for (const none of [undefined, null, false, ''] as const) {
      rerender(<SectionCard title="Replicas" actions={none} />);
      expect(container.querySelector('[data-ov-part="actions"]'), String(none)).toBeNull();
    }
  });

  it('draws the body after the lane: padded with `pad`, flush without', () => {
    const { container, rerender } = render(<SectionCard title="Details">text</SectionCard>);
    const body = container.querySelector('[data-ov-part="body"]')!;
    expect(body.textContent).toBe('text');
    expect(body.previousElementSibling).toBe(container.querySelector('[data-ov-part="lane"]'));
    expect(body.hasAttribute('data-ov-pad')).toBe(false);
    rerender(<SectionCard title="Details" pad>text</SectionCard>);
    expect(body).toHaveProperty('dataset.ovPad', 'true');
    rerender(<SectionCard title="Details" pad={false}>text</SectionCard>);
    expect(body.hasAttribute('data-ov-pad')).toBe(false);
  });

  it('draws no body for no children: absent, null, false or an empty string', () => {
    const { container, rerender } = render(<SectionCard title="Details" pad />);
    expect(container.querySelector('[data-ov-part="body"]')).toBeNull();
    for (const none of [null, false, ''] as const) {
      rerender(<SectionCard title="Details" pad>{none}</SectionCard>);
      expect(container.querySelector('[data-ov-part="body"]'), String(none)).toBeNull();
    }

    rerender(<SectionCard title="Details" pad>{0}</SectionCard>);
    expect(container.querySelector('[data-ov-part="body"]')?.textContent).toBe('0');
  });

  it('has the elements it says: root, lane, group, heading; a meta, an actions group and a body each add one', () => {
    expect(count(<SectionCard title="Details" />)).toBe(4);
    expect(count(<SectionCard title="Details" meta="3" />)).toBe(5);
    expect(count(<SectionCard title="Details" actions="x" />)).toBe(5);
    expect(count(<SectionCard title="Details">x</SectionCard>)).toBe(5);
    expect(count(<SectionCard title="Details" meta="3" actions="x">x</SectionCard>)).toBe(7);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = SectionCard as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { title: 'Details', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', role: 'region', 'aria-label': 'x' };
    render(<Loose {...loose} />);
    const root = screen.getByTestId('probe');
    expect(root.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'role', 'aria-label']) {
      expect(root.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: no className, no style, a level of the closed set, a title that is text', () => {
    // Types only: these are never rendered.
    const accepted: SectionCardProps[] = [
      { title: 'Details' },
      { title: 'Details', level: 3, meta: '3', actions: <button type="button">x</button>, pad: true, children: 'x' },
      { title: 'Details', level: undefined, meta: undefined, pad: undefined },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: SectionCardProps = { title: 'Details', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: SectionCardProps = { title: 'Details', style: { color: 'red' } };
    // @ts-expect-error there is no h1 here: the page's one h1 is its header's
    const levelOne: SectionCardProps = { title: 'Details', level: 1 };
    // @ts-expect-error nor an h5
    const levelFive: SectionCardProps = { title: 'Details', level: 5 };
    // @ts-expect-error a title is text, not an element
    const elementTitle: SectionCardProps = { title: <b>Details</b> };
    // @ts-expect-error a meta is text
    const numberMeta: SectionCardProps = { title: 'Details', meta: 3 };
    // @ts-expect-error a section has a title
    const untitled: SectionCardProps = {};
    expect([accepted, withClass, withStyle, levelOne, levelFive, elementTitle, numberMeta, untitled]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      const { rerender } = render(<SectionCard title="Details" pad>x</SectionCard>);
      rerender(<SectionCard title="Details" level={3} meta="2" actions="y" />);
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a SectionCard is shown in.
type Row = {
  /** The headings the example holds, in order, as "level name": the outline. */
  readonly headings: readonly string[];
  /** The names of the buttons in the lane: each one is a Tab stop. */
  readonly buttons?: readonly string[];
  readonly meta?: string;
  readonly padded?: boolean;
  /** Whether a body is drawn at all, and the tables in it. */
  readonly body: boolean;
  readonly tables?: number;
};

const MATRIX: Readonly<Record<string, Row>> = {
  TitleOnly: { headings: ['H2 Details'], body: false },
  WithMeta: { headings: ['H2 Replicas'], meta: '3', body: false },
  WithAction: { headings: ['H2 Usage'], buttons: ['Metrics'], body: false },
  WithMetaAndAction: { headings: ['H2 Replicas'], meta: '3', buttons: ['Search replicas', 'View all'], body: false },
  PaddedBody: { headings: ['H2 Details'], padded: true, body: true },
  PaddedText: { headings: ['H2 Description'], padded: true, body: true },
  FlushTable: { headings: ['H2 Conditions'], meta: '2', body: true, tables: 1 },
  LevelThree: { headings: ['H3 Containers'], meta: '2', padded: true, body: true },
  LevelFour: { headings: ['H4 Init containers'], padded: true, body: true },
  LongTitle: { headings: ['H2 Recent warnings from the orders-api rollout in the north-yard group'], meta: '12', buttons: ['Events'], body: false },
  LabelsSection: { headings: ['H2 Labels'], meta: '3', padded: true, body: true },
};

describe('SectionCard examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${row.headings.join(', ')}${row.buttons === undefined ? '' : `, buttons ${row.buttons.join(' and ')}`}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const card = container.querySelector('[data-ov-part="section-card"]')!;
      expect(card).not.toBeNull();

      // the outline: the headings the section is made of, and nothing is an h1
      const headings = screen.getAllByRole('heading').map((heading) => `${heading.tagName} ${heading.textContent ?? ''}`);
      expect(headings).toEqual(row.headings);

      // the commands of the lane are native buttons with names, in the tab order
      const lane = card.querySelector('[data-ov-part="lane"]')!;
      const buttons = [...lane.querySelectorAll('button')];
      expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([...(row.buttons ?? [])]);
      for (const button of buttons) {
        expect(button.getAttribute('type')).toBe('button');
        expect(button.tabIndex).toBe(0);
      }

      expect(card.querySelector('[data-ov-part="meta"]')?.textContent).toBe(row.meta);
      const body = card.querySelector('[data-ov-part="body"]');
      expect(body !== null).toBe(row.body);
      if (body !== null) {
        expect(body.hasAttribute('data-ov-pad')).toBe(row.padded === true);
      }

      // a table keeps its own semantics: column headers with a scope, and a section never wraps it in a role
      expect(card.querySelectorAll('table')).toHaveLength(row.tables ?? 0);
      for (const header of card.querySelectorAll('th')) {
        expect(header.getAttribute('scope')).toBe('col');
      }

      // the section adds no role of its own: its root, lane and body are plain boxes
      for (const piece of [card, lane, ...(body === null ? [] : [body])]) {
        expect(piece.hasAttribute('role'), String(piece.getAttribute('data-ov-part'))).toBe(false);
      }

      expect(container.querySelector('[title]')).toBeNull();
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    });
  }
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here and what a browser
// paints from it is probed in WebKit and Chromium against the mock (packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'SectionCard.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the SectionCard stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('has no box and no fill: transparent, no border, no radius, no padding of its own', () => {
    const root = rule('.root');
    expect(root.background).toBe('transparent');
    expect(root['min-width']).toBe('0');
    for (const property of ['border', 'border-radius', 'padding', 'box-shadow']) {
      expect(root[property], property).toBeUndefined();
    }

    expect(root['font-family']).toBe('var(--ov-font-ui)');
    expect(root['font-feature-settings']).toBe('var(--ov-font-features)');
  });

  it('makes the lane 28 px at the least, 6 px above and below, with a 1 px subtle rule under it, the commands at the end, 8 px apart', () => {
    expect(rule('.lane')).toMatchObject({
      display: 'flex',
      'box-sizing': 'border-box',
      'align-items': 'center',
      'justify-content': 'space-between',
      gap: 'var(--ov-spacing-8)',
      'min-width': '0',
      'min-height': '28px',
      padding: 'var(--ov-spacing-6) 0',
      'border-bottom': '1px solid var(--ov-border-subtle)',
    });
  });

  it('keeps the title and the fragment together, 8 px apart', () => {
    expect(rule('.lead')).toMatchObject({ display: 'flex', 'align-items': 'center', gap: 'var(--ov-spacing-8)', 'min-width': '0' });
  });

  it('draws the heading 13/16 at weight 600 with no margin, one line, clipped with an ellipsis', () => {
    expect(rule('.heading')).toMatchObject({
      margin: '0',
      'font-size': 'var(--ov-fs-13)',
      'line-height': 'var(--ov-lh-16)',
      'font-weight': '600',
      color: 'var(--ov-fg)',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'min-width': '0',
    });
  });

  it('draws the meta 12/16 in the muted role at the regular weight, one line, clipped with an ellipsis', () => {
    expect(rule('.meta')).toMatchObject({
      color: 'var(--ov-fg-muted)',
      'font-size': 'var(--ov-fs-12)',
      'line-height': 'var(--ov-lh-16)',
      'font-weight': '400',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
    });
  });

  it('lays the commands out in a row, 8 px apart, that never shrinks and takes the row padding of its buttons back', () => {
    expect(rule('.actions')).toMatchObject({
      display: 'flex',
      flex: '0 0 auto',
      'align-items': 'center',
      gap: 'var(--ov-spacing-8)',
      'margin-block': 'calc(-1 * var(--ov-row-pad))',
    });
  });

  it('gives a padded body 12 px above and below and a flush body nothing', () => {
    expect(rule('.body')).toEqual({ 'min-width': '0' });
    expect(rule('.body[data-ov-pad=\'true\']')).toEqual({ padding: 'var(--ov-spacing-12) 0' });
  });
});
