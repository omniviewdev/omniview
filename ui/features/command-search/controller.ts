import { isCancelledError, parseAppError } from '@omniviewdev/runtime';
import type {
  ExtensionContributionRegistration,
  ExtensionPointRegistryContract,
  ExtensionPointStoreContract,
} from '@omniviewdev/runtime';
import {
  admitProviderResponse,
  admitSearchContribution,
  admitSearchEntry,
  getNavigationHref,
  isSearchQueryAllowed,
} from './admission';
import { GLOBAL_SEARCH_EXTENSION_POINT_ID } from './extensionPoint';
import type {
  SearchEntryV1,
  SearchFeedback,
  SearchProviderItemV1,
  SearchProviderV1,
  SearchRow,
  SearchSnapshot,
  SearchSource,
} from './types';

type ControllerDependencies = {
  registry: ExtensionPointRegistryContract;
  isPluginReady: (pluginId: string) => boolean;
  hasPluginRoute: (pluginId: string, path: string) => boolean;
  listResourcePlugins: () => Promise<readonly string[]>;
  loadConnections: (pluginId: string) => Promise<unknown>;
  navigate: (href: string) => void;
};

export type GlobalSearchController = {
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  refresh: () => void;
  activate: (key: string) => Promise<void>;
  getSnapshot: () => SearchSnapshot;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

type AcceptedEntry = {
  registration: ExtensionContributionRegistration;
  label: string;
  itemId: string;
  value: SearchEntryV1;
  provider?: SearchProviderV1['search'];
};

type NativeExecution = {
  session: number;
  owner: string;
  target: string;
  valid: boolean;
};

type ProviderAttempt = {
  registration: ExtensionContributionRegistration;
  provider: SearchProviderV1;
  receiver: unknown;
  source: SearchSource;
  controller: AbortController;
  items: AcceptedEntry[];
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

const capabilityUnavailable = 'Connection discovery is unavailable for this plugin.';

function tokenScore(query: string, candidate: string): number {
  if (candidate === query) {
    return 100;
  }

  if (candidate.startsWith(query)) {
    return 80;
  }

  if (candidate.includes(query)) {
    return 60;
  }

  let cursor = 0;
  for (const character of candidate) {
    if (character === query[cursor]) {
      cursor++;
    }
  }

  if (cursor === query.length) {
    return 30;
  }

  // Permit one edit only for meaningful words, never short abbreviations.
  if (query.length < 5 || Math.abs(candidate.length - query.length) > 1) {
    return 0;
  }

  let left = 0;
  let right = 0;
  let edits = 0;
  while (left < query.length && right < candidate.length) {
    if (query[left] === candidate[right]) {
      left++;
      right++;
    } else {
      if (++edits > 1) {
        return 0;
      }

      if (
        query.length === candidate.length &&
        query[left] === candidate[right + 1] &&
        query[left + 1] === candidate[right]
      ) {
        left += 2;
        right += 2;
        continue;
      }

      if (query.length >= candidate.length) {
        left++;
      }

      if (candidate.length >= query.length) {
        right++;
      }
    }
  }

  return edits + (left < query.length || right < candidate.length ? 1 : 0) <= 1 ? 15 : 0;
}

function staticScore(query: string, label: string, value: SearchEntryV1): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return 1;
  }

  const fields = [
    { text: label.toLowerCase(), weight: 6 },
    ...(value.keywords ?? []).map((text) => ({ text: text.toLowerCase(), weight: 3 })),
    { text: value.description?.toLowerCase() ?? '', weight: 1 },
  ];
  let score = 0;
  for (const token of normalized.split(/[\s/_.-]+/).filter(Boolean)) {
    let best = 0;
    for (const field of fields) {
      for (const word of field.text.split(/[\s/_.-]+/)) {
        best = Math.max(best, tokenScore(token, word) * field.weight);
      }
    }

    if (!best) {
      return 0;
    }

    score += best;
  }

  for (const field of fields) {
    if (field.text === normalized) {
      score += 200 * field.weight;
    } else if (field.text.startsWith(normalized)) {
      score += 100 * field.weight;
    }
  }

  return score;
}

