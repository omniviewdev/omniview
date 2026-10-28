import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ensureBuiltinExtensionPointsRegistered } from '../extensions/registerBuiltinExtensionPoints';
import { createDeferred } from '../plugins/testing/helpers';
import { createGlobalSearchController } from './controller';
import type { GlobalSearchController } from './controller';

const point = 'omniview/global-search';
const navigation = () => ({ schemaVersion: 1, kind: 'navigation', target: { kind: 'core', path: '/plugins' } });
const item = (id: string, label = id) => ({ id, label, value: navigation() });
const response = (id: string, label = id) => ({ items: [item(id, label)], completion: 'complete' as const });
type ProviderRequest = { query: string; signal: AbortSignal; limit: number };

function setup() {
  const registry = new ExtensionPointRegistry();
  ensureBuiltinExtensionPointsRegistered(registry);
  const ready = new Set(['probe']);
  const routes = new Set(['/capabilities']);
  const listResourcePlugins = vi.fn(async () => ['probe']);
  const loadConnections = vi.fn(async (_plugin: string) => []);
  const navigate = vi.fn();
  const openResource = vi.fn(async (_target: unknown, _signal: AbortSignal, _validateData?: (data: unknown) => boolean) => undefined);
  const controller = createGlobalSearchController({
    openResource,
    registry,
    isPluginReady: (id: string) => ready.has(id),
    hasPluginRoute: (_plugin: string, path: string) => routes.has(path),
    listResourcePlugins,
    loadConnections,
    navigate,
  });
  const store = () => registry.getExtensionPoint(point)!;
  const register = (id: string, value: unknown, label = id, plugin = 'probe') => {
    store().register({ id, plugin, label, value });
  };

  const provider = (id: string, search: (request: ProviderRequest) => Promise<unknown>) => {
    register(id, { schemaVersion: 1, kind: 'provider', search });
  };

  return {
    registry,
    store,
    register,
    provider,
    ready,
    routes,
    controller,
    listResourcePlugins,
    loadConnections,
    navigate,
    openResource,
  };
}

type ProviderResponse = {
  items: Array<{ id: string; label: string; value: unknown }>;
  completion: 'complete' | 'truncated';
};
type Harness = {
  registry: ExtensionPointRegistry;
  store: () => { register: (entry: { id: string; plugin: string; label: string; value: unknown }) => void };
  register: (id: string, value: unknown, label?: string, plugin?: string) => void;
  provider: (id: string, search: (request: ProviderRequest) => Promise<unknown>) => void;
  ready: Set<string>;
  routes: Set<string>;
  controller: GlobalSearchController;
  listResourcePlugins: Mock<() => Promise<string[]>>;
  loadConnections: Mock<(plugin: string) => Promise<never[]>>;
  navigate: Mock;
  openResource: Mock<(target: unknown, signal: AbortSignal, validateData?: (data: unknown) => boolean) => Promise<void>>;
};
let h: Harness;
const flush = async () => vi.advanceTimersByTimeAsync(0);
const labels = () => h.controller.getSnapshot().rows.map((row) => row.label);
const key = (label: string) => {
  const row = h.controller.getSnapshot().rows.find((candidate) => candidate.label === label);
  expect(row, `current row ${label}`).toBeDefined();
  return row!.key;
};

beforeEach(() => {
  vi.useFakeTimers();
  h = setup();
});
afterEach(() => {
  h.controller.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});


