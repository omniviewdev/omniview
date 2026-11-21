import { describe, expect, it, vi } from 'vitest';
import { createTabsStore, type TabId, type TabsStore } from '../../shell';
import type { FrameV1 } from '../contract/v1';
import { acme } from '../testing';
import { createContributions, type PluginSource } from './contributions';
import { pageMemoryOf } from './pageMemory';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// A page's memory in this window is its tab's `pageState`, on the real tab model: what a page writes is what it reads back, for as long as the tab lives and the window with it, and it is the tab's own.

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins: PluginSource = { getSnapshot: () => entries, subscribe: () => () => undefined };

function world(keepAlive?: { readonly cap: number }) {
  const contributions = createContributions({ plugins, frames: new Published<FrameV1>() });
  const tabs = createTabsStore({ contributions, ...(keepAlive === undefined ? {} : { keepAlive }) });
  const open = (page: string, connection?: string): TabId => {
    const result = tabs.open({ route: { plugin: 'acme', contribution: page, ...(connection === undefined ? {} : { connection }), params: {} } }, { how: 'new', source: 'test' });
    if (result.status !== 'done') {
      throw new Error(`the tab did not open: ${result.status}`);
    }

    return result.id;
  };

  return { tabs, open };
}

const held = (tabs: TabsStore, id: TabId): unknown => tabs.selectors.tab(tabs.getSnapshot(), id)?.pageState;

const SORT = { sort: { column: 'count', direction: 'descending' } };

describe('pageMemoryOf: the tab\'s page state as a page\'s memory', () => {
  it('reads nothing from a tab that has kept nothing, and what it wrote from one that has', () => {
    const { tabs, open } = world();
    const id = open('widgets');
    const memory = pageMemoryOf(tabs, id);

    expect(memory.read()).toBeNull();
    memory.write(SORT);
    expect(memory.read()).toEqual(SORT);
    expect(held(tabs, id)).toEqual(SORT);
  });

  it('is a tab\'s own: another tab, of the same page or another, keeps its own', () => {
    const { tabs, open } = world();
    const first = open('widgets', 'north');
    const second = open('widgets', 'south');
    const third = open('gadgets');
    pageMemoryOf(tabs, first).write(SORT);

    expect(pageMemoryOf(tabs, second).read()).toBeNull();
    expect(pageMemoryOf(tabs, third).read()).toBeNull();
    pageMemoryOf(tabs, second).write({ sort: { column: 'name', direction: 'ascending' } });
    expect(pageMemoryOf(tabs, first).read()).toEqual(SORT);
  });

  it('tells the store once for a change, and not at all for a write of what it already holds', () => {
    const { tabs, open } = world();
    const id = open('widgets');
    const memory = pageMemoryOf(tabs, id);
    const heard = vi.fn();
    tabs.subscribe(heard);

    memory.write(SORT);
    expect(heard).toHaveBeenCalledTimes(1);
    memory.write(JSON.parse(JSON.stringify(SORT)));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is what the tab holds after a reload: the page is drawn again and finds it', () => {
    const { tabs, open } = world();
    const id = open('widgets');
    pageMemoryOf(tabs, id).write(SORT);
    const before = tabs.selectors.tab(tabs.getSnapshot(), id)?.location.generation ?? -1;

    expect(tabs.reload(id)).toMatchObject({ status: 'done', id });
    expect(tabs.selectors.tab(tabs.getSnapshot(), id)?.location.generation).toBe(before + 1);
    expect(pageMemoryOf(tabs, id).read()).toEqual(SORT);
  });

  it('comes back with the tab when the tab is closed and reopened', () => {
    const { tabs, open } = world();
    const id = open('widgets');
    open('gadgets');
    pageMemoryOf(tabs, id).write(SORT);

    tabs.close(id);
    expect(tabs.selectors.tab(tabs.getSnapshot(), id)).toBeUndefined();
    expect(tabs.reopen()).toMatchObject({ status: 'done' });
    expect(pageMemoryOf(tabs, id).read()).toEqual(SORT);
  });

  it('is kept when the keep-alive cap lets the page go: the page is unmounted, the tab is not, and the page that is drawn again reads it', () => {
    const { tabs, open } = world({ cap: 1 });
    const first = open('widgets', 'north');
    pageMemoryOf(tabs, first).write(SORT);
    const second = open('widgets', 'south');

    expect(tabs.selectors.mounted(tabs.getSnapshot())).not.toContain(first);
    expect(tabs.selectors.tab(tabs.getSnapshot(), second)).toBeDefined();
    expect(pageMemoryOf(tabs, first).read()).toEqual(SORT);
  });

  it('reads nothing, and writes nothing, for a tab that is gone', () => {
    const { tabs, open } = world();
    const id = open('widgets');
    tabs.close(id);
    const memory = pageMemoryOf(tabs, id);

    expect(memory.read()).toBeUndefined();
    expect(() => {
      memory.write(SORT);
    }).not.toThrow();
    expect(memory.read()).toBeUndefined();
  });
});
