import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeepAlive, TabRoute } from '../core/tabs';
import { boot, cloudPage } from '../core/tabs/testing';
import { Shell } from '../Shell';

// The page host draws the pages of the tabs the model says are mounted. Every page here is the same invented one, keyed by the page it was opened for: a counter with state, and an
// interval that is the stand-in for a subscription. The effects it logs are what React's Activity releases when a page is hidden.

const log: string[] = [];
const ticks: Record<string, number> = {};

function pageName(route: TabRoute): string {
  if (route.kind === 'extension-view') {
    throw new Error('Expected an ordinary cloud page');
  }

  return route.contribution;
}

function Page({ name }: { readonly name: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    log.push(`on ${name}`);
    const timer = setInterval(() => {
      ticks[name] = (ticks[name] ?? 0) + 1;
    }, 100);
    return () => {
      log.push(`off ${name}`);
      clearInterval(timer);
    };
  }, [name]);

  return (
    <button
      type="button"
      onClick={() => {
        setCount(count + 1);
      }}
    >{`${name} ${String(count)}`}</button>
  );
}

function mount(pages: readonly string[], options: { readonly keepAlive?: KeepAlive; readonly layout?: 'document' | 'pane' } = {}) {
  const h = boot({ home: false, ...(options.keepAlive ? { keepAlive: options.keepAlive } : {}) });
  const ids = h.openAll(pages);
  render(
    <Shell
      registration={{ plugin: { name: 'Cloud' }, ...(options.layout ? { layout: options.layout } : {}) }}
      tabs={h.store}
      renderPage={({ location }) => <Page name={pageName(location.route)} />}
      empty={<p>Nothing open</p>}
    />,
  );
  return { h, ids, user: userEvent.setup() };
}

const slots = () => [...document.querySelectorAll<HTMLElement>('[data-page-slot]')];
const slotOf = (id: string) => slots().find((slot) => slot.dataset.tabId === id);
const shown = (slot: HTMLElement | undefined) => slot !== undefined && slot.style.display !== 'none';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  log.length = 0;
  for (const key of Object.keys(ticks)) {
    Reflect.deleteProperty(ticks, key);
  }
});

