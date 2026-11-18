import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, type Harness } from '../core/tabs/testing';
import type * as Hooks from './hooks';
import { Shell } from '../Shell';

// The render-count guard of the tab model's one-slice-per-component design (core/tabs/README.md, "One snapshot, one slice each"): a title that changes in one tab renders that tab and
// nothing else. The hooks the components read the model through are wrapped here to count calls (a call is a render of the component that makes it) and delegate to the real ones.

const counts = vi.hoisted(() => ({ strip: 0, item: new Map<string, number>(), slot: new Map<string, number>() }));

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    useTabIds: (...args: Parameters<typeof actual.useTabIds>) => {
      counts.strip += 1;
      return actual.useTabIds(...args);
    },
    useStripItem: (...args: Parameters<typeof actual.useStripItem>) => {
      counts.item.set(args[1], (counts.item.get(args[1]) ?? 0) + 1);
      return actual.useStripItem(...args);
    },
    useLocation: (...args: Parameters<typeof actual.useLocation>) => {
      if (args[1] !== null) {
        counts.slot.set(args[1], (counts.slot.get(args[1]) ?? 0) + 1);
      }

      return actual.useLocation(...args);
    },
  };
});

function mount(): { readonly h: Harness; readonly ids: readonly string[]; readonly pageRenders: Map<string, number> } {
  const h = boot({ home: false });
  const ids = h.openAll(['alpha', 'beta', 'gamma']);
  h.store.goto(1);
  const pageRenders = new Map<string, number>();
  render(
    <Shell
      registration={{ plugin: { name: 'Cloud' } }}
      tabs={h.store}
      renderPage={({ id }) => {
        pageRenders.set(id, (pageRenders.get(id) ?? 0) + 1);
        return <p>{`page of ${id}`}</p>;
      }}
      empty={null}
    />,
  );
  return { h, ids, pageRenders };
}

const reset = () => {
  counts.strip = 0;
  counts.item.clear();
  counts.slot.clear();
};

const items = (ids: readonly string[]) => ids.map((id) => counts.item.get(id) ?? 0);
const slots = (ids: readonly string[]) => ids.map((id) => counts.slot.get(id) ?? 0);

beforeEach(reset);
afterEach(cleanup);

describe('a title that changes in one tab', () => {
  it('renders that one tab, and not the strip, the other tabs or any page', () => {
    const { h, ids, pageRenders } = mount();
    // Each tab and each page drew once on the first render (the strip and the status bar may draw more while the model settles: only what follows is the guard).
    expect(items(ids).every((count) => count >= 1)).toBe(true);
    reset();
    pageRenders.clear();

    act(() => {
      h.world.retitle('cloud', (route, original) => (route.contribution === 'beta' ? `${original} renamed` : original));
      h.world.changed();
    });

    expect(h.titles()).toEqual(['Alpha', 'Beta renamed', 'Gamma']);
    expect(counts.strip).toBe(0);
    expect(items(ids)).toEqual([0, 1, 0]);
    expect(slots(ids)).toEqual([0, 0, 0]);
    expect([...pageRenders.values()]).toEqual([]);
  });

  it('shows the new title in that tab', () => {
    const { h } = mount();

    act(() => {
      h.world.retitle('cloud', (route, original) => (route.contribution === 'beta' ? 'Renamed' : original));
      h.world.changed();
    });

    expect(document.querySelector(`[role="tab"][data-tab-id="${h.ids()[1]}"]`)).toHaveAttribute('aria-label', 'Renamed');
  });
});

describe('activating another tab', () => {
  it('renders the strip once, with its tabs and its page slots, and draws no page again', () => {
    const { h, ids, pageRenders } = mount();
    reset();
    pageRenders.clear();

    act(() => {
      h.store.activate(ids[2]);
    });

    // These numbers are the guard: a change that makes any of them larger renders more than it did. The strip reads the tab on screen, so it renders once; its tabs are drawn by it
    // (the one that was on screen and the one that is, and the third, which is not memoised), and each page slot is drawn by the page host, which reads the tab on screen too.
    expect(counts.strip).toBe(1);
    expect(items(ids)).toEqual([1, 1, 1]);
    expect(slots(ids)).toEqual([1, 1, 1]);
    expect([...pageRenders.values()]).toEqual([]);
  });
});
