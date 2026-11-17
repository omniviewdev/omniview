import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { CollectionCount, countText, type CollectionCountProps } from './CollectionCount';
import { CollectionFooter, type CollectionFooterProps } from './CollectionFooter';
import * as examples from './CollectionFooter.examples';

const count = (props: Partial<CollectionCountProps> = {}) => (
  <CollectionCount shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" {...props} />
);

const text = (props: Partial<CollectionCountProps>) => {
  const { container, unmount } = render(count(props));
  const read = container.textContent;
  unmount();
  return read;
};

describe('CollectionCount', () => {
  describe('an exact total (design 13 N1)', () => {
    it('is the count and its noun when everything is shown', () => {
      expect(text({ shown: 89, total: { kind: 'exact', value: 89 } })).toBe('89 items');
    });

    it('is "N of M" and the plural of the total when the list is filtered', () => {
      expect(text({ shown: 12, total: { kind: 'exact', value: 89 } })).toBe('12 of 89 items');
      expect(text({ shown: 0, total: { kind: 'exact', value: 24 } })).toBe('0 of 24 items');
    });

    it('uses the singular for one, and for a total of one', () => {
      expect(text({ shown: 1, total: { kind: 'exact', value: 1 } })).toBe('1 item');
      expect(text({ shown: 0, total: { kind: 'exact', value: 1 } })).toBe('0 of 1 item');
      expect(text({ shown: 1, total: { kind: 'exact', value: 24 } })).toBe('1 of 24 items');
    });

    it('counts nothing as a plural, and groups thousands', () => {
      expect(text({ shown: 0, total: { kind: 'exact', value: 0 } })).toBe('0 items');
      expect(text({ shown: 5025, total: { kind: 'exact', value: 5025 } })).toBe('5,025 items');
      expect(text({ shown: 1000, total: { kind: 'exact', value: 5025 } })).toBe('1,000 of 5,025 items');
    });

    it('takes counts as decimal strings too, exactly, however large', () => {
      expect(text({ shown: '89', total: { kind: 'exact', value: '89' } })).toBe('89 items');
      expect(text({ shown: '12', total: { kind: 'exact', value: '9007199254740993' } })).toBe('12 of 9,007,199,254,740,993 items');
      // leading zeros are not part of the number
      expect(text({ shown: '007', total: { kind: 'exact', value: '007' } })).toBe('7 items');
    });
  });

  describe('a total that is not known yet (decision A10)', () => {
    it('says how many are loaded, in the mock\'s words, while the rest is on its way', () => {
      expect(text({ shown: 89, total: { kind: 'unknown' } })).toBe('89 items loaded');
      expect(text({ shown: 1, total: { kind: 'unknown' } })).toBe('1 item loaded');
      expect(text({ shown: 0, total: { kind: 'unknown' } })).toBe('0 items loaded');
      expect(text({ shown: 256, total: { kind: 'unknown', loaded: 256 } })).toBe('256 items loaded');
    });

    it('says how many are shown of how many are loaded when a search or a filter hides some', () => {
      expect(text({ shown: 50, total: { kind: 'unknown', loaded: 89 } })).toBe('50 shown · 89 loaded');
      expect(text({ shown: 0, total: { kind: 'unknown', loaded: 256 } })).toBe('0 shown · 256 loaded');
    });
  });

  describe('an estimated total', () => {
    it('says "About" and never a count as if it were exact', () => {
      expect(text({ shown: 120, total: { kind: 'estimate', value: 120 } })).toBe('About 120 items');
      expect(text({ shown: 50, total: { kind: 'estimate', value: 120 } })).toBe('50 shown · About 120 items');
      expect(text({ shown: 1, total: { kind: 'estimate', value: 1 } })).toBe('About 1 item');
    });
  });

  it('refuses a count that is not a non-negative whole number: a wrong count is worse than none', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', '1.5', '-3', '1e3', ' 4']) {
      expect(() => render(count({ shown: bad })), String(bad)).toThrow(TypeError);
    }

    expect(() => render(count({ total: { kind: 'exact', value: -2 } }))).toThrow(TypeError);
  });

  it('is one span, tabular and on one line, with nothing but the text in it', () => {
    const { container } = render(count());
    const span = container.firstElementChild as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.children).toHaveLength(0);
    expect(span.hasAttribute('role')).toBe(false);
    expect(countText(89, { kind: 'exact', value: 89 }, 'item', 'items')).toBe('89 items');
  });
});

