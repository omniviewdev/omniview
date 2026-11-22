import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginsModel, type PluginsModel } from './core/model';
import { harness, inventoryEntry, settle } from './core/testing';
import type { InventoryEntry } from './core/types';
import { List } from './List';

// The Installed list over the page's real model and an invented inventory: its rows in order, the one selected, the keys, what it says when it has no rows to show, and what a change of one plugin costs. jsdom has no
// layout: the geometry and the paint are the probe's.

afterEach(cleanup);

const four = [inventoryEntry('delta', { phase: 'Stopped' }), inventoryEntry('alpha'), inventoryEntry('gamma', { phase: 'Failed' }), inventoryEntry('beta', { enabled: false })];

async function opened(plugins: readonly InventoryEntry[], attach = false) {
  const set = harness(plugins);
  const model = createPluginsModel(set.deps);
  if (attach) {
    model.attach();
  } else {
    model.refresh();
  }

  await settle();
  return { ...set, model };
}

const rows = (): HTMLElement[] => screen.queryAllByRole('button').filter((button) => button.getAttribute('data-pl-part') === 'row');
const names = (): string[] => rows().map((row) => row.querySelector('[data-pl-part="row-name"]')?.textContent ?? '');
const stops = (): Array<string | null> => rows().map((row) => row.getAttribute('tabindex'));
const rowOf = (name: string): HTMLElement => {
  const found = rows().find((row) => row.querySelector('[data-pl-part="row-name"]')?.textContent === name);
  if (found === undefined) {
    throw new Error(`no row ${name}: ${names().join(', ')}`);
  }

  return found;
};

describe('the pane', () => {
  it('is a region named Installed plugins, with the heading Installed and the count beside it', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);

    const region = screen.getByRole('region', { name: 'Installed plugins' });
    expect(region).toHaveAttribute('data-pl-part', 'list');
    expect(within(region).getByRole('heading', { level: 2, name: 'Installed' })).toBeInTheDocument();
    expect(region.querySelector('[data-pl-part="list-head"]')).toHaveTextContent('Installed4');
    expect(region.querySelector('[data-pl-part="list-scroll"]')).toContainElement(rows()[0] ?? null);
  });

  it('draws the plugins in the order the model gives, one button each, with no switch, no search and no toolbar', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);

    expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('says each plugin\'s state on its row, and the sentence of the one that failed', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);

    expect(rows().map((row) => row.getAttribute('data-pl-state'))).toEqual(['running', 'disabled', 'stopped', 'failed']);
    expect(rowOf('Gamma').querySelector('[data-pl-part="row-sentence"]')).toHaveTextContent(model.row('gamma')?.state.sentence ?? 'no sentence');
    expect(rowOf('Beta').querySelector('[data-pl-part="row-chip"]')).toHaveTextContent('Disabled');
  });

  it.each([
    [1, '1 plugin'],
    [4, '4 plugins'],
    [0, '0 plugins'],
  ])('counts %i of them in its footer: %s', async (count, words) => {
    const { model } = await opened(four.slice(0, count));
    const { container } = render(<List model={model} />);

    const footer = container.querySelector('[data-pl-part="list-foot"]');
    expect(footer).toHaveTextContent(new RegExp(`^${words}$`));
    expect(within(footer as HTMLElement).getByRole('status')).toHaveTextContent(words);
  });
});

