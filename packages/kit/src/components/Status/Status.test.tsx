import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Status, type StatusProps, type StatusRole } from './Status';
import { STATUS_GLYPHS, STATUS_ROLES } from './roles';
import * as examples from './Status.examples';

const glyphOf = (container: HTMLElement) => container.querySelector('svg')?.getAttribute('data-ov-glyph');
const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

// The seven roles of the design (13 SR1), the glyph each one owns, and the word of each in the table's own examples.
const ROLES: ReadonlyArray<readonly [StatusRole, string, string]> = [
  ['healthy', 'status-success', 'Passed'],
  ['running', 'play', 'Running'],
  ['progress', 'loader-circle', 'Shutting down'],
  ['attention', 'status-warning', 'Attention'],
  ['error', 'status-error', 'Failed'],
  ['stopped', 'circle-minus', 'Stopped'],
  ['info', 'status-info', 'Update available'],
];

describe('the state-role table', () => {
  it('has the seven roles of the design, no more', () => {
    expect([...STATUS_ROLES].sort()).toEqual(['attention', 'error', 'healthy', 'info', 'progress', 'running', 'stopped']);
  });

  it('gives each role the glyph the design fixes for it', () => {
    for (const [role, glyph] of ROLES) {
      expect(STATUS_GLYPHS[role], role).toBe(glyph);
    }
  });

  it('draws one meaning with one glyph: no glyph is shared by two roles, and the clock of queued work is none of them', () => {
    const glyphs = [...Object.values(STATUS_GLYPHS), 'clock'];
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe('Status', () => {
  it('is a span that holds a glyph and the word, and its text is the word', () => {
    const { container } = render(<Status role="running">Running</Status>);
    const status = container.firstElementChild as HTMLElement;
    expect(status.tagName).toBe('SPAN');
    expect(status.textContent).toBe('Running');
    expect(status.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    for (const attribute of ['role', 'aria-label', 'title', 'tabindex', 'style', 'aria-hidden']) {
      expect(status.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  describe('each role', () => {
    for (const [role, glyph, word] of ROLES) {
      it(`${role}: the glyph ${glyph} beside the word ${word}, the glyph hidden from assistive technology`, () => {
        const { container } = render(<Status role={role}>{word}</Status>);
        expect(container.firstElementChild).toHaveProperty('dataset.ovRole', role);
        expect(glyphOf(container)).toBe(glyph);
        expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
        expect(container.textContent).toBe(word);
        // never colour alone: a glyph and a word, always both
        expect(container.querySelectorAll('svg')).toHaveLength(1);
        expect(container.textContent?.trim().length).toBeGreaterThan(0);
      });
    }

    it('keeps the platform\'s own word: the role chooses the glyph, never the spelling', () => {
      const { container } = render(<Status role="error">CrashLoopBackOff</Status>);
      expect(container.textContent).toBe('CrashLoopBackOff');
    });
  });

  describe('progress', () => {
    it('draws the loader for work under way and the clock for work that waits to start', () => {
      const { container, rerender } = render(<Status role="progress">Shutting down</Status>);
      expect(glyphOf(container)).toBe('loader-circle');
      rerender(
        <Status role="progress" queued>
          Pending
        </Status>,
      );
      expect(glyphOf(container)).toBe('clock');
      expect(container.firstElementChild).toHaveProperty('dataset.ovRole', 'progress');
      rerender(
        <Status role="progress" queued={false}>
          Shutting down
        </Status>,
      );
      expect(glyphOf(container)).toBe('loader-circle');
    });
  });

  describe('a boolean is not a state (13 SR2)', () => {
    for (const word of ['Yes', 'No', 'True', 'False', 'yes', 'NO', ' true ']) {
      it(`prints "${word.trim()}" as plain words: no glyph, no element of its own`, () => {
        const { container } = render(<Status role="stopped">{word}</Status>);
        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelectorAll('*')).toHaveLength(0);
        expect(container.textContent).toBe(word);
      });
    }

    it('draws a word that merely starts like a boolean, a state of the platform', () => {
      const { container } = render(<Status role="info">Nominal</Status>);
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });

  it('has the elements it says: a span, the glyph and one path per paint, and the word as plain text: three, four for the two-tone glyphs', () => {
    expect(count(<Status role="running">Running</Status>)).toBe(3);
    expect(count(<Status role="progress">Shutting down</Status>)).toBe(3);
    expect(count(<Status role="progress" queued>Pending</Status>)).toBe(3);
    expect(count(<Status role="stopped">Stopped</Status>)).toBe(3);
    expect(count(<Status role="healthy">Passed</Status>)).toBe(4);
    expect(count(<Status role="attention">Attention</Status>)).toBe(4);
    expect(count(<Status role="error">Failed</Status>)).toBe(4);
    expect(count(<Status role="info">Update available</Status>)).toBe(4);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = Status as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { role: 'running', children: 'Running', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', tabIndex: 3 };
    render(<Loose {...loose} />);
    const status = screen.getByTestId('probe');
    expect(status.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'tabindex']) {
      expect(status.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: a role of the table, the platform\'s word, a clock only for progress, no className, no style', () => {
    // Types only: these are never rendered.
    const accepted: StatusProps[] = [
      { role: 'running', children: 'Running' },
      { role: 'progress', children: 'Pending', queued: true },
      { role: 'progress', children: 'Shutting down', queued: undefined },
      { role: 'error', children: 'Failed', 'data-testid': 'probe' },
    ];
    // @ts-expect-error a state has a role
    const roleless: StatusProps = { children: 'Running' };
    // @ts-expect-error a role outside the table
    const unknownRole: StatusProps = { role: 'success', children: 'Passed' };
    // @ts-expect-error a state has a word
    const wordless: StatusProps = { role: 'running' };
    // @ts-expect-error the word is text, not an element
    const elementWord: StatusProps = { role: 'running', children: <b>Running</b> };
    // @ts-expect-error only work in motion can be queued
    const queuedRunning: StatusProps = { role: 'running', children: 'Running', queued: true };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: StatusProps = { role: 'running', children: 'Running', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: StatusProps = { role: 'running', children: 'Running', style: { color: 'red' } };
    // @ts-expect-error a glyph is the role's, never the caller's
    const withIcon: StatusProps = { role: 'running', children: 'Running', icon: 'check' };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: StatusProps = { role: 'running', children: 'Running', title: 'hint' };
    expect([accepted, roleless, unknownRole, wordless, elementWord, queuedRunning, withClass, withStyle, withIcon, withTitle]).toHaveLength(10);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(<Status role="running">Running</Status>);
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The stylesheet, as the rules it holds (jsdom lays nothing out; a browser's layout is probed in packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'Status.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Status stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the state of the mock: the glyph, 4 px, the word at 13/16 regular in the plain text colour, one line, never clipped, never shrunk', () => {
    expect(rule('.root')).toMatchObject({
      display: 'inline-flex',
      'flex-shrink': '0',
      'align-items': 'center',
      gap: 'var(--ov-spacing-4)',
      'min-width': '0',
      'vertical-align': 'middle',
      color: 'var(--ov-fg)',
      'font-size': 'var(--ov-fs-13)',
      'line-height': 'var(--ov-lh-16)',
      'font-weight': '400',
      'font-feature-settings': 'var(--ov-font-features)',
      'white-space': 'nowrap',
    });
  });

  it('puts the glyph in the icon role, and the glyphs that pin a paint of their own keep it', () => {
    expect(rule('.root > svg')).toEqual({ color: 'var(--ov-icon)' });
  });

  it('never paints the word in a state colour: severity is the glyph\'s, the word stays plain', () => {
    expect(css).not.toMatch(/--ov-(?:success|warning|error|info)/);
    expect(css).not.toMatch(/opacity\s*:/);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a Status is shown in.
type Row = {
  readonly words: readonly string[];
  readonly glyphs: readonly string[];
};
const MATRIX: Readonly<Record<string, Row>> = {
  Healthy: { words: ['Passed'], glyphs: ['status-success'] },
  Running: { words: ['Running'], glyphs: ['play'] },
  InProgress: { words: ['Shutting down'], glyphs: ['loader-circle'] },
  Queued: { words: ['Pending'], glyphs: ['clock'] },
  Attention: { words: ['Attention'], glyphs: ['status-warning'] },
  Failed: { words: ['Failed'], glyphs: ['status-error'] },
  Stopped: { words: ['Stopped'], glyphs: ['circle-minus'] },
  Info: { words: ['Update available'], glyphs: ['status-info'] },
  AllRoles: {
    words: ['Passed', 'Running', 'Shutting down', 'Pending', 'Attention', 'Failed', 'Stopped', 'Update available'],
    glyphs: ['status-success', 'play', 'loader-circle', 'clock', 'status-warning', 'status-error', 'circle-minus', 'status-info'],
  },
  BooleanWord: { words: ['No'], glyphs: [] },
};

describe('Status examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${row.words.join(', ')} with ${row.glyphs.length === 0 ? 'no glyph' : row.glyphs.join(', ')}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      // the words are in the page's text, once each and in order: that is the name a reader meets
      const text = container.textContent ?? '';
      let from = 0;
      for (const word of row.words) {
        const at = text.indexOf(word, from);
        expect(at, `${word} in ${text}`).toBeGreaterThanOrEqual(from);
        from = at + word.length;
      }

      // the glyphs, in order: hidden from assistive technology, so a state is never colour or shape alone
      const glyphs = [...container.querySelectorAll('svg')];
      expect(glyphs.map((glyph) => glyph.getAttribute('data-ov-glyph'))).toEqual([...row.glyphs]);
      for (const glyph of glyphs) {
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
      }

      // a status is text beside a glyph: nothing to tab to, nothing named by anything but its words
      expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
      expect(container.querySelector('[title], [role], [aria-label]')).toBeNull();
    });
  }
});