const footer = (props: Partial<CollectionFooterProps> = {}) => (
  <CollectionFooter shown={89} total={{ kind: 'exact', value: 89 }} noun="item" plural="items" {...props} />
);

describe('CollectionFooter', () => {
  describe('the lane (design 13 G1 to G5)', () => {
    it('holds the count in its leading cluster, which is a live region', () => {
      render(footer());
      const status = screen.getByRole('status');
      expect(status.textContent).toBe('89 items');
      expect(status).toHaveProperty('dataset.ovCluster', 'lead');
    });

    it('is one lane in the order the design gives: count, then selection; there is nothing else to say about a healthy collection', () => {
      const { container } = render(footer({ selected: 3 }));
      const lane = container.firstElementChild as HTMLElement;
      expect(lane.children).toHaveLength(1);
      expect(within(lane).getByRole('status').textContent).toBe('89 items3 selected');
      expect([...(lane.firstElementChild?.children ?? [])].map((child) => child.textContent)).toEqual(['89 items', '3 selected']);
    });

    it('writes "N selected" only while something is selected, grouped like the count', () => {
      const { rerender } = render(footer({ selected: 0 }));
      expect(screen.queryByText(/selected/)).toBeNull();
      rerender(footer({ selected: 1200 }));
      expect(screen.getByText('1,200 selected')).toBeTruthy();
      rerender(footer());
      expect(screen.queryByText(/selected/)).toBeNull();
    });

    it('draws a trailing cluster only when there is something ambient to say', () => {
      const { container, rerender } = render(footer());
      expect(container.querySelector('[data-ov-cluster="end"]')).toBeNull();
      rerender(footer({ refreshing: true }));
      expect(container.querySelector('[data-ov-cluster="end"]')).not.toBeNull();
    });

    it('is not a landmark, has no heading and carries no title', () => {
      const { container } = render(footer({ selected: 2, refreshing: true, hiddenColumns: { names: ['Node'] } }));
      for (const role of ['contentinfo', 'banner', 'navigation', 'heading', 'region']) {
        expect(screen.queryByRole(role), role).toBeNull();
      }

      expect(container.querySelector('[title], [style]')).toBeNull();
    });

    it('passes data attributes through, and nothing else', () => {
      const { container } = render(footer({ 'data-testid': 'lane' }));
      expect(container.firstElementChild?.getAttribute('data-testid')).toBe('lane');
    });
  });

  describe('Refreshing (design 14 P2: a reason is also written where the user reads the page)', () => {
    it('says "Refreshing…" in the trailing cluster as a quiet status with the loader glyph, and nothing when it is not refreshing', () => {
      const { rerender } = render(footer({ refreshing: true }));
      const item = screen.getByText('Refreshing…');
      expect(item.closest('[role="status"]')).not.toBeNull();
      expect(item.parentElement?.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('loader');
      rerender(footer({ refreshing: false }));
      expect(screen.queryByText('Refreshing…')).toBeNull();
    });
  });

  describe('hidden columns (the mock\'s width note)', () => {
    it('says how many columns the width dropped, in the trailing cluster, and names them in its tip', () => {
      render(footer({ hiddenColumns: { names: ['Node', 'IP'] } }));
      const note = screen.getByText('2 columns hidden at this width');
      expect(note.getAttribute('data-ov-tip')).toBe('Node, IP fit a wider list. Choose them in Columns.');
      expect(note.closest('[data-ov-cluster="end"]')).not.toBeNull();
    });

    it('uses the singular for one column and says nothing for none', () => {
      const { rerender } = render(footer({ hiddenColumns: { names: ['Node'] } }));
      expect(screen.getByText('1 column hidden at this width').getAttribute('data-ov-tip')).toBe('Node fits a wider list. Choose it in Columns.');
      rerender(footer({ hiddenColumns: { names: [] } }));
      expect(screen.queryByText(/hidden at this width/)).toBeNull();
    });
  });

  describe('the count it shows', () => {
    it('is the count of the collection, in every wording', () => {
      const { rerender } = render(footer({ shown: 12, total: { kind: 'exact', value: 89 } }));
      expect(screen.getByRole('status').textContent).toBe('12 of 89 items');
      rerender(footer({ shown: 89, total: { kind: 'unknown' } }));
      expect(screen.getByRole('status').textContent).toBe('89 items loaded');
      rerender(footer({ shown: 50, total: { kind: 'unknown', loaded: 89 } }));
      expect(screen.getByRole('status').textContent).toBe('50 shown · 89 loaded');
    });
  });

  it('is the same few elements however much it says', () => {
    const elements = (element: ReactElement) => {
      const { container, unmount } = render(element);
      const total = container.querySelectorAll('*').length;
      unmount();
      return total;
    };

    // lane, cluster, count
    expect(elements(footer())).toBe(3);
    // + selected
    expect(elements(footer({ selected: 3 }))).toBe(4);
  });
});

describe('the examples of CollectionFooter', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for every wording of the count and for each ambient item', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      ['Default', 'Estimated', 'Filtered', 'HiddenColumns', 'Loaded', 'LoadedAndFiltered', 'Refreshing', 'Selected'].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with no title and no inline style`, () => {
      const { container } = render(<Example />);
      expect(container.textContent).not.toBe('');
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }
});