describe('choosing a plugin', () => {
  it('shows the one the model selects as current, and no other', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);

    expect(rows().map((row) => row.getAttribute('aria-current'))).toEqual(['true', null, null, null]);
    expect(rows().map((row) => row.getAttribute('data-pl-selected'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('selects a plugin on a click, and moves the current mark to its row', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);

    await userEvent.setup().click(rowOf('Delta'));

    expect(model.getSnapshot().selected).toBe('delta');
    expect(rows().map((row) => row.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
  });

  it('selects a plugin on Enter and on Space, and the arrows select nothing', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(rowOf('Beta')).toHaveFocus();
    expect(model.getSnapshot().selected).toBe('alpha');

    await user.keyboard('{Enter}');
    expect(model.getSnapshot().selected).toBe('beta');

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(rowOf('Gamma')).toHaveFocus();
    expect(model.getSnapshot().selected).toBe('beta');

    await user.keyboard(' ');
    expect(model.getSnapshot().selected).toBe('gamma');
  });
});

describe('the keyboard', () => {
  it('holds the rows in one Tab stop, which is the selected row', async () => {
    const { model } = await opened(four);
    render(
      <>
        <button type="button">Before</button>
        <List model={model} />
        <button type="button">After</button>
      </>,
    );

    expect(stops()).toEqual(['0', '-1', '-1', '-1']);

    act(() => {
      model.select('gamma');
    });
    await act(async () => {
      await settle();
    });

    expect(stops()).toEqual(['-1', '-1', '-1', '0']);
  });

  it('enters the list on the selected row with one Tab, and leaves it with the next', async () => {
    const { model } = await opened(four);
    render(
      <>
        <button type="button">Before</button>
        <List model={model} />
        <button type="button">After</button>
      </>,
    );
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
    await user.tab();
    expect(rowOf('Alpha')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('moves the focus with the arrows, Home and End, and stops at the ends', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard('{ArrowUp}');
    expect(rowOf('Alpha')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rowOf('Beta')).toHaveFocus();
    await user.keyboard('{End}');
    expect(rowOf('Gamma')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rowOf('Gamma')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(rowOf('Alpha')).toHaveFocus();
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);
  });

  it('names the group of rows', async () => {
    const { model } = await opened(four);
    render(<List model={model} />);

    expect(within(screen.getByRole('region', { name: 'Installed plugins' })).getByRole('group', { name: 'Plugin list' })).toBeInTheDocument();
  });
});

describe('when there are no rows to show', () => {
  it('says it is loading until the host has answered, with no count and no footer', () => {
    const { deps } = harness(four);
    const { container } = render(<List model={createPluginsModel(deps)} />);

    expect(container.querySelector('[data-pl-part="list-loading"]')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Loading installed plugins' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-pl-part="list-foot"]')).toBeNull();
    expect(container.querySelector('[data-pl-part="list-head"]')).toHaveTextContent(/^Installed$/);
    expect(rows()).toHaveLength(0);
  });

  it('says it could not list the plugins, and lists them when asked again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const set = harness(four);
    set.read.mockRejectedValueOnce(new Error('the host is not there'));
    const model = createPluginsModel(set.deps);
    model.refresh();
    await settle();
    const { container } = render(<List model={model} />);

    expect(container.querySelector('[data-pl-part="list-failed"]')).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t list the installed plugins');
    expect(container.querySelector('[data-pl-part="list-foot"]')).toBeNull();

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
      await settle();
    });

    expect(set.read).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-pl-part="list-failed"]')).toBeNull();
    expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    warn.mockRestore();
  });

  it('says there are no plugins installed, offers nothing to do about it, and counts none', async () => {
    const { model } = await opened([]);
    const { container } = render(<List model={model} />);

    expect(container.querySelector('[data-pl-part="list-empty"]')).toHaveTextContent('No plugins installed');
    expect(container.querySelector('[data-pl-part="list-empty"]')).toHaveTextContent('Plugins add pages, tools and connections to Omniview.');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('[data-pl-part="list-foot"]')).toHaveTextContent('0 plugins');
  });
});

describe('what a change costs', () => {
  const many = Array.from({ length: 200 }, (_, index) => inventoryEntry(`p${String(index).padStart(3, '0')}`));

  /** The model, with every read of a row and of the list counted: a row that renders reads its own row, and the list reads its snapshot. */
  function counted(model: PluginsModel) {
    const rowReads = new Map<string, number>();
    const listReads = { count: 0 };
    const wrapped: PluginsModel = {
      ...model,
      getSnapshot: () => {
        listReads.count += 1;
        return model.getSnapshot();
      },
      row: (id) => {
        rowReads.set(id, (rowReads.get(id) ?? 0) + 1);
        return model.row(id);
      },
    };
    return { wrapped, rowReads, listReads };
  }

  it('draws 200 plugins in one commit', async () => {
    const { model } = await opened(many);
    const onRender = vi.fn();
    render(
      <Profiler id="list" onRender={onRender}>
        <List model={model} />
      </Profiler>,
    );

    expect(rows()).toHaveLength(200);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender.mock.calls[0]?.[1]).toBe('mount');
  });

  it('renders the row of the plugin an event is about, and nothing else of the list', async () => {
    const { model, events } = await opened(many, true);
    const { wrapped, rowReads, listReads } = counted(model);
    const onRender = vi.fn();
    render(
      <Profiler id="list" onRender={onRender}>
        <List model={wrapped} />
      </Profiler>,
    );
    rowReads.clear();
    onRender.mockClear();
    const listBefore = listReads.count;

    act(() => {
      events.emit('plugin/state_change', { pluginID: 'p042', from: 'Running', to: 'Degraded' });
    });

    expect(rowOf('P042')).toHaveAttribute('data-pl-state', 'degraded');
    expect([...rowReads.keys()]).toEqual(['p042']);
    expect(listReads.count).toBe(listBefore);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('renders the two rows whose mark changes when another plugin is selected, and no other', async () => {
    const { model } = await opened(many);
    const { wrapped, rowReads } = counted(model);
    render(<List model={wrapped} />);
    rowReads.clear();

    act(() => {
      model.select('p100');
    });

    expect(rowOf('P100')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('P000')).not.toHaveAttribute('aria-current');
    expect([...rowReads.keys()].sort()).toEqual(['p000', 'p100']);
  });
});
