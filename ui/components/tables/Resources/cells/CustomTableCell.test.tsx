import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExtensionPointRegistry,
  ExtensionProvider,
  RESOURCE_CELL_EXTENSION_POINT_ID,
  createResourceCellExtensionPoint,
  type ResourceCellContribution,
  type ResourceCellProps,
} from '@omniviewdev/runtime';
import CustomTableCell from './CustomTableCell';

afterEach(cleanup);

function setup(options: { withPoint?: boolean } = {}) {
  const registry = new ExtensionPointRegistry({
    initialStores: options.withPoint === false ? [] : [createResourceCellExtensionPoint()],
  });
  const store = registry.getExtensionPoint<ResourceCellContribution>(RESOURCE_CELL_EXTENSION_POINT_ID);
  const cell = (props: Partial<React.ComponentProps<typeof CustomTableCell>> = {}) => (
    <CustomTableCell plugin='native' resourceKey='widgets' component='status' data='ok' {...props} />
  );
  const show = (props?: Partial<React.ComponentProps<typeof CustomTableCell>>) =>
    render(<ExtensionProvider registry={registry}>{cell(props)}</ExtensionProvider>);
  return { registry, store, cell, show };
}

/**
 * A renderer that reports its own mount and unmount, to prove an old renderer is released rather
 * than hidden. A class keeps the test off the compiler's hook memoization.
 */
function tracked(label: string, events: string[]) {
  return class Tracked extends React.Component<ResourceCellProps> {
    componentDidMount() {
      events.push(`mount:${label}`);
    }

    componentWillUnmount() {
      events.push(`unmount:${label}`);
    }

    render() {
      return <span>{label}:{String(this.props.data)}</span>;
    }
  };
}

const contribution = (component: ResourceCellContribution['component'], extra: Partial<ResourceCellContribution> = {}): ResourceCellContribution => ({
  contractVersion: 1,
  name: 'status',
  component,
  ...extra,
});