const css = await readFile(path.join(import.meta.dirname, 'CollectionFooter.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the CollectionFooter stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s lane: one flex line, 12/16 muted tabular type, an 8 px block and a 12 px inline inset, a 1 px subtle separator on top, 33 px with it', () => {
    const root = rule('.root');
    expect(root.display).toBe('flex');
    expect(root['flex-wrap']).toBe('wrap');
    expect(root['align-items']).toBe('center');
    expect(root['justify-content']).toBe('space-between');
    expect(root.gap).toBe('var(--ov-spacing-12)');
    expect(root['min-height']).toBe('33px');
    expect(root.padding).toBe('var(--ov-spacing-4) var(--ov-spacing-12)');
    expect(root['border-top']).toBe('1px solid var(--ov-border-subtle)');
    expect(root.color).toBe('var(--ov-fg-muted)');
    expect(root['font-size']).toBe('var(--ov-fs-12)');
    expect(root['line-height']).toBe('var(--ov-lh-16)');
    expect(root['font-variant-numeric']).toBe('tabular-nums');
    expect(root['white-space']).toBe('nowrap');
    expect(root['box-sizing']).toBe('border-box');
  });

  it('keeps the clusters 12 px apart inside, and pushes the trailing one to the end', () => {
    expect(rule('.cluster')).toMatchObject({ display: 'inline-flex', 'align-items': 'center', gap: 'var(--ov-spacing-12)', 'min-width': '0' });
    expect(rule('.cluster[data-ov-cluster=\'end\']')['margin-inline-start']).toBe('auto');
  });

  it('draws a plain number in the plain weight: the footer has no emphasis of its own (G1)', () => {
    const declared = new Set(cssRules(css).flatMap((entry) => Object.values(entry.declarations)));
    expect(declared.has('600')).toBe(false);
    expect(declared.has('bold')).toBe(false);
  });

  it('spins the refreshing loader, and holds it still under reduced motion', () => {
    expect(css).toMatch(/@keyframes\s+\w+\s*\{/);
    expect(declarationsOf(css, '.refreshing > svg', 'prefers-reduced-motion')).toMatchObject({ animation: 'none' });
  });

  it('uses only tokens for colour and type, and no hex colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });
});
