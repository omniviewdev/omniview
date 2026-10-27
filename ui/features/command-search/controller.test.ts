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
  const controller = createGlobalSearchController({
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

  it('removes old provider rows immediately on a new query', async () => {
    const pending = createDeferred<ProviderResponse>();
    h.provider('probe/search', async ({ query }) =>
      query === 'waiting' ? pending.promise : Promise.resolve(response('old')),
    );
    h.controller.open();
    await flush();
    expect(labels()).toEqual(['old']);
    h.controller.setQuery('waiting');
    expect(labels()).toEqual([]);
  });

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

  it('shows local matches without waiting and searches only after typing pauses', async () => {
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
    expect(labels()).toEqual(['Reload connections']);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    h.controller.setQuery('rel conn');
    await vi.advanceTimersByTimeAsync(149);
    expect(requests).toHaveLength(1);
    expect(labels()).toEqual(['Reload connections']);
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