function sameIntent(left: SearchEntryV1, right: SearchEntryV1): boolean {
  if (left.kind === 'command' && right.kind === 'command') {
    return left.command.pluginId === right.command.pluginId;
  }

  if (left.kind === 'navigation' && right.kind === 'navigation') {
    if (left.target.kind === 'core' && right.target.kind === 'core') {
      return left.target.path === right.target.path;
    }

    return (
      left.target.kind === 'plugin' &&
      right.target.kind === 'plugin' &&
      left.target.pluginId === right.target.pluginId &&
      left.target.path === right.target.path
    );
  }

  if (left.kind === 'setting' && right.kind === 'setting') {
    if (left.target.section === 'extensions' || right.target.section === 'extensions') {
      return left.target.section === right.target.section;
    }

    if (left.target.settingId !== right.target.settingId) {
      return false;
    }

    if (left.target.section === 'core' && right.target.section === 'core') {
      return left.target.categoryId === right.target.categoryId;
    }

    return (
      left.target.section === 'plugins' &&
      right.target.section === 'plugins' &&
      left.target.pluginId === right.target.pluginId
    );
  }

  return false;
}

export function createGlobalSearchController(deps: ControllerDependencies): GlobalSearchController {
  let snapshot: SearchSnapshot = { isOpen: false, query: '', rows: [], sources: [], executionPending: false };
  const listeners = new Set<() => void>();
  let store: ExtensionPointStoreContract | undefined;
  let unsubscribeStore: (() => void) | undefined;
  let epoch = 0;
  let session = 0;
  let capturedVersion = -1;
  let disposed = false;
  let nativeExecution: NativeExecution | undefined;
  let discovery = 0;
  let capabilityState: 'pending' | 'ready' | 'unavailable' = 'pending';
  let resourcePlugins = new Set<string>();
  const statics: AcceptedEntry[] = [];
  const attempts: ProviderAttempt[] = [];
  const otherSources: SearchSource[] = [];
  const actions = new Map<string, AcceptedEntry>();
  let active = 0;
  let nextAttempt = 0;
  let staticOverflow = false;
  let displayOverflow = false;
  let feedback: SearchFeedback | undefined;
  let launchQueued = false;
  let launchToken: number | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let debounceSearch = false;

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function ownerReady(pluginId: string) {
    return pluginId === 'core' || deps.isPluginReady(pluginId);
  }

  function isExecutionCurrent(execution: NativeExecution) {
    return (
      nativeExecution === execution &&
      execution.valid &&
      !disposed &&
      snapshot.isOpen &&
      execution.session === session &&
      ownerReady(execution.owner) &&
      deps.isPluginReady(execution.target)
    );
  }

  function disabledReason(value: SearchEntryV1): string | undefined {
    if (value.availability?.state === 'disabled') {
      return value.availability.reason;
    }

    if (value.kind === 'command') {
      if (
        !deps.isPluginReady(value.command.pluginId) ||
        capabilityState !== 'ready' ||
        !resourcePlugins.has(value.command.pluginId)
      ) {
        return capabilityUnavailable;
      }
    } else if (value.kind === 'navigation' && value.target.kind === 'plugin') {
      if (
        !deps.isPluginReady(value.target.pluginId) ||
        !deps.hasPluginRoute(value.target.pluginId, value.target.path)
      ) {
        return 'This destination is unavailable.';
      }
    } else if (
      value.kind === 'setting' &&
      value.target.section === 'plugins' &&
      !deps.isPluginReady(value.target.pluginId)
    ) {
      return 'This plugin is unavailable.';
    }

    return undefined;
  }

  function publish() {
    if (disposed) {
      return;
    }

    const rows: SearchRow[] = [];
    actions.clear();
    const sources = [...otherSources];
    let clipped = displayOverflow;
    function append(entry: AcceptedEntry) {
      if (rows.length >= 100) {
        clipped = true;
        return;
      }

      const key = encodeURIComponent(
        JSON.stringify([epoch, entry.registration.plugin, entry.registration.id, entry.itemId]),
      );
      rows.push({ key, label: entry.label, value: entry.value, disabledReason: disabledReason(entry.value) });
      actions.set(key, entry);
    }

    const lists = [statics, ...attempts.map((attempt) => attempt.items)];
    const quotas = lists.map(() => 0);
    let remaining = 100;
    while (remaining > 0) {
      let allocated = false;
      for (let index = 0; index < lists.length && remaining > 0; index++) {
        if (quotas[index] < lists[index].length) {
          quotas[index]++;
          remaining--;
          allocated = true;
        }
      }

      if (!allocated) {
        break;
      }
    }

    for (let index = 0; index < lists.length; index++) {
      for (let item = 0; item < quotas[index]; item++) {
        append(lists[index][item]);
      }

      if (quotas[index] < lists[index].length) {
        clipped = true;
      }
    }

    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      sources.push(
        attempt.items.length > quotas[index + 1] && attempt.source.state === 'complete'
          ? { ...attempt.source, state: 'truncated' }
          : { ...attempt.source },
      );
    }

    const messages: string[] = [];
    if (!isSearchQueryAllowed(snapshot.query)) {
      messages.push('Search is too long. Narrow your query to 256 characters.');
    }

    if (capabilityState === 'unavailable') {
      messages.push('Connection discovery is unavailable.');
    }

    if (staticOverflow) {
      messages.push('Search catalogue limit reached. Narrow your search; additional candidates were not searched.');
    }

    if (clipped) {
      messages.push('Result limit reached. Narrow your search; additional results are not displayed.');
    }

    snapshot = {
      ...snapshot,
      rows,
      sources,
      message: messages.length ? messages.join(' ') : undefined,
      executionPending: nativeExecution !== undefined,
      feedback,
    };
    emit();
  }

  function abortSearch() {
    clearTimeout(searchTimer);
    searchTimer = undefined;
    for (const attempt of attempts) {
      attempt.settled = true;
      attempt.controller.abort();
      clearTimeout(attempt.timer);
    }

    attempts.length = 0;
    statics.length = 0;
    otherSources.length = 0;
    actions.clear();
    active = 0;
    nextAttempt = 0;
    staticOverflow = false;
    displayOverflow = false;
  }

  function current(token: number, attempt: ProviderAttempt) {
    return (
      !disposed &&
      snapshot.isOpen &&
      epoch === token &&
      !attempt.settled &&
      store === deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID) &&
      store?.version === capturedVersion &&
      ownerReady(attempt.registration.plugin)
    );
  }

  function finishAttempt(token: number, attempt: ProviderAttempt, value: unknown, failed: boolean) {
    if (!current(token, attempt)) {
      return;
    }

    attempt.settled = true;
    clearTimeout(attempt.timer);
    active--;
    if (failed) {
      attempt.source.state = 'unavailable';
    } else {
      let response;
      try {
        response = admitProviderResponse(value);
      } catch {
        response = undefined;
      }

      if (!response) {
        attempt.source.state = 'unavailable';
      } else {
        attempt.source.state = response.completion;
        attempt.items = response.items.map((item: SearchProviderItemV1) => ({
          registration: attempt.registration,
          label: item.label,
          itemId: item.id,
          value: item.value,
          provider: attempt.provider.search,
        }));
      }
    }

    pump(token);
  }

  function pump(token: number) {
    if (disposed || !snapshot.isOpen || token !== epoch) {
      return;
    }

    while (active < 4 && nextAttempt < attempts.length) {
      const attempt = attempts[nextAttempt++];
      if (!current(token, attempt)) {
        attempt.settled = true;
        attempt.controller.abort();
        attempt.source.state = 'unavailable';
        continue;
      }

      active++;
      attempt.source.state = 'pending';

      attempt.timer = setTimeout(() => {
        if (!current(token, attempt)) {
          return;
        }

        attempt.controller.abort();
        finishAttempt(token, attempt, undefined, true);
      }, 5000);
      try {
        Promise.resolve(
          attempt.provider.search.call(attempt.receiver, {
            query: snapshot.query,
            signal: attempt.controller.signal,
            limit: 20,
          }),
        ).then(
          (value) => {
            finishAttempt(token, attempt, value, false);
          },
          () => {
            finishAttempt(token, attempt, undefined, true);
          },
        );
      } catch {
        finishAttempt(token, attempt, undefined, true);
      }
    }

    publish();
  }

  function invalidate(debounce = false) {
    debounceSearch = debounce;
    ++epoch;
    if (nativeExecution && !isExecutionCurrent(nativeExecution)) {
      // A later ready phase must not revive feedback from a retired owner.
      nativeExecution.valid = false;
    }

    if (!snapshot.isOpen || disposed) {
      return;
    }

    abortSearch();
    feedback = nativeExecution?.valid ? feedback : undefined;
    snapshot = { ...snapshot, rows: [], sources: [], feedback };
    emit();
    if (debounce) {
      launchToken = undefined;
      launch(epoch);
      return;
    }

    launchToken = epoch;
    if (launchQueued) {
      return;
    }

    launchQueued = true;
    // A catalogue rebuild can emit hundreds of synchronous mutations. Keep
    // immediate fences but only one queued launch, carrying the latest token.
    queueMicrotask(() => {
      launchQueued = false;
      const token = launchToken;
      launchToken = undefined;
      if (disposed || !snapshot.isOpen || token === undefined || token !== epoch) {
        return;
      }

      launch(token);
    });
  }

  function launch(token: number) {
    store = deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID);
    capturedVersion = store?.version ?? -1;
    if (!isSearchQueryAllowed(snapshot.query)) {
      publish();
      return;
    }

    const query = snapshot.query;
    const ranked: Array<{ entry: AcceptedEntry; score: number }> = [];
    const registrations = store?.listAll() ?? [];
    staticOverflow = registrations.length > 1000;
    let overflowProvider = false;
    for (let index = 0; index < Math.min(registrations.length, 1000); index++) {
      const registration = registrations[index];
      let value;
      try {
        value = admitSearchContribution(registration);
      } catch {
        value = undefined;
      }

      if (!value) {
        otherSources.push({ id: `invalid:${index}`, label: 'Search contribution', state: 'unavailable' });
        continue;
      }

      if (!ownerReady(registration.plugin)) {
        continue;
      }

      if (value.kind === 'provider') {
        if (attempts.length >= 8) {
          if (!overflowProvider) {
            otherSources.push({ id: registration.id, label: registration.label, state: 'source-limit' });
          }

          overflowProvider = true;
          continue;
        }

        attempts.push({
          registration,
          provider: value,
          receiver: registration.value,
          source: { id: registration.id, label: registration.label, state: 'queued' },
          controller: new AbortController(),
          items: [],
          settled: false,
        });
      } else {
        const score = staticScore(query, registration.label, value);
        if (score > 0) {
          ranked.push({ entry: { registration, label: registration.label, itemId: '', value }, score });
        }
      }
    }

    ranked.sort((left, right) => right.score - left.score);
    displayOverflow = ranked.length > 100;
    statics.push(...ranked.slice(0, 100).map(({ entry }) => entry));
    publish();
    if (debounceSearch) {
      searchTimer = setTimeout(() => {
        searchTimer = undefined;
        pump(token);
      }, 150);
    } else {
      pump(token);
    }
  }

  function attachStore() {
    const next = deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID);
    if (next === store) {
      return;
    }

    unsubscribeStore?.();
    store = next;
    unsubscribeStore = store?.subscribe(() => {
      invalidate(); 
    });
  }

  function discover() {
    const token = ++discovery;
    capabilityState = 'pending';
    resourcePlugins = new Set();
    Promise.resolve()
      .then(async () => {
        if (disposed || !snapshot.isOpen || discovery !== token) {
          return undefined;
        }

        return deps.listResourcePlugins();
      })
      .then(
        (plugins) => {
          if (disposed || !snapshot.isOpen || discovery !== token) {
            return;
          }

          if (!plugins) {
            capabilityState = 'unavailable';
            publish();
            return;
          }

          resourcePlugins = new Set(plugins);
          capabilityState = 'ready';
          publish();
        },
        () => {
          if (disposed || !snapshot.isOpen || discovery !== token) {
            return;
          }

          capabilityState = 'unavailable';
          publish();
        },
      );
  }

  attachStore();
  const unsubscribeRegistry = deps.registry.subscribe(() => {
    attachStore();
    invalidate();
  });

  const controller: GlobalSearchController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open() {
      if (disposed || snapshot.isOpen) {
        return;
      }

      ++session;
      snapshot = {
        ...snapshot,
        isOpen: true,
        query: '',
        feedback: undefined,
        executionPending: nativeExecution !== undefined,
      };
      discover();
      invalidate();
    },
    close() {
      if (!snapshot.isOpen) {
        return;
      }

      ++discovery;
      ++session;
      if (nativeExecution) {
        nativeExecution.valid = false;
      }

      ++epoch;
      launchToken = undefined;
      abortSearch();
      feedback = undefined;
      snapshot = { isOpen: false, query: '', rows: [], sources: [], executionPending: nativeExecution !== undefined };
      emit();
    },
    setQuery(query) {
      if (!snapshot.isOpen || disposed || snapshot.query === query) {
        return;
      }

      snapshot = { ...snapshot, query };
      invalidate(true);
    },
    refresh() {
      attachStore();
      if (snapshot.isOpen && !disposed) {
        discover();
        invalidate();
      }
    },
    async activate(key) {
      if (disposed || !snapshot.isOpen) {
        return;
      }

      const entry = actions.get(key);
      if (
        !entry ||
        !store ||
        store !== deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID) ||
        store.version !== capturedVersion ||
        !ownerReady(entry.registration.plugin)
      ) {
        return;
      }

      let currentValue;
      try {
        currentValue = admitSearchContribution(entry.registration);
      } catch {
        return;
      }

      let value: SearchEntryV1 | undefined;
      if (entry.provider) {
        if (currentValue?.kind !== 'provider' || currentValue.search !== entry.provider) {
          return;
        }

        value = admitSearchEntry(entry.value);
      } else if (
        currentValue &&
        currentValue.kind !== 'provider' &&
        entry.registration.label === entry.label &&
        sameIntent(entry.value, currentValue)
      ) {
        value = currentValue;
      }

      if (!value) {
        return;
      }

      if (value.kind === 'command' && nativeExecution) {
        return;
      }

      const disabled = disabledReason(value);
      if (disabled) {
        feedback = { message: disabled };
        publish();
        return;
      }

      if (value.kind !== 'command') {
        let href: string | undefined;
        if (value.kind === 'navigation') {
          href = getNavigationHref(value.target);
        } else {
          const params = new URLSearchParams({ section: value.target.section });
          if (value.target.section === 'core') {
            params.set('category', value.target.categoryId);
          }

          if (value.target.section === 'plugins') {
            params.set('plugin', value.target.pluginId);
          }

          if (value.target.section !== 'extensions' && value.target.settingId) {
            params.set('setting', value.target.settingId);
          }

          href = `/settings?${params}`;
        }

        if (!href) {
          return;
        }

        deps.navigate(href);
        controller.close();
        return;
      }

      const execution: NativeExecution = {
        session,
        owner: entry.registration.plugin,
        target: value.command.pluginId,
        valid: true,
      };
      nativeExecution = execution;
      feedback = { message: 'Reloading connections…' };
      publish();
      try {
        await deps.loadConnections(value.command.pluginId);
        if (isExecutionCurrent(execution)) {
          feedback = { message: 'Connections reloaded.' };
        }
      } catch (error) {
        if (isExecutionCurrent(execution)) {
          if (isCancelledError(error)) {
            feedback = undefined;
          } else {
            const safe = parseAppError(error);
            feedback = { message: safe.detail, code: safe.code, requestId: safe.requestId };
          }
        }
      } finally {
        nativeExecution = undefined;
        if (!disposed && snapshot.isOpen) {
          publish();
        }
      }
    },
    dispose() {
      controller.close();
      disposed = true;
      ++epoch;
      ++session;
      ++discovery;
      abortSearch();
      unsubscribeStore?.();
      unsubscribeRegistry();
      listeners.clear();
    },
  };
  return controller;
}