describe('universal scoped provider contracts', () => {
  const connection = { kind: 'connection' as const, pluginId: 'probe', connectionId: 'prod', label: 'Production' };
  it('isolates failed Context sources until explicit recovery while healthy sources remain usable', async () => {
    const broken = vi.fn(async () => response('broken', 'Broken'));
    h.provider('probe/broken-context', broken);
    h.provider('probe/healthy-context', async () => response('healthy', 'Healthy'));
    h.controller.open();
    await flush();
    const retired = key('Broken');
    h.controller.setProviderContextError('probe/broken-context', 'Provider context is unavailable.');
    expect(labels()).toEqual(['Healthy']);
    expect(h.controller.getSnapshot().sources.find((source) => source.id === 'probe/broken-context')).toMatchObject({
      state: 'unavailable', message: 'Provider context is unavailable.', retryable: false,
    });
    h.controller.retrySource('probe/broken-context');
    await h.controller.activate(retired);
    expect(h.navigate).not.toHaveBeenCalled();
    h.controller.notifyDataChanged();
    await flush();
    expect(broken).toHaveBeenCalledOnce();
    expect(labels()).toEqual(['Healthy']);
    h.controller.setProviderContextError('probe/broken-context');
    await flush();
    expect(broken).toHaveBeenCalledTimes(2);
    expect(labels()).toContain('Broken');
    await h.controller.activate(key('Healthy'));
    expect(h.navigate).toHaveBeenCalledWith('/plugins');
  });
  it('blocks resource opening when an immutable UID has no provider identity validator', async () => {
    const target = { kind: 'resource' as const, pluginId: 'probe', connectionId: 'prod', resourceKey: 'instances',
      resourceId: 'opaque', namespace: 'region', uid: 'version-1', label: 'Instance' };
    h.register('probe/open', {
      schemaVersion: 1, kind: 'provider',
      search: async () => ({ items: [{ id: 'open', label: 'Open', value: {
        schemaVersion: 1, kind: 'action', action: { id: 'probe:open', target },
      } }], completion: 'complete' }),
      executeAction: async (_action: unknown, context: { openResource: (resource: typeof target) => Promise<void> }) => {
        await context.openResource(target);
      },
    });
    h.controller.open();
    await flush();
    await h.controller.activate(key('Open'));
    expect(h.openResource).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({ isOpen: true, executionPending: false });
  });
  it.each([
    ['foreign owner', { pluginId: 'foreign' }],
    ['non-resource scope', { kind: 'connection' }],
    ['malformed identity', { resourceId: 42 }],
  ])('rejects action resource destinations with %s', async (_name, invalid) => {
    const target = { kind: 'resource' as const, pluginId: 'probe', connectionId: 'prod',
      resourceKey: 'instances', resourceId: 'vm', namespace: '', label: 'Instance' };
    h.register('probe/open', {
      schemaVersion: 1, kind: 'provider',
      search: async () => ({ items: [{ id: 'open', label: 'Open', value: {
        schemaVersion: 1, kind: 'action', action: { id: 'probe:open', target },
      } }], completion: 'complete' }),
      executeAction: async (_action: unknown, context: { openResource: (value: unknown) => Promise<void> }) => {
        await context.openResource({ ...target, ...invalid });
      },
    });
    h.controller.open();
    await flush();
    await h.controller.activate(key('Open'));
    expect(h.openResource).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({ isOpen: true, executionPending: false });
  });
  const type = { ...connection, kind: 'resource-type' as const, resourceKey: 'cloud/instances', namespaces: ['tenant'], label: 'Instances' };
  const resource = { ...connection, kind: 'resource' as const, resourceKey: type.resourceKey, resourceId: 'ocid1.instance.' + 'x'.repeat(500), namespace: 'tenant', label: 'Instance' };
  const action = (id: string, target: unknown, recovery?: string) => ({ id, label: id, value: { schemaVersion: 1, kind: 'action', action: { id, target, ...(recovery ? { recovery } : {}) } } });

  it('filters foreign and unsupported providers before applying provider cap', async () => {
    h.ready.add('foreign');
    const foreign = vi.fn(async () => response('foreign'));
    for (let index = 0; index < 9; index++) {
      h.register(`foreign/${index}`, { schemaVersion: 1, kind: 'provider', search: foreign }, 'Foreign', 'foreign');
    }

    const unsupported = vi.fn(async () => response('unsupported'));
    h.register('probe/unsupported', { schemaVersion: 1, kind: 'provider', supportsScope: () => false, search: unsupported });
    h.register('probe/throws', { schemaVersion: 1, kind: 'provider', supportsScope: () => {
      throw new Error('bad callback'); 
    }, search: unsupported });
    const own = vi.fn(async () => ({ items: [action('probe:reconnect', connection, 'connection')], completion: 'complete' }));
    h.register('probe/own', { schemaVersion: 1, kind: 'provider', search: own, executeAction: vi.fn() });
    h.controller.open({ scope: resource });
    await flush();
    expect(foreign).not.toHaveBeenCalled();
    expect(unsupported).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledOnce();
    expect(labels()).toEqual(['probe:reconnect']);
  });

  it('rejects static actions, executor-less actions, wrong owners, and namespace broadening', async () => {
    h.register('probe/static', action('probe:static', type).value);
    h.register('probe/no-executor', { schemaVersion: 1, kind: 'provider', search: async () => ({ items: [action('probe:no-op', type)], completion: 'complete' }) });
    h.register('probe/actions', { schemaVersion: 1, kind: 'provider', executeAction: vi.fn(), search: async () => ({
      items: [action('foreign:bad', type), action('probe:all', { ...type, namespaces: undefined }), action('probe:other', { ...type, namespaces: ['other'] }), action('probe:list', type)],
      completion: 'complete',
    }) });
    h.controller.open({ scope: type });
    await flush();
    expect(labels()).toEqual(['probe:list']);
  });

  it('lets slow reads finish and coalesces event storms without discovery or selection loss', async () => {
    const slow = createDeferred<ProviderResponse>();
    const requests: ProviderRequest[] = [];
    h.provider('probe/live', async (request) => {
      requests.push(request);
      return requests.length === 2 ? slow.promise : response('stable', 'Stable');
    });
    h.controller.open();
    await flush();
    const selected = key('Stable');
    h.controller.setSelectedKey(selected);
    h.controller.notifyDataChanged();
    for (let index = 0; index < 100; index++) {
      h.controller.notifyDataChanged();
    }

    expect(requests).toHaveLength(2);
    expect(requests[1].signal.aborted).toBe(false);
    expect(labels()).toEqual(['Stable']);
    expect(h.controller.getSnapshot().selectedKey).toBe(selected);
    slow.resolve(response('stable', 'Renamed'));
    await flush();
    expect(requests).toHaveLength(3);
    expect(h.listResourcePlugins).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().selectedKey).toBe(selected);
  });

  it('keeps stable identity when scope presentation changes and reports scope removal', async () => {
    let label = 'First';
    h.register('probe/scopes', { schemaVersion: 1, kind: 'provider', search: async () => ({
      items: [{ id: 'cloud', label, value: { ...navigation(), scope: { ...resource, label, scopeLabel: label } } }], completion: 'complete',
    }) });
    h.controller.open({ scope: type });
    await flush();
    const selected = key('First');
    label = 'Second';
    h.controller.notifyDataChanged();
    await flush();
    expect(key('Second')).toBe(selected);
    h.controller.removeScope(0, 'Connection removed.');
    expect(h.controller.getSnapshot().feedback?.message).toBe('Connection removed.');
  });
});
describe('actual registry and async epochs', () => {
  it('uses the contributed method receiver and preserves its actionable function identity', async () => {
    const provider = {
      schemaVersion: 1,
      kind: 'provider',
      client: { label: 'Provider-selected destination' },
      async search() {
        return response('method-result', this.client.label);
      },
    };
    h.register('probe/method', provider, 'Stateful method provider');
    h.controller.open();
    h.controller.setQuery('external alias');
    await vi.advanceTimersByTimeAsync(150);

    expect(labels()).toEqual(['Provider-selected destination']);
    await h.controller.activate(key('Provider-selected destination'));
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith('/plugins');
  });

  it('keeps external alias results without local matching/reranking', async () => {
    h.provider('probe/z-first', async () => ({
      items: [item('z', 'Zulu'), item('a', 'Alpha')],
      completion: 'complete',
    }));
    h.provider('probe/a-second', async () => response('alias', 'Native tasks'));
    h.controller.open();
    h.controller.setQuery('external-alias-that-is-not-a-label');
    await vi.advanceTimersByTimeAsync(150);
    expect(labels()).toEqual(expect.arrayContaining(['Zulu', 'Alpha', 'Native tasks']));
    expect(labels().indexOf('Zulu')).toBeLessThan(labels().indexOf('Alpha'));
    expect(new Set(h.controller.getSnapshot().rows.map((row) => row.key)).size).toBe(3);
  });

  it.each(['resolve', 'reject'] as const)(
    'aborts older queries and refuses late %s even if a provider ignores its signal',
    async (settle) => {
      const old = createDeferred<ProviderResponse>();
      const requests: ProviderRequest[] = [];
      h.provider('probe/slow', async (request) => {
        requests.push(request);
        return request.query === 'old' ? old.promise : Promise.resolve(response('new', 'Current'));
      });
      h.controller.open();
      h.controller.setQuery('old');
      await vi.advanceTimersByTimeAsync(150);
      h.controller.setQuery('new');
      expect(requests.find((request) => request.query === 'old')?.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(150);
      if (settle === 'resolve') {
        old.resolve(response('old', 'Retired'));
      } else {
        old.reject(new Error('private stale diagnostic'));
      }

      await flush();
      expect(labels()).toEqual(['Current']);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('private');
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'discards closed-session late %s and clears action references',
    async (settle) => {
      const delayed = createDeferred<ProviderResponse>();
      h.provider('probe/slow', async () => delayed.promise);
      h.controller.open();
      await flush();
      h.controller.close();
      if (settle === 'resolve') {
        delayed.resolve(response('late'));
      } else {
        delayed.reject(new Error('private closed diagnostic'));
      }

      await flush();
      expect(h.controller.getSnapshot()).toMatchObject({ isOpen: false, rows: [] });
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('private');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('retains rows and selection through a ready-owner lifecycle refresh without allowing stale activation', async () => {
    const pending = createDeferred<ProviderResponse>();
    let refreshed = false;
    h.provider('probe/search', async () => refreshed ? pending.promise : response('stable'));
    h.controller.open();
    await flush();
    const selected = key('stable');
    h.controller.setSelectedKey(selected);
    refreshed = true;
    h.controller.refresh();
    expect(labels()).toEqual(['stable']);
    expect(h.controller.getSnapshot()).toMatchObject({ searchPending: true, selectedKey: selected });
    await flush();
    expect(labels()).toEqual(['stable']);
    await h.controller.activate(selected);
    expect(h.navigate).not.toHaveBeenCalled();
    pending.resolve(response('stable'));
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({ searchPending: false, selectedKey: selected });
    await h.controller.activate(selected);
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith('/plugins');
  });

  it('retains pending-query rows and selection but fences actions until final results replace them', async () => {
    const pending = createDeferred<ProviderResponse>();
    h.provider('probe/search', async ({ query }) =>
      query === 'waiting' ? pending.promise : {
        items: [{ ...item('old'), value: { ...navigation(), scope: { kind: 'connection', pluginId: 'probe', connectionId: 'prod', label: 'Production' } } }],
        completion: 'complete',
      },
    );
    h.controller.open();
    await flush();
    const retiredKey = key('old');
    h.controller.setSelectedKey(retiredKey);
    const seen: string[][] = [];
    h.controller.subscribe(() => seen.push(labels()));
    h.controller.setQuery('waiting');
    expect(labels()).toEqual(['old']);
    expect(h.controller.getSnapshot()).toMatchObject({ searchPending: true, selectedKey: retiredKey });
    expect(h.controller.scope(retiredKey)).toBe(false);
    expect(h.controller.getSnapshot().scopes).toEqual([]);
    await h.controller.activate(retiredKey);
    expect(h.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(labels()).toEqual(['old']);
    expect(h.controller.getSnapshot().sources[0].state).toBe('pending');
    expect(h.controller.scope(retiredKey)).toBe(false);
    await h.controller.activate(retiredKey);
    expect(h.navigate).not.toHaveBeenCalled();
    pending.resolve(response('new'));
    await flush();
    expect(labels()).toEqual(['new']);
    expect(h.controller.getSnapshot()).toMatchObject({ searchPending: false, selectedKey: key('new') });
    expect(seen.every((rows) => rows.length > 0)).toBe(true);
    await h.controller.activate(retiredKey);
    expect(h.navigate).not.toHaveBeenCalled();
    await h.controller.activate(key('new'));
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith('/plugins');
  });

  it.each(['timeout', 'reject'] as const)(
    'publishes replacement rows atomically after a slow source %s, preserving failure feedback',
    async (failure) => {
      const slow = createDeferred<ProviderResponse>();
      h.provider('probe/fast', async ({ query }) => response(query ? 'new-fast' : 'old-fast'));
      h.provider('probe/slow', async ({ query }) => query ? slow.promise : response('old-slow'));
      h.controller.open();
      await flush();
      expect(labels()).toEqual(['old-fast', 'old-slow']);
      h.controller.setQuery('next');
      await vi.advanceTimersByTimeAsync(150);
      expect(labels()).toEqual(['old-fast', 'old-slow']);
      expect(h.controller.getSnapshot()).toMatchObject({
        searchPending: true,
        sources: [{ state: 'complete' }, { state: 'pending' }],
      });
      if (failure === 'timeout') {
        await vi.advanceTimersByTimeAsync(4999);
        expect(labels()).toEqual(['old-fast', 'old-slow']);
        await vi.advanceTimersByTimeAsync(1);
      } else {
        slow.reject(new Error('Provider unavailable.'));
        await flush();
      }

      expect(labels()).toEqual(['new-fast']);
      expect(h.controller.getSnapshot()).toMatchObject({
        searchPending: false,
        sources: [{ state: 'complete' }, { state: 'unavailable', retryable: true }],
      });
      if (failure === 'timeout') {
        slow.resolve(response('late'));
        await flush();
        expect(labels()).toEqual(['new-fast']);
      }
    },
  );

  it('refuses a retained action after actual removeContributions and same-ID replacement', async () => {
    h.register('probe/nav', navigation(), 'Original');
    h.controller.open();
    await flush();
    const retiredKey = key('Original');
    h.registry.removeContributions('probe');
    expect(labels()).toEqual([]);
    h.register('probe/nav', navigation(), 'Replacement');
    await flush();
    await h.controller.activate(retiredKey);
    expect(h.navigate).not.toHaveBeenCalled();
    await h.controller.activate(key('Replacement'));
    expect(h.navigate).toHaveBeenCalledWith('/plugins');
  });

  it('fences provider promises across actual store replacement and readiness changes', async () => {
    const delayed = createDeferred<ProviderResponse>();
    h.provider('probe/provider', async () => delayed.promise);
    h.controller.open();
    await flush();
    h.registry.removeExtensionPoints('core');
    ensureBuiltinExtensionPointsRegistered(h.registry);
    h.register('probe/fresh', navigation(), 'Fresh');
    delayed.resolve(response('retired'));
    await flush();
    expect(labels()).toEqual(['Fresh']);
    const retained = key('Fresh');
    h.ready.clear();
    h.controller.refresh();
    expect(labels()).toEqual([]);
    await h.controller.activate(retained);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('keeps good sources usable while another source fails without exposing raw diagnostics', async () => {
    h.provider('probe/good', async () => response('good', 'Working'));
    h.provider('probe/bad', async () => {
      throw new Error('credential=private');
    });
    h.controller.open();
    await flush();
    expect(labels()).toEqual(['Working']);
    expect(h.controller.getSnapshot().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'probe/bad', state: 'unavailable' }),
        expect.objectContaining({ id: 'probe/good', state: 'complete' }),
      ]),
    );
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('credential');
  });
});

describe('local relevance and provider fairness', () => {
  it('ranks exact labels above prefixes, keywords, and description matches', async () => {
    h.register('description', { ...navigation(), description: 'settings' }, 'Preferences');
    h.register('keyword', { ...navigation(), keywords: ['settings'] }, 'Configure');
    h.register('prefix', navigation(), 'Settings appearance');
    h.register('exact', navigation(), 'Settings');
    h.controller.open();
    h.controller.setQuery('settings');
    await flush();
    expect(labels()).toEqual(['Settings', 'Settings appearance', 'Configure', 'Preferences']);
  });

  it('matches a full label containing a hyphenated plugin ID', () => {
    const label = 'Reload palette-pending-navigation connections';
    h.register('reload-hyphenated', navigation(), label);
    h.controller.open();
    h.controller.setQuery(label);
    expect(labels()).toEqual([label]);
  });

  it('matches abbreviations, subsequences, and conservative setting typos', async () => {
    h.register('reload', { ...navigation(), keywords: ['refresh'] }, 'Reload connections');
    h.register('setting', navigation(), 'Settings');
    h.controller.open();
    for (const query of ['rel conn', 'rld conn']) {
      h.controller.setQuery(query);
      await flush();
      expect(labels()).toContain('Reload connections');
    }

    for (const query of ['setings', 'settigns', 'settongs']) {
      h.controller.setQuery(query);
      await flush();
      expect(labels()).toContain('Settings');
    }

    h.controller.setQuery('xyz');
    await flush();
    expect(labels()).toEqual([]);
  });

  it('reserves fair space for admitted providers even with 100 matching statics', async () => {
    for (let index = 0; index < 100; index++) {
      h.register(`static-${index}`, navigation(), `Static ${index}`);
    }

    h.provider('first', async () => ({
      items: Array.from({ length: 20 }, (_, index) => item(`first-${index}`)),
      completion: 'complete',
    }));
    h.provider('second', async () => ({
      items: Array.from({ length: 20 }, (_, index) => item(`second-${index}`)),
      completion: 'complete',
    }));
    h.controller.open();
    await flush();
    expect(labels()).toHaveLength(100);
    expect(labels().filter((label) => label.startsWith('Static'))).toHaveLength(60);
    for (const prefix of ['first', 'second']) {
      expect(labels().filter((label) => label.startsWith(prefix))).toEqual(
        Array.from({ length: 20 }, (_, index) => `${prefix}-${index}`),
      );
    }

    expect(h.controller.getSnapshot().message).toMatch(/limit/i);
  });

  it('coalesces provider searches until typing pauses', async () => {
    const requests: ProviderRequest[] = [];
    h.register('reload', navigation(), 'Reload connections');
    h.provider('external', async (request) => {
      requests.push(request);
      return response('external');
    });
    h.controller.open();
    await flush();
    expect(requests).toHaveLength(1);
    h.controller.setQuery('rel');
    expect(requests[0].signal.aborted).toBe(true);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    h.controller.setQuery('rel conn');
    await vi.advanceTimersByTimeAsync(149);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.map(({ query }) => query)).toEqual(['', 'rel conn']);
  });

  it('retires a pending query timer when the catalogue changes', async () => {
    const search = vi.fn(async () => response('external'));
    h.provider('external', search);
    h.controller.open();
    await flush();
    h.controller.setQuery('pending');
    h.register('fresh', navigation(), 'Pending destination');
    await flush();
    expect(search).toHaveBeenCalledTimes(2);
    expect(labels()).toContain('Pending destination');
    await vi.advanceTimersByTimeAsync(150);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it.each(['close', 'dispose'] as const)('cancels debounced searches on %s', async (operation) => {
    const search = vi.fn(async () => response('external'));
    h.provider('external', search);
    h.controller.open();
    await flush();
    h.controller.setQuery('pending');
    await flush();
    h.controller[operation]();
    await vi.advanceTimersByTimeAsync(150);
    expect(search).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('finite work and nonauthoritative overflow', () => {
  it('coalesces a real same-tick registry burst into one current provider response and rejects the retired result', async () => {
    const retired = createDeferred<ProviderResponse>();
    const requests: ProviderRequest[] = [];
    h.provider('probe/provider', async (request) => {
      requests.push(request);
      return requests.length === 1 ? retired.promise : Promise.resolve(response('current', 'Current external tasks'));
    });
    h.controller.open();
    h.controller.setQuery('external-alias');
    await vi.advanceTimersByTimeAsync(150);
    for (let index = 0; index < 1000; index++) {
      h.register(`core/burst-${index}`, navigation(), `Unrelated ${index}`, 'core');
    }

    expect(requests[0].signal.aborted).toBe(true);
    expect(labels()).toEqual([]);
    await flush();
    expect(requests).toHaveLength(2);
    expect(labels()).toEqual(['Current external tasks']);
    retired.resolve(response('retired', 'Retired external tasks'));
    await flush();
    expect(labels()).toEqual(['Current external tasks']);
    expect(h.controller.getSnapshot().sources).toContainEqual(
      expect.objectContaining({ id: 'probe/provider', state: 'complete' }),
    );
  });

  it('caps admitted providers and concurrent work, times out, and never retries', async () => {
    const calls: string[] = [];
    const pending = Array.from({ length: 9 }, () => createDeferred<ProviderResponse>());
    for (let index = 0; index < 9; index++) {
      h.provider(`probe/p${index}`, async () => {
        calls.push(`p${index}`);
        return pending[index].promise;
      });
    }

    h.controller.open();
    await flush();
    expect(calls).toHaveLength(4);
    expect(h.controller.getSnapshot().sources).toContainEqual(
      expect.objectContaining({ id: 'probe/p8', state: 'source-limit' }),
    );
    pending[0].resolve(response('first'));
    await flush();
    expect(calls).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(new Set(calls).size).toBe(8);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(8);
    expect(labels()).toEqual(['first']);
    expect(
      h.controller.getSnapshot().sources.some((source) => source.state === 'pending' || source.state === 'queued'),
    ).toBe(false);
  });

  it('drops queued work on close and ignores a closed-session provider resolution', async () => {
    const delayed = createDeferred<ProviderResponse>();
    const search = vi.fn(async () => delayed.promise);
    for (let index = 0; index < 8; index++) {
      h.provider(`probe/p${index}`, search);
    }

    h.controller.open();
    await flush();
    h.controller.close();
    delayed.resolve(response('late'));
    await flush();
    expect(search).toHaveBeenCalledTimes(4);
    expect(labels()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a timed-out response even while its original epoch stays open', async () => {
    const delayed = createDeferred<ProviderResponse>();
    h.provider('probe/slow', async () => delayed.promise);
    h.controller.open();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.controller.getSnapshot().sources).toContainEqual(
      expect.objectContaining({ id: 'probe/slow', state: 'unavailable' }),
    );
    delayed.resolve(response('late'));
    await flush();
    expect(labels()).toEqual([]);
  });

  it('passes raw query and limit20, caps display100 and reports truncated sources', async () => {
    const search = vi.fn(async () => ({
      items: Array.from({ length: 21 }, (_, index) => item(String(index))),
      completion: 'complete',
    }));
    for (let index = 0; index < 8; index++) {
      h.provider(`probe/p${index}`, search);
    }

    h.controller.open();
    h.controller.setQuery('RAW Alias');
    await vi.advanceTimersByTimeAsync(150);
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'RAW Alias', limit: 20, signal: expect.any(AbortSignal) }),
    );
    expect(labels()).toHaveLength(100);
    expect(h.controller.getSnapshot().sources.every((source) => source.state === 'truncated')).toBe(true);
  });

  it('stops static processing at1000 before reading surplus candidate fields', async () => {
    for (let index = 0; index < 1000; index++) {
      h.register(`probe/s${index}`, navigation(), `Not matched ${index}`);
    }

    const surplus = { id: 'probe/surplus', plugin: 'probe', label: 'needle', value: navigation() };
    Object.defineProperty(surplus, 'value', {
      get: () => {
        throw new Error('surplus static candidate must not be inspected');
      },
    });
    h.store().register(surplus);
    h.controller.open();
    h.controller.setQuery('needle');
    await flush();
    expect(labels()).toEqual([]);
    expect(h.controller.getSnapshot().message).toMatch(/narrow|limit|overflow/i);
  });

  it('does not invoke providers for an oversized query and exposes narrow-query feedback', async () => {
    const search = vi.fn(async () => response('result'));
    h.provider('probe/search', search);
    h.controller.open();
    await flush();
    search.mockClear();
    h.controller.setQuery('😀'.repeat(257));
    await flush();
    expect(search).not.toHaveBeenCalled();
    expect(labels()).toEqual([]);
    expect(h.controller.getSnapshot().message).toMatch(/narrow|long|256/i);
  });
});

describe('current typed dispatch, native service authority and execution lifecycle', () => {
  beforeEach(() => {
    h.register(
      'probe/reload',
      { schemaVersion: 1, kind: 'command', command: { kind: 'reload-connections', pluginId: 'probe' } },
      'Reload',
    );
  });

  it('dispatches the actual closed service adapter only once while pending', async () => {
    const native = createDeferred<never[]>();
    h.loadConnections.mockImplementation(async () => native.promise);
    h.controller.open();
    await flush();
    const first = h.controller.activate(key('Reload'));
    const repeated = h.controller.activate(key('Reload'));
    expect(h.loadConnections).toHaveBeenCalledTimes(1);
    expect(h.loadConnections).toHaveBeenCalledWith('probe');
    expect(h.controller.getSnapshot().executionPending).toBe(true);
    native.resolve([]);
    await Promise.all([first, repeated]);
    expect(h.controller.getSnapshot().executionPending).toBe(false);
  });

  it.each([
    { kind: 'navigation', value: navigation(), href: '/plugins' },
    {
      kind: 'setting',
      value: {
        schemaVersion: 1,
        kind: 'setting',
        target: { section: 'core', categoryId: 'appearance', settingId: 'appearance.theme' },
      },
      href: '/settings?section=core&category=appearance&setting=appearance.theme',
    },
  ])('allows a current $kind destination while retaining the accepted native command lock', async ({ value, href }) => {
    h.register('core/destination', value, 'Destination', 'core');
    const native = createDeferred<never[]>();
    h.loadConnections.mockImplementation(async () => native.promise);
    h.controller.open();
    await flush();
    const execution = h.controller.activate(key('Reload'));
    await h.controller.activate(key('Destination'));
    const afterNavigation = h.controller.getSnapshot();
    native.resolve([]);
    await execution;

    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(href);
    expect(afterNavigation).toMatchObject({ isOpen: false, executionPending: true });
    h.controller.open();
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({ isOpen: true, executionPending: false, feedback: undefined });
    expect(h.loadConnections).toHaveBeenCalledOnce();
  });

  it.each(['success', 'denial'] as const)(
    'keeps pending native status and its %s after the query changes',
    async (outcome) => {
      const native = createDeferred<never[]>();
      h.loadConnections.mockImplementation(async () => native.promise);
      h.controller.open();
      await flush();
      const execution = h.controller.activate(key('Reload'));

      h.controller.setQuery('another search');
      await flush();
      const pending = h.controller.getSnapshot();
      if (outcome === 'success') {
        native.resolve([]);
      } else {
        native.reject(
          new Error(
            JSON.stringify({
              type: 'omniview:resource/forbidden',
              status: 403,
              title: 'Forbidden',
              detail: 'This action is not permitted.',
              code: 'FORBIDDEN',
              requestId: 'pending-request',
            }),
          ),
        );
      }

      await execution;
      expect(pending).toMatchObject({
        query: 'another search',
        executionPending: true,
        feedback: { message: 'Reloading connections…' },
      });
      expect(h.controller.getSnapshot()).toMatchObject({
        query: 'another search',
        executionPending: false,
        feedback:
          outcome === 'success'
            ? { message: 'Connections reloaded.' }
            : { code: 'FORBIDDEN', requestId: 'pending-request' },
      });
    },
  );

  it.each(['success', 'denial'] as const)(
    'keeps accepted native %s feedback through an unrelated catalogue mutation',
    async (outcome) => {
      const native = createDeferred<never[]>();
      h.loadConnections.mockImplementation(async () => native.promise);
      h.controller.open();
      await flush();
      const execution = h.controller.activate(key('Reload'));

      h.register('core/unrelated', navigation(), 'Unrelated destination', 'core');
      await flush();
      const pending = h.controller.getSnapshot();
      if (outcome === 'success') {
        native.resolve([]);
      } else {
        native.reject(
          new Error(
            JSON.stringify({
              type: 'omniview:resource/forbidden',
              status: 403,
              title: 'Forbidden',
              detail: 'This action is not permitted.',
              code: 'FORBIDDEN',
              requestId: 'catalogue-request',
            }),
          ),
        );
      }

      await execution;
      expect(pending.feedback).toMatchObject({ message: 'Reloading connections…' });
      expect(h.controller.getSnapshot()).toMatchObject({
        executionPending: false,
        feedback:
          outcome === 'success'
            ? { message: 'Connections reloaded.' }
            : { code: 'FORBIDDEN', requestId: 'catalogue-request' },
      });
    },
  );

  it.each([
    { owner: 'probe', label: 'Reload', retiring: 'probe' },
    { owner: 'core', label: 'Core reload', retiring: 'probe' },
    { owner: 'contributor', label: 'Contributor reload', retiring: 'contributor' },
  ])(
    'does not revive a $owner-owned native result when a retired plugin becomes ready before settlement',
    async ({ owner, label, retiring }) => {
      h.ready.add('contributor');
      if (owner !== 'probe') {
        h.register(
          `${owner}/reload-target`,
          {
            schemaVersion: 1,
            kind: 'command',
            command: { kind: 'reload-connections', pluginId: 'probe' },
          },
          label,
          owner,
        );
      }

      const native = createDeferred<never[]>();
      h.loadConnections.mockImplementation(async () => native.promise);
      h.controller.open();
      await flush();
      const execution = h.controller.activate(key(label));

      h.ready.delete(retiring);
      h.controller.refresh();
      h.ready.add(retiring);
      h.controller.refresh();
      await flush();
      native.resolve([]);
      await execution;

      expect(h.controller.getSnapshot()).toMatchObject({ isOpen: true, executionPending: false, feedback: undefined });
    },
  );

  it('shows fixed disabled capability feedback and refuses dispatch without resource capability', async () => {
    h.listResourcePlugins.mockResolvedValue([]);
    h.controller.open();
    await flush();
    const row = h.controller.getSnapshot().rows.find((candidate) => candidate.label === 'Reload');
    expect(row?.disabledReason).toBe('Connection discovery is unavailable for this plugin.');
    await h.controller.activate(key('Reload'));
    expect(h.loadConnections).not.toHaveBeenCalled();
  });

  it('treats capability discovery failure as unavailable and refreshes only on open/lifecycle, not each keystroke', async () => {
    h.listResourcePlugins.mockRejectedValue(new Error('private native diagnostic'));
    h.controller.open();
    await flush();
    expect(h.controller.getSnapshot().message).toMatch(/unavailable/i);
    h.controller.setQuery('a');
    h.controller.setQuery('ab');
    await flush();
    expect(h.listResourcePlugins).toHaveBeenCalledTimes(1);
    h.controller.refresh();
    await flush();
    expect(h.listResourcePlugins).toHaveBeenCalledTimes(2);
    expect(h.loadConnections).not.toHaveBeenCalled();
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('private');
  });

  it('preserves real service denial code/correlation without raw causes or privileged fallback', async () => {
    h.loadConnections.mockRejectedValue(
      new Error(
        JSON.stringify({
          type: 'omniview:resource/forbidden',
          status: 403,
          title: 'Forbidden',
          detail: 'This action is not permitted.',
          code: 'FORBIDDEN',
          requestId: 'public-request',
        }),
        { cause: new Error('credential=private') },
      ),
    );
    h.controller.open();
    await flush();
    await h.controller.activate(key('Reload'));
    expect(h.controller.getSnapshot().feedback).toMatchObject({ code: 'FORBIDDEN', requestId: 'public-request' });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('credential');
    expect(h.loadConnections).toHaveBeenCalledTimes(1);
  });

  it('does not reopen or overwrite a newer session when an accepted native command completes late', async () => {
    const native = createDeferred<never[]>();
    h.loadConnections.mockImplementation(async () => native.promise);
    h.controller.open();
    await flush();
    const execution = h.controller.activate(key('Reload'));
    h.controller.close();
    h.controller.open();
    h.controller.setQuery('new session');
    await flush();
    native.resolve([]);
    await execution;
    expect(h.controller.getSnapshot()).toMatchObject({ isOpen: true, query: 'new session', feedback: undefined });
    expect(h.loadConnections).toHaveBeenCalledTimes(1);
  });

  it('rechecks current target route/owner before navigating and closes only on valid navigation', async () => {
    h.register(
      'probe/route',
      { schemaVersion: 1, kind: 'navigation', target: { kind: 'plugin', pluginId: 'probe', path: '/capabilities' } },
      'Tasks',
    );
    h.controller.open();
    await flush();
    const retained = key('Tasks');
    h.routes.clear();
    await h.controller.activate(retained);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().isOpen).toBe(true);
    h.routes.add('/capabilities');
    h.controller.refresh();
    await flush();
    await h.controller.activate(key('Tasks'));
    expect(h.navigate).toHaveBeenCalledWith('/_plugin/probe/capabilities');
    expect(h.controller.getSnapshot().isOpen).toBe(false);
  });

  it('keeps a contributed disabled reason visible and never executes its action', async () => {
    h.register(
      'probe/disabled',
      { ...navigation(), availability: { state: 'disabled', reason: 'Not available in this context.' } },
      'Disabled',
    );
    h.controller.open();
    await flush();
    expect(h.controller.getSnapshot().rows.find((row) => row.label === 'Disabled')?.disabledReason).toBe(
      'Not available in this context.',
    );
    await h.controller.activate(key('Disabled'));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('resolves a typed setting intent into the existing settings route without any settings write', async () => {
    h.register(
      'probe/theme',
      {
        schemaVersion: 1,
        kind: 'setting',
        target: { section: 'core', categoryId: 'appearance', settingId: 'appearance.theme' },
      },
      'Theme',
    );
    h.controller.open();
    await flush();
    await h.controller.activate(key('Theme'));
    const destination = new URL(h.navigate.mock.calls[0][0], 'https://host.invalid');
    expect(destination.pathname).toBe('/settings');
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      section: 'core',
      category: 'appearance',
      setting: 'appearance.theme',
    });
    expect(h.loadConnections).not.toHaveBeenCalled();
  });

  it('rechecks owner readiness at the exact activation boundary without relying on a prior refresh', async () => {
    h.controller.open();
    await flush();
    const retained = key('Reload');
    h.ready.clear();
    await h.controller.activate(retained);
    expect(h.loadConnections).not.toHaveBeenCalled();
  });

  it('does not dispatch a second native command after close/reopen while the first is still accepted and pending', async () => {
    const native = createDeferred<never[]>();
    h.loadConnections.mockImplementation(async () => native.promise);
    h.controller.open();
    await flush();
    const first = h.controller.activate(key('Reload'));
    h.controller.close();
    h.controller.open();
    await flush();
    const repeated = h.controller.activate(key('Reload'));
    expect(h.loadConnections).toHaveBeenCalledTimes(1);
    native.resolve([]);
    await Promise.all([first, repeated]);
  });
});

describe('scoped provider interaction and identity fences', () => {
  const connection = { kind: 'connection' as const, pluginId: 'probe', connectionId: 'prod', label: 'Production' };
  const resourceType = { kind: 'resource-type' as const, pluginId: 'probe', connectionId: 'prod', resourceKey: 'pods', label: 'Pods' };
  const resource = { kind: 'resource' as const, pluginId: 'probe', connectionId: 'prod', resourceKey: 'pods', resourceId: 'api', namespace: 'apps', uid: 'uid-1', label: 'api' };

  it('scopes without navigation and restores parent query and selected identity', async () => {
    h.provider('probe/scoped', async (request) => {
      const scopes = (request as ProviderRequest & { scopes: unknown[] }).scopes;
      const scope = scopes.length ? resourceType : connection;
      return { items: [{ id: scope.kind, label: scope.label, value: { ...navigation(), scope } }], completion: 'complete' };
    });
    h.controller.open();
    h.controller.setQuery('pro');
    await vi.advanceTimersByTimeAsync(150);
    const selected = key('Production');
    h.controller.setSelectedKey(selected);
    expect(h.controller.scope(selected)).toBe(true);
    expect(h.controller.getSnapshot().query).toBe('');
    expect(h.navigate).not.toHaveBeenCalled();
    await flush();
    expect(h.controller.scope(key('Pods'))).toBe(true);
    expect(h.controller.getSnapshot().scopes).toEqual([connection, resourceType]);
    h.controller.removeScope(0);
    await flush();
    expect(h.controller.getSnapshot().scopes).toEqual([]);
    expect(h.controller.getSnapshot().query).toBe('pro');
    expect(h.controller.getSnapshot().selectedKey).toBe(selected);
  });

  it('rejects out-of-scope identities and dispatches only registered owner-qualified actions', async () => {
    const executeAction = vi.fn(async (_action: unknown, _context: unknown) => undefined);
    h.register('probe/actions', {
      schemaVersion: 1, kind: 'provider', executeAction,
      search: async () => ({
        items: [
          { id: 'valid', label: 'Logs', value: { schemaVersion: 1, kind: 'action', action: { id: 'probe:logs', target: resource } } },
          { id: 'foreign', label: 'Other connection', value: { schemaVersion: 1, kind: 'action', action: { id: 'probe:logs', target: { ...resource, connectionId: 'other' } } } },
        ], completion: 'complete',
      }),
    });
    h.controller.open({ scope: connection });
    await flush();
    expect(labels()).toEqual(['Logs']);
    await h.controller.activate(key('Logs'));
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(executeAction.mock.calls[0]?.[0]).toEqual({ id: 'probe:logs', target: resource });
  });

  it('preserves stable selection across events and rejects a replaced UID key', async () => {
    let uid = 'uid-1';
    h.provider('probe/objects', async () => ({
      items: [{ id: 'api', label: 'api', value: { ...navigation(), scope: { ...resource, uid } } }],
      completion: 'complete',
    }));
    h.controller.open({ scope: resourceType });
    await flush();
    const first = key('api');
    h.controller.refresh();
    await flush();
    expect(key('api')).toBe(first);
    uid = 'uid-2';
    h.controller.refresh();
    await flush();
    expect(key('api')).not.toBe(first);
    await h.controller.activate(first);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('retains typed denial and partial state without claiming empty success', async () => {
    h.register('probe/denied', {
      schemaVersion: 1, kind: 'provider',
      search: async () => ({ items: [], completion: 'complete', status: 'forbidden', message: 'Access denied.' }),
    });
    h.controller.open({ scope: connection });
    await flush();
    expect(h.controller.getSnapshot().sources).toContainEqual(expect.objectContaining({ state: 'forbidden', message: 'Access denied.' }));
    expect(h.controller.getSnapshot().scopes).toEqual([connection]);
  });

  it('cancels validation on refresh before dispatching an accepted action', async () => {
    const validation = createDeferred<boolean>();
    const executeAction = vi.fn(async () => undefined);
    h.register('probe/validate', {
      schemaVersion: 1, kind: 'provider', executeAction,
      validateAction: async () => validation.promise,
      search: async () => ({ items: [{ id: 'logs', label: 'Logs', value: { schemaVersion: 1, kind: 'action', action: { id: 'probe:logs', target: resource } } }], completion: 'complete' }),
    });
    h.controller.open({ scope: connection });
    await flush();
    const pending = h.controller.activate(key('Logs'));
    h.controller.refresh();
    validation.resolve(true);
    await pending;
    expect(executeAction).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().isOpen).toBe(true);
  });

  it('keeps recovery scope and query open and requeries only after explicit recovery', async () => {
    const executeAction = vi.fn(async () => ({ keepOpen: true as const }));
    const search = vi.fn(async () => ({ items: [{ id: 'connect', label: 'Connect', value: { schemaVersion: 1, kind: 'action', action: { id: 'probe:connect', target: connection } } }], completion: 'complete' }));
    h.register('probe/recovery', { schemaVersion: 1, kind: 'provider', search, executeAction });
    h.controller.open({ scope: connection });
    h.controller.setQuery('connect');
    await vi.advanceTimersByTimeAsync(150);
    expect(executeAction).not.toHaveBeenCalled();
    const count = search.mock.calls.length;
    await h.controller.activate(key('Connect'));
    await flush();
    expect(search.mock.calls.length).toBeGreaterThan(count);
    expect(h.controller.getSnapshot()).toMatchObject({ isOpen: true, query: 'connect', scopes: [connection] });
  });

  it('defers a connection status refresh until failed connect settles and preserves its feedback', async () => {
    const connectionResult = createDeferred();
    let acceptedSignal: AbortSignal | undefined;
    const executeAction = vi.fn(async (_action: unknown, context: { signal: AbortSignal }) => {
      acceptedSignal = context.signal;
      // StartConnection can publish status before returning its failure.
      h.controller.refresh();
      return connectionResult.promise;
    });
    const search = vi.fn(async () => ({ items: [{ id: 'connect', label: 'Connect', value: { schemaVersion: 1, kind: 'action', action: { id: 'probe:connect', target: connection } } }], completion: 'complete' }));
    h.register('probe/status-recovery', { schemaVersion: 1, kind: 'provider', search, executeAction });
    h.controller.open({ scope: connection });
    await flush();
    const searches = search.mock.calls.length;
    const execution = h.controller.activate(key('Connect'));
    expect(acceptedSignal?.aborted).toBe(false);
    expect(search).toHaveBeenCalledTimes(searches);
    connectionResult.reject({
      code: 'UNAVAILABLE',
      detail: 'Connection did not become ready.',
      message: 'Connection did not become ready.',
    });
    await execution;
    await flush();
    expect(acceptedSignal?.aborted).toBe(false);
    expect(search.mock.calls.length).toBeGreaterThan(searches);
    expect(h.controller.getSnapshot().feedback?.message).toBeTruthy();
    expect(h.controller.getSnapshot().isOpen).toBe(true);
    expect(h.controller.getSnapshot().scopes).toEqual([connection]);
  });

  it('chooses the best typed match instead of retaining a weaker fuzzy selection, while refresh preserves explicit selection', async () => {
    h.register('probe/prod', { ...navigation(), scope: connection }, 'prod');
    h.register('probe/pods', { ...navigation(), scope: resourceType }, 'Pods');
    h.controller.open({ scope: connection });
    h.controller.setQuery('prod');
    await vi.advanceTimersByTimeAsync(150);
    const prior = key('prod');
    expect(h.controller.getSnapshot().selectedKey).toBe(prior);
    h.controller.setQuery('pod');
    await vi.advanceTimersByTimeAsync(150);
    expect(labels()).toEqual(['Pods', 'prod']);
    expect(h.controller.getSnapshot().selectedKey).toBe(key('Pods'));
    h.controller.setSelectedKey(prior);
    h.controller.refresh();
    await flush();
    expect(h.controller.getSnapshot().selectedKey).toBe(prior);
  });
});

describe('targeted provider recovery', () => {
  it('recovers only the failed source and preserves another source selection', async () => {
    const failing = vi.fn(async () => response('recovered', 'Recovered'));
    failing.mockRejectedValueOnce(new Error('Source offline.'));
    const healthy = vi.fn(async () => response('healthy', 'Healthy'));
    h.provider('probe/failed', failing);
    h.provider('probe/healthy', healthy);
    h.controller.open();
    await flush();
    const selected = key('Healthy');
    h.controller.setSelectedKey(selected);
    expect(h.controller.getSnapshot().sources).toContainEqual(expect.objectContaining({ id: 'probe/failed', state: 'unavailable', retryable: true }));
    h.controller.retrySource('probe/failed');
    await flush();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(labels()).toEqual(expect.arrayContaining(['Recovered', 'Healthy']));
    expect(h.controller.getSnapshot().selectedKey).toBe(selected);
    expect(h.controller.getSnapshot().sources).toContainEqual(expect.objectContaining({ id: 'probe/failed', state: 'complete', retryable: false }));
  });

  it('fences a timed-out attempt after targeted retry even if the old provider ignores cancellation', async () => {
    const late = createDeferred<ProviderResponse>();
    const signals: AbortSignal[] = [];
    const search = vi.fn(async (request: ProviderRequest) => {
      signals.push(request.signal);
      return signals.length === 1 ? late.promise : response('fresh', 'Fresh');
    });
    h.provider('probe/timeout', search);
    h.controller.open();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(signals[0].aborted).toBe(true);
    h.controller.retrySource('probe/timeout');
    await flush();
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1].aborted).toBe(false);
    expect(labels()).toEqual(['Fresh']);
    late.resolve(response('old', 'Old timeout result'));
    await flush();
    expect(labels()).toEqual(['Fresh']);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('offers retry for partial providers but not malformed registrations, truncation, or healthy sources', async () => {
    const partial = vi.fn(async () => ({ ...response('partial'), status: 'partial' as const }));
    const truncated = vi.fn(async () => ({ ...response('truncated'), completion: 'truncated' as const }));
    h.provider('probe/partial', partial);
    h.provider('probe/truncated', truncated);
    h.register('probe/invalid', { schemaVersion: 1, kind: 'provider' });
    h.controller.open();
    await flush();
    const sources = h.controller.getSnapshot().sources;
    expect(sources.find((source) => source.id === 'probe/partial')?.retryable).toBe(true);
    expect(sources.filter((source) => source.id !== 'probe/partial').every((source) => !source.retryable)).toBe(true);
    h.controller.retrySource('probe/truncated');
    h.controller.retrySource('probe/invalid');
    await flush();
    expect(truncated).toHaveBeenCalledTimes(1);
    h.controller.retrySource('probe/partial');
    await flush();
    expect(partial).toHaveBeenCalledTimes(2);
  });
});