describe('which pages are drawn', () => {
  it('draws the tab on screen, in a slot of the one page region, and nothing for a tab that was never shown', async () => {
    const { h } = mount(['alpha']);
    const background = await act(() => h.open(cloudPage('beta'), { how: 'background' }));

    expect(slots()).toHaveLength(1);
    expect(slotOf(background)).toBeUndefined();
    expect(screen.getByRole('tabpanel')).toContainElement(slots()[0]);
    expect(screen.getByRole('button', { name: 'alpha 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^beta/ })).toBeNull();
  });

  it('draws a page the first time its tab is shown, and keeps it afterwards, hidden', () => {
    const { h, ids } = mount(['alpha', 'beta', 'gamma']);

    expect(slots()).toHaveLength(3);
    expect(slots().map((slot) => slot.dataset.tabId)).toEqual(ids);
    expect(shown(slotOf(ids[2]))).toBe(true);
    expect(shown(slotOf(ids[0]))).toBe(false);
    expect(shown(slotOf(ids[1]))).toBe(false);

    act(() => {
      h.store.activate(ids[0]);
    });
    expect(slots().map((slot) => shown(slot))).toEqual([true, false, false]);
  });

  it('hides a page with display none, not by taking it out', () => {
    const { ids } = mount(['alpha', 'beta']);

    expect(slotOf(ids[0])).toHaveStyle({ display: 'none' });
    expect(slotOf(ids[0])).toContainElement(document.querySelector('[data-page-slot] button'));
  });

  it('shows what the host says, and no slot and no tabpanel, while no tab is on screen', () => {
    const { h, ids } = mount(['alpha']);
    h.world.setHome(false);
    act(() => {
      h.store.close(ids[0]);
    });

    expect(slots()).toHaveLength(0);
    expect(screen.getByText('Nothing open')).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(document.querySelector('[data-shell-part="page"]')).toBeInTheDocument();
  });

  it('is the document layout, with a tab stop of its own, or a pane that scrolls nothing and has none', () => {
    mount(['alpha']);
    const region = document.querySelector('[data-shell-part="page"]');
    expect(region).toHaveAttribute('data-layout', 'document');
    expect(region).toHaveProperty('tabIndex', 0);
    cleanup();

    mount(['alpha'], { layout: 'pane' });
    expect(document.querySelector('[data-shell-part="page"]')).toHaveAttribute('data-layout', 'pane');
    expect(document.querySelector('[data-shell-part="page"]')).not.toHaveAttribute('tabindex');
    expect(document.querySelector('[data-page-slot]')).toHaveAttribute('data-layout', 'pane');
  });
});

describe('keeping a page alive', () => {
  it('keeps a hidden page\'s state: it comes back as it was left', async () => {
    const { h, ids, user } = mount(['alpha', 'beta']);

    await user.click(screen.getByRole('button', { name: 'beta 0' }));
    await user.click(screen.getByRole('button', { name: 'beta 1' }));
    act(() => {
      h.store.activate(ids[0]);
    });
    expect(screen.queryByRole('button', { name: 'beta 2', hidden: false })).toBeNull();

    act(() => {
      h.store.activate(ids[1]);
    });
    expect(screen.getByRole('button', { name: 'beta 2' })).toBeInTheDocument();
  });

  it('releases a hidden page\'s effects and runs them again when it is shown: no timer and no subscription in the background', () => {
    vi.useFakeTimers();
    const { h, ids } = mount(['alpha', 'beta']);
    // The page that was never on screen has not run an effect: a page drawn hidden stays idle until it is shown.
    expect(log).toEqual(['on beta']);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(ticks).toEqual({ beta: 3 });

    act(() => {
      h.store.activate(ids[0]);
    });
    expect(log).toContain('off beta');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(ticks).toEqual({ alpha: 3, beta: 3 });

    act(() => {
      h.store.activate(ids[1]);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(ticks).toEqual({ alpha: 3, beta: 5 });
  });

  it('unmounts a page the cap evicts: its state is lost, and it is drawn from scratch when it is shown again', async () => {
    const { h, ids, user } = mount(['p1']);
    await user.click(screen.getByRole('button', { name: 'p1 0' }));
    expect(screen.getByRole('button', { name: 'p1 1' })).toBeInTheDocument();

    // The default policy keeps five: the sixth tab shown takes the place of the one shown longest ago.
    let more: readonly string[] = [];
    act(() => {
      more = h.openAll(['p2', 'p3', 'p4', 'p5', 'p6']);
    });
    expect(slots()).toHaveLength(5);
    expect(slotOf(ids[0])).toBeUndefined();
    expect(log).toContain('off p1');
    expect(h.store.getSnapshot().mounted).toHaveLength(5);

    act(() => {
      h.store.activate(ids[0]);
    });
    expect(screen.getByRole('button', { name: 'p1 0' })).toBeInTheDocument();
    expect(slotOf(more[0])).toBeUndefined();
  });

  it('never evicts a tab with unsaved changes, and does not count it toward the cap', () => {
    const { h, ids } = mount(['p1']);
    act(() => {
      h.store.setUnsaved(ids[0], true);
      h.openAll(['p2', 'p3', 'p4', 'p5', 'p6']);
    });

    expect(slotOf(ids[0])).toBeDefined();
    expect(slots()).toHaveLength(6);
  });

  it('follows the policy the model changes: a cap of one keeps only the page on screen', () => {
    const { h, ids } = mount(['alpha', 'beta', 'gamma'], { keepAlive: { cap: 1, keepUnsaved: true } });

    expect(slots().map((slot) => slot.dataset.tabId)).toEqual([ids[2]]);
    act(() => {
      h.store.activate(ids[0]);
    });
    expect(slots().map((slot) => slot.dataset.tabId)).toEqual([ids[0]]);
  });

  it('draws a page from scratch when its tab moves to another page, and when it is reloaded, but not for a title', async () => {
    const { h, ids, user } = mount(['alpha', 'beta']);
    await user.click(screen.getByRole('button', { name: 'beta 0' }));
    expect(screen.getByRole('button', { name: 'beta 1' })).toBeInTheDocument();

    act(() => {
      h.world.retitle('cloud', (_route, original) => `${original} (renamed)`);
      h.world.changed();
    });
    expect(screen.getByRole('button', { name: 'beta 1' })).toBeInTheDocument();

    act(() => {
      h.store.reload(ids[1]);
    });
    expect(screen.getByRole('button', { name: 'beta 0' })).toBeInTheDocument();

    act(() => {
      h.store.navigate(ids[1], cloudPage('delta'));
    });
    expect(screen.getByRole('button', { name: 'delta 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^beta/ })).toBeNull();
  });

  it('keeps a page mounted, with its state, when its tab moves to another place that `pageKey` says is the same page, and draws it again when the key changes and when the tab is reloaded', async () => {
    const h = boot({ home: false });
    const [id] = h.openAll(['alpha']);
    act(() => {
      h.store.navigate(id ?? '', cloudPage('alpha', { item: 'one' }));
    });
    // The place of the tab holds the item, so a move to another item is another place; the key the host gives leaves the item out.
    render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={({ location }) => <Page name={location.key} />} pageKey={({ location }) => pageName(location.route)} empty={null} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'cloud:alpha|one 0' }));
    expect(screen.getByRole('button', { name: 'cloud:alpha|one 1' })).toBeInTheDocument();

    act(() => {
      h.store.navigate(id ?? '', cloudPage('alpha', { item: 'two' }));
    });
    expect(screen.getByRole('button', { name: 'cloud:alpha|two 1' })).toBeInTheDocument();

    act(() => {
      h.store.navigate(id ?? '', cloudPage('beta'));
    });
    expect(screen.getByRole('button', { name: 'cloud:beta| 0' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'cloud:beta| 0' }));
    act(() => {
      h.store.reload(id);
    });
    expect(screen.getByRole('button', { name: 'cloud:beta| 0' })).toBeInTheDocument();
  });
});

describe('the scroll offset of the region', () => {
  it('restores a saved document offset on the first commit', () => {
    const h = boot({ home: false });
    const [id] = h.openAll(['alpha']);
    h.store.setPageState(id, { scroll: { top: 174, left: 8 } });
    render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={({ location }) => <Page name={pageName(location.route)} />} empty={null} />);
    const region = screen.getByRole('tabpanel');
    expect(region.scrollTop).toBe(174);
    expect(region.scrollLeft).toBe(8);
  });

  it('is kept for each tab: switch away and back, and the region is where it was left; a tab not shown before starts at the top', () => {
    const { h, ids } = mount(['alpha', 'beta']);
    const region = document.querySelector<HTMLElement>('[data-shell-part="page"]')!;
    let offset = { top: 0, left: 0 };
    // jsdom lays nothing out and lets a script read back what it wrote: a region whose offset is its own, as a browser's is, makes the restore visible.
    Object.defineProperties(region, {
      scrollTop: { configurable: true, get: () => offset.top, set: (value: number) => (offset = { ...offset, top: value }) },
      scrollLeft: { configurable: true, get: () => offset.left, set: (value: number) => (offset = { ...offset, left: value }) },
    });

    // beta is on screen: the user scrolls it.
    offset = { top: 240, left: 12 };
    fireEvent.scroll(region);

    act(() => {
      h.store.activate(ids[0]);
    });
    expect(offset).toEqual({ top: 0, left: 0 });
    offset = { top: 80, left: 0 };
    fireEvent.scroll(region);

    act(() => {
      h.store.activate(ids[1]);
    });
    expect(offset).toEqual({ top: 240, left: 12 });
    act(() => {
      h.store.activate(ids[0]);
    });
    expect(offset).toEqual({ top: 80, left: 0 });
  });
});

describe('a page that draws its scroller anew when it comes back', () => {
  // A collection that reads its data again when its effects resume shows its loading state, and its table is a new element: the offset went with the old one (found on a real cluster).
  function Redrawn() {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => {
      // Runs when the page mounts and each time React shows it again.
      setEpoch((value) => value + 1);
    }, []);
    return <div key={epoch} role="region" aria-label="List" />;
  }

  it('has the offset it was left at put back in the new scroller', async () => {
    const h = boot({ home: false });
    const [one, two] = h.openAll(['alpha', 'beta']);
    render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={({ location }) => (pageName(location.route) === 'alpha' ? <Redrawn /> : <p>Other</p>)} empty={null} />);
    await act(async () => {
      h.store.activate(one ?? '');
    });
    const list = screen.getByRole('region', { name: 'List' });
    list.scrollTop = 120;
    fireEvent.scroll(list);
    await act(async () => {
      h.store.activate(two ?? '');
    });
    await act(async () => {
      h.store.activate(one ?? '');
    });

    await vi.waitFor(() => {
      const again = screen.getByRole('region', { name: 'List' });
      expect(again).not.toBe(list);
      expect(again.scrollTop).toBe(120);
    });
  });
});