describe('CustomTableCell', () => {
  it('renders an explicit unavailable state before any contribution exists', () => {
    const { show } = setup();
    show();
    const state = screen.getByText('Unavailable');
    expect(state.closest('[data-state]')?.getAttribute('data-state')).toBe('unavailable');
    expect(state.closest('[data-state]')?.getAttribute('title')).toContain('"status"');
  });

  it('renders unavailable, not blank, without a registry or without the extension point', () => {
    render(<CustomTableCell plugin='native' resourceKey='widgets' component='status' data='ok' />);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    cleanup();
    setup({ withPoint: false }).show();
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });

  it('renders the contributed component with the column data once registered', async () => {
    const { store, show } = setup();
    show({ data: { phase: 'Running' } });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    const received: unknown[] = [];
    await act(async () => {
      store!.register({
        id: 'native/status',
        plugin: 'native',
        label: 'Status',
        value: contribution(({ data }) => {
          received.push(data);
          return <span>contributed</span>;
        }),
      }); 
    });
    expect(screen.getByText('contributed')).toBeTruthy();
    expect(screen.queryByText('Unavailable')).toBeNull();
    expect(received.at(-1)).toEqual({ phase: 'Running' });
    expect(screen.getByText('contributed').closest('[data-state]')?.getAttribute('data-state')).toBe('ready');
  });

  it('forwards the column’s componentParams to the renderer exactly as declared', () => {
    const { store, show } = setup();
    const params = { label: 'phase', thresholds: [1, 2] };
    const received: Array<{ data: unknown; componentParams: unknown }> = [];
    store!.register({
      id: 'native/status',
      plugin: 'native',
      label: 'Status',
      value: contribution(({ data, componentParams }) => {
        received.push({ data, componentParams });
        return <span>with params</span>;
      }),
    });
    show({ componentParams: params });
    expect(screen.getByText('with params')).toBeTruthy();
    expect(received.at(-1)?.componentParams).toBe(params);
    expect(received.at(-1)?.data).toBe('ok');
  });

  it('passes no componentParams when the column declares none', () => {
    const { store, show } = setup();
    const received: Array<{ data: unknown; componentParams: unknown }> = [];
    store!.register({
      id: 'native/status',
      plugin: 'native',
      label: 'Status',
      value: contribution(({ data, componentParams }) => {
        received.push({ data, componentParams });
        return <span>no params</span>;
      }),
    });
    show();
    expect(screen.getByText('no params')).toBeTruthy();
    expect(received.at(-1)).toEqual({ data: 'ok', componentParams: undefined });
  });

  it('swaps to the replacement component on reload and releases the old one', async () => {
    const { store, registry, show } = setup();
    const events: string[] = [];
    store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(tracked('first', events)) });
    show();
    expect(screen.getByText('first:ok')).toBeTruthy();

    await act(async () => {
      registry.removeContributions('native');
      store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(tracked('second', events)) });
    });
    expect(screen.getByText('second:ok')).toBeTruthy();
    expect(screen.queryByText('first:ok')).toBeNull();
    expect(events).toEqual(['mount:first', 'unmount:first', 'mount:second']);
  });

  it('shows unavailable after unload and keeps no stale renderer mounted', async () => {
    const { store, registry, show } = setup();
    const events: string[] = [];
    store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(tracked('first', events)) });
    show();
    expect(screen.getByText('first:ok')).toBeTruthy();

    await act(async () => {
      registry.removeContributions('native'); 
    });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText('first:ok')).toBeNull();
    expect(events).toEqual(['mount:first', 'unmount:first']);

    await act(async () => {
      store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(tracked('again', events)) }); 
    });
    expect(screen.getByText('again:ok')).toBeTruthy();
  });

  it('also follows a replaced extension point', async () => {
    const { store, registry, show } = setup();
    store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(() => <span>original</span>) });
    show();
    expect(screen.getByText('original')).toBeTruthy();
    await act(async () => {
      registry.removeExtensionPoints('core'); 
    });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    await act(async () => {
      registry.addExtensionPoint(createResourceCellExtensionPoint()); 
    });
    await act(async () => {
      registry.getExtensionPoint<ResourceCellContribution>(RESOURCE_CELL_EXTENSION_POINT_ID)!.register({
        id: 'native/status', plugin: 'native', label: 'Status', value: contribution(() => <span>replacement</span>),
      }); 
    });
    expect(screen.getByText('replacement')).toBeTruthy();
  });

  it('never renders another plugin’s contribution for this plugin’s column', async () => {
    const { store, show } = setup();
    const foreign = vi.fn(() => <span>foreign</span>);
    store!.register({ id: 'other/status', plugin: 'other', label: 'Status', value: contribution(foreign) });
    show();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(foreign).not.toHaveBeenCalled();

    await act(async () => {
      store!.register({
        id: 'helper/status', plugin: 'helper', label: 'Status', value: contribution(() => <span>opted-in</span>, { providers: ['native'] }),
      }); 
    });
    expect(screen.getByText('opted-in')).toBeTruthy();
    expect(foreign).not.toHaveBeenCalled();
  });

  it('rejects a resource type mismatch and serves the declared type', async () => {
    const { store, show } = setup();
    store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(() => <span>gadget cell</span>, { resourceKeys: ['gadgets'] }) });
    show({ resourceKey: 'widgets' });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    cleanup();
    show({ resourceKey: 'gadgets' });
    expect(screen.getByText('gadget cell')).toBeTruthy();
  });

  it('does not pick a renderer when equally specific contributions compete', async () => {
    const { store, show } = setup();
    const a = vi.fn(() => <span>a</span>);
    const b = vi.fn(() => <span>b</span>);
    store!.register({ id: 'a/status', plugin: 'a', label: 'A', value: contribution(a, { providers: ['native'] }) });
    store!.register({ id: 'b/status', plugin: 'b', label: 'B', value: contribution(b, { providers: ['native'] }) });
    show();
    const state = screen.getByText('Unavailable').closest('[data-state]');
    expect(state?.getAttribute('title')).toContain('ambiguous');
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  describe('failures', () => {
    const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

    it('isolates a crashing renderer to its own cell and logs it with the contribution identity', () => {
      const log = quiet();
      try {
        const { store, registry } = setup();
        store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(() => {
          throw new Error('boom');
        }) });
        store!.register({ id: 'native/healthy', plugin: 'native', label: 'Healthy', value: contribution(() => <span>healthy</span>, { name: 'healthy' }) });
        render(
          <ExtensionProvider registry={registry}>
            <CustomTableCell plugin='native' resourceKey='widgets' component='status' data='ok' />
            <CustomTableCell plugin='native' resourceKey='widgets' component='healthy' data='ok' />
          </ExtensionProvider>,
        );
        const failed = screen.getByText('Failed to render').closest('[data-state]');
        expect(failed?.getAttribute('data-state')).toBe('error');
        expect(failed?.getAttribute('title')).toContain('boom');
        expect(screen.getByText('healthy')).toBeTruthy();
        const boundaryLog = log.mock.calls.find(([message]) => typeof message === 'string' && message.startsWith('[PluginBoundary]'));
        expect(boundaryLog?.[0]).toContain('resource-cell crash — plugin "native": boom');
        expect(boundaryLog?.[1]).toMatchObject({
          pluginId: 'native',
          boundary: 'resource-cell',
          extensionPointId: RESOURCE_CELL_EXTENSION_POINT_ID,
          contributionId: 'native/status',
          resourceKey: 'widgets',
        });
      } finally {
        log.mockRestore();
      }
    });

    it('recovers when the contribution is replaced', async () => {
      const log = quiet();
      try {
        const { store, registry, show } = setup();
        store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(() => {
          throw new Error('boom');
        }) });
        show();
        expect(screen.getByText('Failed to render')).toBeTruthy();
        await act(async () => {
          registry.removeContributions('native');
          store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(() => <span>fixed</span>) });
        });
        expect(screen.getByText('fixed')).toBeTruthy();
        expect(screen.queryByText('Failed to render')).toBeNull();
      } finally {
        log.mockRestore();
      }
    });

    it('retries when the row’s value changes', () => {
      const log = quiet();
      try {
        const { registry, store, cell } = setup();
        store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(({ data }) => {
          if (data === 'bad') {
            throw new Error('bad row');
          }

          return <span>row:{String(data)}</span>;
        }) });
        const view = render(<ExtensionProvider registry={registry}>{cell({ data: 'bad' })}</ExtensionProvider>);
        expect(screen.getByText('Failed to render')).toBeTruthy();
        view.rerender(<ExtensionProvider registry={registry}>{cell({ data: 'good' })}</ExtensionProvider>);
        expect(screen.getByText('row:good')).toBeTruthy();
      } finally {
        log.mockRestore();
      }
    });

    it('retries when the column’s componentParams change', () => {
      const log = quiet();
      try {
        const { registry, store, cell } = setup();
        store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(({ componentParams }) => {
          const mode = typeof componentParams === 'object' && componentParams !== null && 'mode' in componentParams
            ? String(componentParams.mode)
            : 'none';
          if (mode === 'bad') {
            throw new Error('bad params');
          }

          return <span>mode:{mode}</span>;
        }) });
        const view = render(<ExtensionProvider registry={registry}>{cell({ componentParams: { mode: 'bad' } })}</ExtensionProvider>);
        expect(screen.getByText('Failed to render')).toBeTruthy();
        view.rerender(<ExtensionProvider registry={registry}>{cell({ componentParams: { mode: 'good' } })}</ExtensionProvider>);
        expect(screen.getByText('mode:good')).toBeTruthy();
      } finally {
        log.mockRestore();
      }
    });

    it('keeps siblings visible while a lazy renderer loads and after it fails to load', async () => {
      const log = quiet();
      try {
        const { registry, store } = setup();
        const loading = Promise.withResolvers<{ default: React.ComponentType<ResourceCellProps> }>();
        const Lazy = React.lazy(async () => loading.promise);
        store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(Lazy) });
        render(
          <ExtensionProvider registry={registry}>
            <span>sibling</span>
            <CustomTableCell plugin='native' resourceKey='widgets' component='status' data='ok' />
          </ExtensionProvider>,
        );
        expect(screen.getByText('sibling')).toBeTruthy();
        expect(screen.getByText('Loading…').closest('[data-state]')?.getAttribute('data-state')).toBe('loading');
        await act(async () => {
          loading.reject(new Error('chunk failed')); 
        });
        expect(screen.getByText('sibling')).toBeTruthy();
        expect(screen.getByText('Failed to render')).toBeTruthy();
      } finally {
        log.mockRestore();
      }
    });

    it('renders a lazy renderer once loaded', async () => {
      const { store, show } = setup();
      const loading = Promise.withResolvers<{ default: React.ComponentType<ResourceCellProps> }>();
      const Lazy = React.lazy(async () => loading.promise);
      store!.register({ id: 'native/status', plugin: 'native', label: 'Status', value: contribution(Lazy) });
      show();
      expect(screen.getByText('Loading…')).toBeTruthy();
      await act(async () => {
        loading.resolve({ default: ({ data }) => <span>lazy:{String(data)}</span> }); 
      });
      expect(screen.getByText('lazy:ok')).toBeTruthy();
    });
  });
});
