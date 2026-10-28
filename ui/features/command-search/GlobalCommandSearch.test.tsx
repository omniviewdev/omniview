import { useEffect, useRef, useSyncExternalStore } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureBuiltinExtensionPointsRegistered } from '../extensions/registerBuiltinExtensionPoints';
import { createGlobalSearchController, type GlobalSearchController } from './controller';
import { GlobalCommandSearch } from './GlobalCommandSearch';
import type { SearchScopeV1, SearchSnapshot } from './types';

const connection: SearchScopeV1 = { kind: 'connection', pluginId: 'probe', connectionId: 'prod-id', label: 'prod' };
const resourceType: SearchScopeV1 = {
  kind: 'resource-type', pluginId: 'probe', connectionId: 'prod-id', resourceKey: 'core::v1::Pod', label: 'Pods',
};
const resource: SearchScopeV1 = {
  kind: 'resource', pluginId: 'probe', connectionId: 'prod-id', resourceKey: 'core::v1::Pod',
  resourceId: 'api', namespace: 'payments', uid: 'api-uid', label: 'api',
};
const controllers: GlobalSearchController[] = [];

afterEach(() => {
  cleanup();
  controllers.splice(0).forEach((controller) => {
    controller.dispose(); 
  });
  vi.restoreAllMocks();
});

