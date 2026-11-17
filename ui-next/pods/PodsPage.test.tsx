import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as data from '../k8s';
import { PodsPage, type PodsPageParts } from './PodsPage';

// The data layer is its own seam, tested in ui-next/k8s: here `usePods` answers a view, and the runtime answers the list of connections. What is under
// test is what the screen hands the host: which connection it reads, what it registers, what the page lists and in what state, and the one connection it starts.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, useConnections: vi.fn() };
});
vi.mock('../k8s', async (importActual) => {
  const actual = await importActual<typeof data>();
  return { ...actual, usePods: vi.fn() };
});

const connections = vi.mocked(runtime.useConnections);
const usePods = vi.mocked(data.usePods);
const connect = vi.fn(async () => undefined);

function view(over: Partial<data.PodsView> = {}): data.PodsView {
  return {
    state: { kind: 'loaded' },
    failure: undefined,
    rows: [],
    loaded: 0,
    complete: true,
    count: { kind: 'exact', value: '0' },
    live: true,
    refreshing: false,
    connect,
    retry: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

const know = (...ids: readonly string[]) => {
  connections.mockReturnValue({ connections: { data: ids.map((id) => ({ id })), isPending: false } } as never);
};

/** What the screen last handed the host. */
function mount(connection: string | undefined = undefined) {
  const handed: PodsPageParts[] = [];
  const view_ = render(
    <PodsPage connection={connection}>
      {(parts) => {
        handed.push(parts);
        return <p>{parts.source.state.kind}</p>;
      }}
    </PodsPage>,
  );
  return { ...view_, last: () => handed.at(-1)! };
}

beforeEach(() => {
  usePods.mockReturnValue(view());
  window.history.replaceState(null, '', '/?screen=pods');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PodsPage: which connection it reads', () => {
  it('reads the connection the URL names, when the plugin knows it', () => {
    know('kind-a', 'kind-b');
    mount('kind-b');
    expect(usePods).toHaveBeenCalledWith({ connectionID: 'kind-b' });
  });

  it('reads the first connection when the URL names none, or one the plugin does not know', () => {
    know('kind-a', 'kind-b');
    mount();
    expect(usePods).toHaveBeenLastCalledWith({ connectionID: 'kind-a' });
    cleanup();
    mount('kind-gone');
    expect(usePods).toHaveBeenLastCalledWith({ connectionID: 'kind-a' });
  });

  it('reads nothing while there is no connection to read, and says it is loading while the list of connections is on its way', () => {
    connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
    const { last } = mount();
    expect(usePods).not.toHaveBeenCalled();
    expect(last().source.state).toEqual({ kind: 'loading' });
    expect(last().source.rows).toEqual([]);
  });

  it('says "No connections", with nothing to retry, when the plugin has none (or is not installed)', () => {
    connections.mockReturnValue({ connections: { data: [], isPending: false } } as never);
    const { last } = mount();
    expect(usePods).not.toHaveBeenCalled();
    expect(last().source.state).toEqual({ kind: 'failed', message: 'No connections' });
    expect(last().source.complete).toBe(false);
  });

  it('starts over for another connection: a page of its own, with none of the first one\'s state', () => {
    know('kind-a', 'kind-b');
    const first = vi.fn(() => <p />);
    const { rerender } = render(<PodsPage connection="kind-a">{first}</PodsPage>);
    expect(usePods).toHaveBeenLastCalledWith({ connectionID: 'kind-a' });
    rerender(<PodsPage connection="kind-b">{first}</PodsPage>);
    expect(usePods).toHaveBeenLastCalledWith({ connectionID: 'kind-b' });
  });
});

describe('PodsPage: what it hands the host', () => {
  it('registers itself in the frame as the Pods of the connection the URL names, in the pane layout', () => {
    know('kind-a');
    const { last } = mount('kind-a');
    expect(last().registration).toMatchObject({ plugin: { name: 'Kubernetes' }, tab: { title: 'Pods' }, layout: 'pane', path: ['Kubernetes', 'kind-a', 'Pods'] });
  });

  it('hands over the Pods list: its title and nouns, the quick filters of the definition, and the columns of its default set', () => {
    know('kind-a');
    const { definition } = mount('kind-a').last();
    expect(definition.title).toBe('Pods');
    expect(definition.nouns).toEqual({ one: 'Pod', other: 'Pods' });
    expect(definition.lines).toBe(2);
    expect(definition.quickFilters.label).toBe('Pod state');
    expect(definition.quickFilters.filters.map((filter) => filter.label)).toEqual(['Running', 'Pending', 'Failed', 'Completed']);
    expect(definition.columns.map((column) => column.header)).toEqual(['Name', 'Ready', 'Status', 'Restarts', 'Age']);
  });

  it('hands over the rows and the state of what usePods read', () => {
    know('kind-a');
    const rows = [{ key: 'k1', name: 'cart-api-1', namespace: 'checkout' }] as unknown as data.PodsView['rows'];
    usePods.mockReturnValue(view({ rows, loaded: 1, complete: false, state: { kind: 'loaded' } }));
    const { source } = mount('kind-a').last();
    expect(source.rows).toBe(rows);
    expect(source.complete).toBe(false);
    expect(source.state).toEqual({ kind: 'ready' });
  });
});

describe('PodsPage: the connection it starts (a development shortcut: a read never connects, plan D4)', () => {
  it('starts a connection it finds stopped, once', () => {
    know('kind-a');
    usePods.mockReturnValue(view({ state: { kind: 'disconnected' } }));
    const { rerender } = render(<PodsPage connection="kind-a">{() => <p />}</PodsPage>);
    expect(connect).toHaveBeenCalledTimes(1);
    rerender(<PodsPage connection="kind-a">{() => <p />}</PodsPage>);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('starts nothing for a connection that is up, connecting, or failed', () => {
    know('kind-a');
    for (const state of [{ kind: 'loaded' }, { kind: 'connecting' }, { kind: 'unreachable' }] as const) {
      usePods.mockReturnValue(view({ state }));
      render(<PodsPage connection="kind-a">{() => <p />}</PodsPage>);
      cleanup();
    }

    expect(connect).not.toHaveBeenCalled();
  });
});
