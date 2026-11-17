import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { MiddleEllipsis, type MiddleEllipsisProps } from './MiddleEllipsis';
import * as examples from './MiddleEllipsis.examples';

const NAME = 'report-renderer-7d8c6f49b-7x5nx';

// The two drawn halves are the first two children; each carries its text as an attribute that the stylesheet draws (see the module).
const halves = (root: Element) => [...root.children].slice(0, 2).map((child) => child.getAttribute('data-ov-text'));

/** What assistive technology reads inside `node`: its text, minus whatever is hidden from it (`aria-hidden`). */
function exposedText(node: Node): string {
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') {
    return '';
  }

  return node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '') : [...node.childNodes].map(exposedText).join('');
}

/** The elements that hold `text` as text of their own. */
const holding = (container: Element, text: string) => [...container.querySelectorAll('*')].filter((element) => [...element.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent === text));

describe('MiddleEllipsis', () => {
  describe('a name that can be cut', () => {
    it('is a span in two halves: the head, which gives way, and the tail, which stays whole', () => {
      const { container } = render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
      const root = container.firstElementChild as HTMLElement;
      expect(root.tagName).toBe('SPAN');
      expect(root).toHaveProperty('dataset.ovShape', 'split');
      expect(halves(root)).toEqual(['report-renderer-7d8c6f49b', '-7x5nx']);
      expect([...root.children].map((child) => child.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
    });

    it('reads once, whole, as one text: the halves are drawn and hidden from assistive technology, one element holds the name', () => {
      const { container } = render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
      const root = container.firstElementChild as HTMLElement;
      const [head, tail, name] = [...root.children];
      expect(head?.getAttribute('aria-hidden')).toBe('true');
      expect(tail?.getAttribute('aria-hidden')).toBe('true');
      expect(name?.hasAttribute('aria-hidden')).toBe(false);
      // what is announced is the one string, with no break and no space where the cut falls
      expect(exposedText(root)).toBe(NAME);
      expect(holding(root, NAME)).toEqual([name]);
    });

    it('copies once, whole: the halves hold no text of their own, so a selection and find-in-page meet the name only once', () => {
      const { container } = render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
      const root = container.firstElementChild as HTMLElement;
      expect([...root.children].slice(0, 2).map((half) => half.textContent)).toEqual(['', '']);
      expect(root.textContent).toBe(NAME);
    });

    it('reads as the whole name, once: the halves are one text, and nothing else is drawn', () => {
      const { container } = render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
      expect(container.textContent).toBe(NAME);
      expect(container.querySelector('[title], [role], [aria-label]')).toBeNull();
    });

    it('carries the signal for the tip: the marker of a clipping box, and the whole name for the stylesheet and the host', () => {
      const { container } = render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
      const root = container.firstElementChild as HTMLElement;
      expect(root.hasAttribute('data-ov-clip')).toBe(true);
      expect(root.getAttribute('data-ov-full')).toBe(NAME);
    });

    it('keeps the number of trailing characters the caller says: `-7x5nx` stays whole', () => {
      const { container } = render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
      expect(container.querySelectorAll('span')[2]?.getAttribute('data-ov-text')).toBe('-7x5nx');
      const { container: timestamped } = render(<MiddleEllipsis tail={9}>nightly-backup-28733280</MiddleEllipsis>);
      expect(halves(timestamped.firstElementChild!)).toEqual(['nightly-backup', '-28733280']);
    });

    it('keeps a third of the name, from 6 to 12 characters, when it is not told: the mock\'s rule', () => {
      const tails = new Map<number, number>([
        [13, 6],
        [18, 6],
        [24, 8],
        [31, 10],
        [36, 12],
        [100, 12],
      ]);
      for (const [length, tail] of tails) {
        const name = 'x'.repeat(length - 1) + 'y';
        const { container, unmount } = render(<MiddleEllipsis>{name}</MiddleEllipsis>);
        const [head, end] = halves(container.firstElementChild!);
        expect(end?.length, `a name of ${length} characters`).toBe(tail);
        expect(`${head}${end}`).toBe(name);
        unmount();
      }
    });

    it('never keeps the whole name as its tail: at least one character is left for the head', () => {
      const { container } = render(<MiddleEllipsis tail={99}>abcdefghijklm</MiddleEllipsis>);
      expect(halves(container.firstElementChild!)).toEqual(['a', 'bcdefghijklm']);
    });

    it('takes a tail that is not a positive whole number for no tail, and keeps the default', () => {
      for (const tail of [0, -3, 2.5, Number.NaN]) {
        const { container, unmount } = render(<MiddleEllipsis tail={tail}>{NAME}</MiddleEllipsis>);
        expect(halves(container.firstElementChild!)[1]?.length, String(tail)).toBe(10);
        unmount();
      }
    });

    it('counts characters, not code units: a pair is never split', () => {
      const { container } = render(<MiddleEllipsis tail={1}>{'abcdefghijkl\u{1F600}'}</MiddleEllipsis>);
      expect(halves(container.firstElementChild!)).toEqual(['abcdefghijkl', '\u{1F600}']);
      const { container: twelve } = render(<MiddleEllipsis>{'\u{1F600}'.repeat(12)}</MiddleEllipsis>);
      expect(twelve.firstElementChild).toHaveProperty('dataset.ovShape', 'plain');
    });

    it('keeps the spaces of the name: the halves are not trimmed', () => {
      const { container } = render(<MiddleEllipsis tail={4}>{'first part  and last'}</MiddleEllipsis>);
      expect(halves(container.firstElementChild!)).toEqual(['first part  and ', 'last']);
    });
  });

  describe('a short name', () => {
    it('is one span that holds the name: twelve characters or fewer are cut at the end, if at all', () => {
      const { container } = render(<MiddleEllipsis tail={3}>exactly-12ch</MiddleEllipsis>);
      const root = container.firstElementChild as HTMLElement;
      expect(root.tagName).toBe('SPAN');
      expect(root).toHaveProperty('dataset.ovShape', 'plain');
      expect(root.children).toHaveLength(0);
      expect(root.textContent).toBe('exactly-12ch');
    });

    it('is still a clipping box for the tip, and needs no copy of its name: its own text is the name', () => {
      const { container } = render(<MiddleEllipsis>worker-0</MiddleEllipsis>);
      const root = container.firstElementChild as HTMLElement;
      expect(root.hasAttribute('data-ov-clip')).toBe(true);
      expect(root.hasAttribute('data-ov-full')).toBe(false);
    });

    it('turns into two halves at the thirteenth character', () => {
      const { container } = render(<MiddleEllipsis>exactly-13chr</MiddleEllipsis>);
      expect(container.firstElementChild).toHaveProperty('dataset.ovShape', 'split');
    });

    it('renders an empty name as an empty box', () => {
      const { container } = render(<MiddleEllipsis>{''}</MiddleEllipsis>);
      expect(container.firstElementChild?.textContent).toBe('');
    });
  });

  it('has the elements it says: one for a short name, four for a name that can be cut (the root, the two drawn halves, the name)', () => {
    expect(render(<MiddleEllipsis>worker-0</MiddleEllipsis>).container.querySelectorAll('*')).toHaveLength(1);
    expect(render(<MiddleEllipsis>{NAME}</MiddleEllipsis>).container.querySelectorAll('*')).toHaveLength(4);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = MiddleEllipsis as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { children: NAME, 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', 'aria-label': 'Name', role: 'img' };
    const { getByTestId } = render(<Loose {...loose} />);
    const root = getByTestId('probe');
    expect(root.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'aria-label', 'role']) {
      expect(root.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: a name that is text and a tail that is a number, no className, no style', () => {
    // Types only: these are never rendered.
    const accepted: MiddleEllipsisProps[] = [{ children: NAME }, { children: NAME, tail: 6 }, { children: NAME, tail: undefined, 'data-testid': 'probe' }];
    // @ts-expect-error a name is required
    const nameless: MiddleEllipsisProps = {};
    // @ts-expect-error the name is text, not an element
    const elementName: MiddleEllipsisProps = { children: <b>{NAME}</b> };
    // @ts-expect-error a tail is a number of characters
    const textTail: MiddleEllipsisProps = { children: NAME, tail: '6' };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: MiddleEllipsisProps = { children: NAME, className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: MiddleEllipsisProps = { children: NAME, style: { width: 10 } };
    // @ts-expect-error a title is not a prop: the tip is the shared host's, shown only while the name is cut
    const withTitle: MiddleEllipsisProps = { children: NAME, title: NAME };
    expect([accepted, nameless, elementName, textTail, withClass, withStyle, withTitle]).toHaveLength(7);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(<MiddleEllipsis tail={6}>{NAME}</MiddleEllipsis>);
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The stylesheet, as the rules it holds (jsdom lays nothing out: the cut itself is probed in WebKit and Chromium, packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'MiddleEllipsis.module.css'), 'utf8');
const rule = (selector: string, within?: string) => declarationsOf(css, selector, within);

describe('the MiddleEllipsis stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('makes the root the clipping box, in both shapes, so the host can measure the cut on it: overflow hidden, never visible', () => {
    expect(rule('.root[data-ov-shape=\'split\']')).toMatchObject({ position: 'relative', display: 'flex', 'min-width': '0', 'max-width': '100%', overflow: 'hidden' });
    expect(rule('.root[data-ov-shape=\'plain\']')).toMatchObject({ display: 'block', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
    expect(css).not.toMatch(/overflow(?:-x)?\s*:\s*visible/);
  });

  it('lets the head give way with an ellipsis and keeps the tail whole, on one line', () => {
    expect(rule('.head')).toMatchObject({ flex: '0 1 auto', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'pre' });
    expect(rule('.tail')).toMatchObject({ flex: '0 0 auto', 'white-space': 'pre' });
  });

  it('measures the cut with a hidden copy of the whole name, so the root\'s scroll width is the width of the full name', () => {
    expect(rule('.root[data-ov-shape=\'split\']::after')).toMatchObject({
      content: 'attr(data-ov-full)',
      position: 'absolute',
      'inset-block-start': '0',
      'inset-inline-start': '0',
      visibility: 'hidden',
      'white-space': 'pre',
      'pointer-events': 'none',
    });
  });

  it('draws the halves from their attribute and the name as text nobody sees: a halves\' text is generated, the name is real and takes no room', () => {
    expect(rule('.head::before')).toMatchObject({ content: 'attr(data-ov-text)' });
    expect(rule('.tail::before')).toMatchObject({ content: 'attr(data-ov-text)' });
    expect(rule('.name')).toMatchObject({ position: 'absolute', 'inline-size': '1px', 'block-size': '1px', overflow: 'hidden', 'clip-path': 'inset(50%)', 'white-space': 'nowrap', 'pointer-events': 'none' });
  });

  it('gives the pointer to the root, not to the halves, so one hover lands on the box that holds the whole name', () => {
    expect(rule('.head')['pointer-events']).toBe('none');
    expect(rule('.tail')['pointer-events']).toBe('none');
  });

  it('takes the type of the context it sits in: it declares no font, no colour and no spacing', () => {
    const declared = new Set(cssRules(css).flatMap((entry) => Object.keys(entry.declarations)));
    for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'padding', 'margin', 'letter-spacing']) {
      expect(declared.has(property), property).toBe(false);
    }
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a MiddleEllipsis is shown in.
type Row = { readonly text: string; readonly shape: 'plain' | 'split'; readonly halves?: readonly [string, string] };
const MATRIX: Readonly<Record<string, Row>> = {
  Short: { text: 'worker-0', shape: 'plain' },
  GeneratedName: { text: NAME, shape: 'split', halves: ['report-renderer-7d8c6f49b', '-7x5nx'] },
  LongGeneratedName: { text: 'payments-reconciliation-worker-6f9d8b7c5d-x7k2m', shape: 'split', halves: ['payments-reconciliation-worker-6f9d8b7c5d', '-x7k2m'] },
  Timestamped: { text: 'nightly-backup-28733280', shape: 'split', halves: ['nightly-backup', '-28733280'] },
  DefaultTail: { text: 'a-long-name-with-no-tail-rule-at-all-1234567', shape: 'split', halves: ['a-long-name-with-no-tail-rule-at', '-all-1234567'] },
  TwelveCharacters: { text: 'exactly-12ch', shape: 'plain' },
  ThirteenCharacters: { text: 'exactly-13chr', shape: 'split', halves: ['exactly', '-13chr'] },
};

describe('MiddleEllipsis examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${row.text}, a ${row.shape} box`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const root = container.querySelector<HTMLElement>('[data-ov-clip]');
      expect(root, 'the clipping box').not.toBeNull();
      expect(root?.getAttribute('data-ov-shape')).toBe(row.shape);
      // the name reads once and whole, whatever is cut on screen
      expect(container.textContent).toBe(row.text);
      expect(exposedText(container)).toBe(row.text);
      if (row.halves !== undefined) {
        expect(halves(root as Element)).toEqual([...row.halves]);
        expect(root?.getAttribute('data-ov-full')).toBe(row.text);
      }

      // text, not a control, and named by nothing but its own words
      expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
      expect(container.querySelector('[title], [role], [aria-label]')).toBeNull();
    });
  }
});