async function setup() {
  const registry = new ExtensionPointRegistry();
  ensureBuiltinExtensionPointsRegistered(registry);
  const store = registry.getExtensionPoint('omniview/global-search')!;
  for (const [id, scope] of [['connection', connection], ['pods', resourceType], ['api', resource]] as const) {
    store.register({
      id: `probe/${id}`, plugin: 'probe', label: scope.label,
      value: { schemaVersion: 1, kind: 'navigation', target: { kind: 'plugin', pluginId: 'probe', path: `/${id}` }, scope },
    });
  }

  store.register({
    id: 'probe/settings', plugin: 'probe', label: 'Settings',
    value: { schemaVersion: 1, kind: 'setting', target: { section: 'extensions' } },
  });
  const navigate = vi.fn();
  const controller = createGlobalSearchController({
    registry,
    isPluginReady: () => true,
    hasPluginRoute: () => true,
    listResourcePlugins: async () => [],
    loadConnections: async () => [],
    navigate,
  });
  controllers.push(controller);
  const close = vi.fn(() => {
    controller.close(); 
  });
  function Harness() {
    const input = useRef<HTMLInputElement>(null);
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    return <>
      <button type='button' onClick={() => {
        controller.open(); 
      }}>Open search</button>
      <GlobalCommandSearch controller={controller} snapshot={snapshot} input={input} onClose={close} />
    </>;
  }

  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Open search' });
  opener.focus();
  await act(async () => {
    fireEvent.click(opener); 
  });
  const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Search Omniview' });
  return { controller, navigate, close, opener, input, store };
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function explore(input: HTMLInputElement, query: string) {
  type(input, query);
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
  expect(input).toHaveFocus();
}

describe('GlobalCommandSearch scoped interaction', () => {
  it('keeps provider-ranked alias matches visible throughout a pending query', async () => {
    const { controller, input, store, navigate } = await setup();
    await act(async () => {
      store.register({ id: 'probe/native', plugin: 'probe', label: 'Native inventory', value: {
        schemaVersion: 1, kind: 'provider',
        search: async () => ({ completion: 'complete', items: [{ id: 'workers', label: 'Worker machines', value: {
          schemaVersion: 1, kind: 'navigation', target: { kind: 'plugin', pluginId: 'probe', path: '/workers' },
        } }] }),
      } });
    });
    expect(await screen.findByRole('option', { name: /Worker machines/ })).toBeVisible();
    type(input, 'nodepool');
    expect(screen.getByRole('option', { name: /Worker machines/ })).toBeVisible();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(controller.getSnapshot().searchPending).toBe(false); 
    });
    expect(screen.getByRole('option', { name: /Worker machines/ })).toBeVisible();
    fireEvent.click(screen.getByRole('option', { name: /Worker machines/ }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/_plugin/probe/workers'); 
    });
  });

  it('scopes consecutive Tab presses without moving input focus and restores parent query and selection', async () => {
    const { controller, input, navigate } = await setup();
    type(input, 'pro');
    const parentKey = controller.getSnapshot().selectedKey;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(controller.getSnapshot().scopes).toEqual([connection]);
    type(input, 'pod');
    expect(controller.getSnapshot().query).toBe('pod');
    expect(controller.getSnapshot().rows.find((row) => row.key === controller.getSnapshot().selectedKey)?.value.scope).toEqual(resourceType);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    expect(input).toHaveFocus();
    expect(controller.getSnapshot().scopes).toEqual([connection, resourceType]);
    expect(input).toHaveValue('');
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.getByRole('button', { name: /^Resource type: Pods/ })).toHaveAttribute('aria-pressed', 'true');
    expect(controller.getSnapshot().scopes).toHaveLength(2);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(controller.getSnapshot().scopes).toEqual([connection]);
    expect(input).toHaveValue('pod');
    expect(await screen.findByRole('option', { name: /Pods/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection scope prod' }));
    expect(controller.getSnapshot().scopes).toEqual([]);
    expect(input).toHaveValue('pro');
    expect(controller.getSnapshot().selectedKey).toBe(parentKey);
    expect(input).toHaveFocus();
  });

  it('uses pointer scope control to explore but Enter and row clicks navigate', async () => {
    const { controller, input, navigate } = await setup();
    type(input, 'pro');
    fireEvent.click(screen.getByRole('button', { name: 'Scope to prod' }));
    expect(controller.getSnapshot().scopes).toEqual([connection]);
    expect(input).toHaveFocus();
    type(input, 'pod');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/_plugin/probe/pods'); 
    });
    expect(controller.getSnapshot().isOpen).toBe(false);

    await act(async () => {
      controller.open(); 
    });
    type(screen.getByRole<HTMLInputElement>('combobox'), 'pro');
    fireEvent.click(screen.getByRole('option', { name: /prod/ }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/_plugin/probe/connection'); 
    });
  });

  it('selects chips with left and right, removes ancestors and ignores repeated Backspace', async () => {
    const { controller, input } = await setup();
    explore(input, 'pro');
    explore(input, 'pod');
    explore(input, 'api');
    expect(screen.getByRole('button', { name: /^Resource: api/ })).toHaveTextContent('payments');
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 'Backspace', repeat: true });
    expect(controller.getSnapshot().scopes).toHaveLength(3);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: /^Resource type: Pods/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /^Resource: api/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: /^Connection: prod/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(controller.getSnapshot().scopes).toEqual([]);
    expect(input).toHaveValue('pro');
  });

  it('traps ordinary Tab navigation, leaves Shift-Tab normal and ignores consumed scope events', async () => {
    const { controller, input } = await setup();
    type(input, 'pro');
    expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(controller.getSnapshot().scopes).toEqual([]);
    const close = screen.getByRole('button', { name: 'Close search' });
    act(() => {
      close.focus(); 
    });
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
    const lastControl = document.activeElement as HTMLElement;
    expect(screen.getByRole('dialog', { name: 'Search Omniview' }).contains(lastControl)).toBe(true);
    expect(lastControl).not.toBe(close);
    fireEvent.keyDown(lastControl, { key: 'Tab' });
    expect(close).toHaveFocus();
    act(() => {
      input.focus(); 
    });
    const consumed = createEvent.keyDown(input, { key: 'Tab' });
    consumed.preventDefault();
    fireEvent(input, consumed);
    expect(controller.getSnapshot().scopes).toEqual([]);
    expect(input).toHaveFocus();
    type(input, 'Settings');
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    expect(controller.getSnapshot().scopes).toEqual([]);
  });

  it('preserves IME, native caret keys and one Escape dismissal with invoker restoration', async () => {
    const { controller, input, navigate, close, opener } = await setup();
    type(input, 'pro');
    const key = controller.getSnapshot().selectedKey;
    for (const eventKey of ['Tab', 'Enter', 'Escape', 'ArrowDown', 'Backspace']) {
      fireEvent.keyDown(input, { key: eventKey, isComposing: true });
    }

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(controller.getSnapshot().isOpen).toBe(true);
    expect(controller.getSnapshot().scopes).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(controller.getSnapshot().selectedKey).toBe(key);
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
    expect(controller.getSnapshot().selectedKey).toBe(key);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    expect(opener.closest('[inert]')).toBeNull();
  });

  it('holds selected object identity across refreshed controller results', async () => {
    const { controller, input, navigate } = await setup();
    const pods = controller.getSnapshot().rows.find((row) => row.label === 'Pods')!;
    act(() => {
      controller.setSelectedKey(pods.key); 
    });
    const descendant = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(descendant!)).toHaveAttribute('aria-selected', 'true');
    await act(async () => {
      controller.refresh(); 
    });
    expect(input).toHaveAttribute('aria-activedescendant', descendant);
    expect(controller.getSnapshot().selectedKey).toBe(pods.key);
    expect(controller.getSnapshot().rows.find((row) => row.key === pods.key)?.value.scope).toEqual(resourceType);
    expect(document.getElementById(descendant!)).toHaveAttribute('aria-selected', 'true');
    act(() => {
      controller.setSelectedKey(undefined); 
    });
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps provider contexts mounted while closed and unmounts removed contexts', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Context() {
      useEffect(() => {
        mounted();
        return () => {
          unmounted(); 
        };
      }, []);
      return null;
    }

    const input = { current: null };
    const snapshot: SearchSnapshot = { isOpen: false, query: '', scopes: [], rows: [], sources: [], executionPending: false, searchPending: false };
    const contexts = [{ key: 'core/context/1', sourceId: 'core/context', pluginId: 'core', Component: Context }];
    const view = render(<GlobalCommandSearch controller={null} snapshot={snapshot} input={input} onClose={() => undefined} contexts={contexts} />);
    expect(mounted).toHaveBeenCalledTimes(1);
    view.rerender(<GlobalCommandSearch controller={null} snapshot={{ ...snapshot, isOpen: true }} input={input} onClose={() => undefined} contexts={contexts} />);
    view.rerender(<GlobalCommandSearch controller={null} snapshot={snapshot} input={input} onClose={() => undefined} contexts={contexts} />);
    expect(unmounted).not.toHaveBeenCalled();
    view.rerender(<GlobalCommandSearch controller={null} snapshot={snapshot} input={input} onClose={() => undefined} contexts={[]} />);
    expect(unmounted).toHaveBeenCalledTimes(1);
  });
});


it('lets host Cmd/Ctrl-K ownership receive input shortcut events', async () => {
  const { input } = await setup();
  const shortcut = vi.fn();
  document.addEventListener('keydown', shortcut);
  try {
    fireEvent.keyDown(input, { key: 'k', metaKey: true });
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true });
    expect(shortcut).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener('keydown', shortcut);
  }
});

it.each(['Enter', 'pointer'] as const)('keeps dialog and input after a registered keep-open action through %s', async (activation) => {
  const { controller, input, store, close, navigate } = await setup();
  const executeAction = vi.fn(async () => ({ keepOpen: true as const }));
  const search = vi.fn(async () => ({
    items: [{
      id: 'container-choice',
      label: 'Choose log container',
      value: { schemaVersion: 1, kind: 'action', action: { id: 'core:logs', target: resource } },
    }],
    completion: 'complete',
  }));
  act(() => {
    store.register({
      id: 'core/keep-open-action',
      plugin: 'core',
      label: 'Container chooser',
      value: { schemaVersion: 1, kind: 'provider', search, executeAction },
    });
    controller.open({ scope: resource });
    controller.setQuery('Choose log container');
  });
  const row = await screen.findByRole('option', { name: /Choose log container/ });
  await act(async () => {
    if (activation === 'Enter') {
      fireEvent.keyDown(input, { key: 'Enter' });
    } else {
      fireEvent.click(row);
    }
  });
  await waitFor(() => {
    expect(executeAction).toHaveBeenCalledTimes(1); 
  });
  await waitFor(() => {
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(2); 
  });
  expect(controller.getSnapshot().isOpen).toBe(true);
  expect(screen.getByRole('dialog', { name: 'Search Omniview' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Search Omniview' })).toBe(input);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Choose log container');
  expect(controller.getSnapshot().scopes).toEqual([
    expect.objectContaining({ kind: 'connection', pluginId: resource.pluginId, connectionId: resource.connectionId }),
    expect.objectContaining({ kind: 'resource-type', pluginId: resource.pluginId, connectionId: resource.connectionId, resourceKey: resource.resourceKey }),
    resource,
  ]);
  expect(close).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
