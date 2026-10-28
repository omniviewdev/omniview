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
  admitSearchScope,
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
  SearchScopeV1,
  NavigationTargetV1,
} from './types';

type ControllerDependencies = {
  registry: ExtensionPointRegistryContract;
  isPluginReady: (pluginId: string) => boolean;
  hasPluginRoute: (pluginId: string, path: string) => boolean;
  listResourcePlugins: () => Promise<readonly string[]>;
  loadConnections: (pluginId: string) => Promise<unknown>;
  navigate: (href: string) => void;
  openResource?: (target: Extract<SearchScopeV1, { kind: 'resource' }>, signal: AbortSignal, validateData?: (data: unknown) => boolean) => Promise<void>;
};

export type GlobalSearchController = {
  open: (options?: { scope?: SearchScopeV1 | null }) => void;
  scope: (key: string) => boolean;
  removeScope: (index: number, reason?: string) => void;
  setSelectedKey: (key?: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  refresh: () => void;
  notifyDataChanged: () => void;
  retrySource: (sourceID: string) => void;
  setProviderContextError: (sourceID: string, message?: string) => boolean;
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
  if (left.kind === 'action' && right.kind === 'action') {
    return JSON.stringify(left.action) === JSON.stringify(right.action);
  }

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
  let snapshot: SearchSnapshot = { isOpen: false, query: '', scopes: [], rows: [], sources: [], searchPending: false, executionPending: false };
  const parents: Array<{ query: string; selectedKey?: string }> = [];
  let actionExecution: AbortController | undefined;
  let actionAccepted = false;
  let deferredLiveRefresh = false;
  const registrationIds = new WeakMap<ExtensionContributionRegistration, number>();
  let nextRegistrationId = 0;
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
  let staticOverflow = false;
  let displayOverflow = false;
  let feedback: SearchFeedback | undefined;
  let launchQueued = false;
  let launchToken: number | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let debounceSearch = false;
  let awaitingLaunch = false;
  let retainQueryRows = false;
  let resetQuerySelection = false;
  let dataRefreshQueued = false;
  let liveRefresh = false;
  const retainedItems = new Map<ExtensionContributionRegistration, AcceptedEntry[]>();
  const contextErrors = new WeakMap<ExtensionContributionRegistration, string>();

  function scopeIdentity(scope: SearchScopeV1 | undefined) {
    if (!scope) {
      return undefined;
    }

    if (scope.kind === 'connection') {
      return { kind: scope.kind, pluginId: scope.pluginId, connectionId: scope.connectionId };
    }

    const { label: _label, scopeLabel: _scopeLabel, ...identity } = scope;
    return identity;
  }

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

  function withinScope(value: SearchEntryV1, owner: string): boolean {
    const parent = snapshot.scopes.at(-1);
    if (!parent) {
      return true;
    }

    const target = value.kind === 'action' ? value.action.target : value.scope;
    if (!target) {
      return owner === parent.pluginId && value.kind === 'navigation';
    }

    if (value.kind === 'action' && value.action.recovery === 'connection') {
      return target.kind === 'connection' && owner === parent.pluginId &&
        target.pluginId === parent.pluginId && target.connectionId === parent.connectionId;
    }

    return target.pluginId === parent.pluginId && target.connectionId === parent.connectionId &&
      (parent.kind === 'connection' || (target.kind !== 'connection' && target.resourceKey === parent.resourceKey)) &&
      (parent.kind !== 'resource-type' || target.kind !== 'resource' || !parent.namespaces?.length || parent.namespaces.includes(target.namespace)) &&
      (parent.kind !== 'resource-type' || target.kind !== 'resource-type' || !parent.namespaces?.length ||
        !!target.namespaces?.length && target.namespaces.every((namespace) => parent.namespaces!.includes(namespace))) &&
      (parent.kind !== 'resource' || (target.kind === 'resource' && target.resourceId === parent.resourceId && target.namespace === parent.namespace && target.uid === parent.uid));
  }

  function publish() {
    if (disposed) {
      return;
    }

    const searchPending = awaitingLaunch || attempts.some((attempt) => !attempt.settled);
    const retainRows = retainQueryRows && searchPending;
    const rows: SearchRow[] = [];
    actions.clear();
    const sources = [...otherSources];
    let clipped = displayOverflow;
    function append(entry: AcceptedEntry) {
      if (rows.length >= 100) {
        clipped = true;
        return;
      }

      if (!registrationIds.has(entry.registration)) {
        registrationIds.set(entry.registration, ++nextRegistrationId);
      }

      const key = encodeURIComponent(
        JSON.stringify([registrationIds.get(entry.registration), entry.registration.plugin, entry.registration.id, entry.itemId, scopeIdentity(entry.value.scope), entry.value.kind === 'action' ? { ...entry.value.action, target: scopeIdentity(entry.value.action.target) } : undefined]),
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
          : { ...attempt.source, retryable: !contextErrors.has(attempt.registration) && attempt.settled && (attempt.source.state === 'unavailable' || attempt.source.state === 'partial') },
      );
    }

    if (!snapshot.scopes.length) {
      rows.sort((left, right) => (right.value.scope?.kind === 'connection' ? 1 : 0) - (left.value.scope?.kind === 'connection' ? 1 : 0));
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

    const selectedKey = retainRows
      ? snapshot.selectedKey
      : !resetQuerySelection && snapshot.selectedKey && (rows.some((row) => row.key === snapshot.selectedKey && !row.disabledReason) || searchPending)
        ? snapshot.selectedKey
        : rows.find((row) => !row.disabledReason)?.key;
    if (retainRows) {
      // Retained rows describe the previous query, never current executable actions.
      actions.clear();
    } else {
      retainQueryRows = false;
      resetQuerySelection = false;
    }

    snapshot = {
      ...snapshot,
      rows: retainRows ? snapshot.rows : rows,
      sources,
      searchPending,
      selectedKey,
      message: messages.length ? messages.join(' ') : undefined,
      executionPending: nativeExecution !== undefined || actionExecution !== undefined,
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
        attempt.source.state = response.status && response.status !== 'ready' ? response.status : response.completion;
        attempt.source.message = response.message;
        attempt.items = response.items
          .filter((item) => withinScope(item.value, attempt.registration.plugin) &&
            (item.value.kind !== 'action' || !!attempt.provider.executeAction &&
              item.value.action.id.startsWith(`${attempt.registration.plugin}:`) &&
              item.value.action.id.length > attempt.registration.plugin.length + 1))
          .map((item: SearchProviderItemV1) => ({
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

    while (active < 4) {
      const attempt = attempts.find((candidate) => !candidate.settled && candidate.source.state === 'queued');
      if (!attempt) {
        break;
      }

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
            scopes: Object.freeze(snapshot.scopes.map((scope) => Object.freeze(scope.kind === 'resource-type' && scope.namespaces ? { ...scope, namespaces: Object.freeze([...scope.namespaces]) } : { ...scope }))),
            generation: token,
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
    if (dataRefreshQueued && attempts.every((attempt) => attempt.settled) && !actionExecution) {
      dataRefreshQueued = false;
      queueMicrotask(() => {
        if (!disposed && snapshot.isOpen && token === epoch) {
          refreshData();
        }
      });
    }
  }

  function invalidate(debounce = false, preserveFeedback = false, preserveRows = false) {
    debounceSearch = debounce;
    dataRefreshQueued = false;
    liveRefresh = false;
    retainedItems.clear();
    ++epoch;
    actionExecution?.abort();
    deferredLiveRefresh = false;
    if (nativeExecution && !isExecutionCurrent(nativeExecution)) {
      // A later ready phase must not revive feedback from a retired owner.
      nativeExecution.valid = false;
    }

    if (!snapshot.isOpen || disposed) {
      return;
    }

    const canRetainRows = (debounce || preserveRows) &&
      store === deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID) &&
      store?.version === capturedVersion &&
      statics.every((entry) => ownerReady(entry.registration.plugin)) &&
      attempts.every((attempt) => ownerReady(attempt.registration.plugin));
    abortSearch();
    feedback = nativeExecution ? (nativeExecution.valid ? feedback : undefined) : (preserveFeedback ? feedback : undefined);
    const unavailableScope = snapshot.scopes.findIndex((scope) => !ownerReady(scope.pluginId));
    if (unavailableScope !== -1) {
      const parent = parents[unavailableScope];
      snapshot = { ...snapshot, scopes: snapshot.scopes.slice(0, unavailableScope), query: parent?.query ?? snapshot.query, selectedKey: parent?.selectedKey };
      parents.length = unavailableScope;
      feedback = { message: 'The scoped plugin is unavailable. Choose another connection.' };
    }

    awaitingLaunch = true;
    retainQueryRows = canRetainRows && unavailableScope === -1;
    snapshot = {
      ...snapshot,
      rows: retainQueryRows ? snapshot.rows : [],
      sources: retainQueryRows
        ? snapshot.sources.map<SearchSource>((source) => ({ ...source, state: source.state === 'source-limit' ? 'source-limit' : 'queued', retryable: false }))
        : [],
      searchPending: true,
      feedback,
    };
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
    awaitingLaunch = false;
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
        const parent = snapshot.scopes.at(-1);
        if (parent && registration.plugin !== 'core' && registration.plugin !== parent.pluginId) {
          continue;
        }

        const contextError = contextErrors.get(registration);
        if (contextError) {
          otherSources.push({ id: registration.id, label: registration.label, state: 'unavailable', message: contextError });
          continue;
        }

        if (value.supportsScope) {
          try {
            const supported = value.supportsScope.call(registration.value, Object.freeze(snapshot.scopes.map((scope) => Object.freeze({ ...scope, ...(scope.kind === 'resource-type' && scope.namespaces ? { namespaces: Object.freeze([...scope.namespaces]) } : {}) }))));
            if (typeof supported !== 'boolean') {
              otherSources.push({ id: registration.id, label: registration.label, state: 'unavailable' });
              continue;
            }

            if (!supported) {
              continue;
            }
          } catch {
            otherSources.push({ id: registration.id, label: registration.label, state: 'unavailable' });
            continue;
          }
        }

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
          items: liveRefresh ? retainedItems.get(registration) ?? [] : [],
          settled: false,
        });
      } else {
        const score = withinScope(value, registration.plugin) ? staticScore(query, registration.label, value) : 0;
        if (score > 0) {
          ranked.push({ entry: { registration, label: registration.label, itemId: '', value }, score });
        }
      }
    }

    ranked.sort((left, right) => right.score - left.score);
    displayOverflow = ranked.length > 100;
    statics.push(...ranked.slice(0, 100).map(({ entry }) => entry));
    // Immediate launches publish once sources are pending, not queued then pending.
    if (debounceSearch) {
      publish();
      searchTimer = setTimeout(() => {
        searchTimer = undefined;
        pump(token);
      }, 150);
    } else {
      pump(token);
    }
  }

  function refreshData() {
    if (disposed || !snapshot.isOpen) {
      return;
    }

    if (Boolean(actionExecution) || attempts.some((attempt) => !attempt.settled) || launchQueued || searchTimer !== undefined) {
      dataRefreshQueued = true;
      return;
    }

    retainedItems.clear();
    for (const attempt of attempts) {
      retainedItems.set(attempt.registration, attempt.items);
    }

    abortSearch();
    liveRefresh = true;
    debounceSearch = false;
    launch(++epoch);
    liveRefresh = false;
    retainedItems.clear();
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
    open(options) {
      if (disposed || snapshot.isOpen && options?.scope === undefined) {
        return;
      }

      ++session;
      const initialScope = admitSearchScope(options?.scope);
      const scopes: SearchScopeV1[] = [];
      if (initialScope) {
        if (initialScope.kind !== 'connection') {
          scopes.push({ kind: 'connection', pluginId: initialScope.pluginId, connectionId: initialScope.connectionId, label: initialScope.connectionId });
        }

        if (initialScope.kind === 'resource') {
          scopes.push({ kind: 'resource-type', pluginId: initialScope.pluginId, connectionId: initialScope.connectionId, resourceKey: initialScope.resourceKey, label: initialScope.resourceKey });
        }

        scopes.push(initialScope);
      }

      snapshot = {
        ...snapshot,
        isOpen: true,
        query: '',
        scopes,
        selectedKey: undefined,
        feedback: undefined,
        executionPending: nativeExecution !== undefined,
      };
      parents.length = 0;
      parents.push(...snapshot.scopes.map(() => ({ query: '' })));
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
      actionExecution?.abort();
      deferredLiveRefresh = false;
      parents.length = 0;
      awaitingLaunch = false;
      retainQueryRows = false;
      resetQuerySelection = false;
      snapshot = { isOpen: false, query: '', scopes: [], rows: [], sources: [], searchPending: false, executionPending: nativeExecution !== undefined };
      emit();
    },
    setSelectedKey(key) {
      if (key && !snapshot.rows.some((row) => row.key === key && !row.disabledReason)) {
        return;
      }

      snapshot = { ...snapshot, selectedKey: key };
      emit();
    },
    scope(key) {
      const entry = actions.get(key);
      const scope = entry?.value.scope;
      if (!scope || Boolean(disabledReason(entry.value)) || !ownerReady(entry.registration.plugin) || store?.version !== capturedVersion || !withinScope(entry.value, entry.registration.plugin)) {
        return false;
      }

      const parent = snapshot.scopes.at(-1);
      if (scope.kind === 'connection' && Boolean(parent) || scope.kind === 'resource-type' && parent?.kind !== 'connection' || scope.kind === 'resource' && parent?.kind !== 'resource-type') {
        return false;
      }

      parents.push({ query: snapshot.query, selectedKey: snapshot.selectedKey });
      snapshot = { ...snapshot, scopes: [...snapshot.scopes, scope], query: '', selectedKey: undefined };
      invalidate();
      return true;
    },
    removeScope(index, reason) {
      if (index < 0 || index >= snapshot.scopes.length) {
        return;
      }

      const parent = parents[index] ?? { query: '' };
      parents.length = index;
      snapshot = { ...snapshot, scopes: snapshot.scopes.slice(0, index), query: parent.query, selectedKey: parent.selectedKey };
      if (reason) {
        feedback = { message: reason };
      }

      invalidate(false, !!reason);
    },
    setQuery(query) {
      if (!snapshot.isOpen || disposed || snapshot.query === query) {
        return;
      }

      resetQuerySelection = true;
      snapshot = { ...snapshot, query };
      invalidate(true);
    },
    retrySource(sourceID) {
      if (disposed || !snapshot.isOpen || Boolean(actionExecution) || Boolean(nativeExecution) ||
        store !== deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID) || store?.version !== capturedVersion) {
        return;
      }

      const index = attempts.findIndex((attempt) => attempt.source.id === sourceID);
      const previous = attempts[index];
      if (!previous?.settled || contextErrors.has(previous.registration) || !ownerReady(previous.registration.plugin) ||
        (previous.source.state !== 'unavailable' && previous.source.state !== 'partial')) {
        return;
      }

      let contribution;
      try {
        contribution = admitSearchContribution(previous.registration); 
      } catch {
        return; 
      }

      if (contribution?.kind !== 'provider' || contribution.search !== previous.provider.search) {
        return;
      }

      previous.settled = true;
      previous.controller.abort();
      clearTimeout(previous.timer);
      attempts[index] = {
        registration: previous.registration,
        provider: contribution,
        receiver: previous.receiver,
        source: { id: previous.source.id, label: previous.source.label, state: 'queued' },
        controller: new AbortController(),
        items: previous.items,
        settled: false,
      };
      pump(epoch);
    },
    setProviderContextError(sourceID, message) {
      if (disposed) {
        return false;
      }

      const registration = deps.registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID)?.listAll().find((entry) => entry.id === sourceID);
      if (!registration) {
        return false;
      }

      if (message === undefined) {
        if (!contextErrors.has(registration)) {
          return false;
        }

        contextErrors.delete(registration);
        refreshData();
        return true;
      }

      const safeMessage = message.trim().slice(0, 1024) || 'Provider context is unavailable.';
      if (contextErrors.get(registration) === safeMessage) {
        return false;
      }

      contextErrors.set(registration, safeMessage);
      for (const attempt of attempts) {
        if (attempt.registration !== registration) {
          continue;
        }

        if (!attempt.settled && attempt.source.state === 'pending') {
          active--;
        }

        attempt.settled = true;
        attempt.controller.abort();
        clearTimeout(attempt.timer);
        attempt.items = [];
        attempt.source = { ...attempt.source, state: 'unavailable', message: safeMessage, retryable: false };
      }

      pump(epoch);
      return true;
    },
    notifyDataChanged() {
      refreshData();
    },
    refresh() {
      attachStore();
      if (snapshot.isOpen && !disposed) {
        if (actionExecution && actionAccepted && !actionExecution.signal.aborted) {
          deferredLiveRefresh = true;
          return;
        }

        discover();
        invalidate(false, true, true);
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
        !ownerReady(entry.registration.plugin) || contextErrors.has(entry.registration)
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

      if (!withinScope(value, entry.registration.plugin)) {
        return;
      }

      const unavailable = disabledReason(value);
      if (unavailable) {
        feedback = { message: unavailable }; publish(); return; 
      }

      if (value.kind === 'action') {
        if (Boolean(actionExecution) || currentValue?.kind !== 'provider' || !currentValue.executeAction || !value.action.id.startsWith(`${entry.registration.plugin}:`)) {
          return;
        }

        const execution = new AbortController();
        actionExecution = execution;
        const token = epoch;
        const actionSession = session;
        const validator = currentValue.validateResource;
        const context = {
          signal: execution.signal,
          generation: token,
          navigate: (target: NavigationTargetV1) => {
            const href = getNavigationHref(target);
            if (execution.signal.aborted || contextErrors.has(entry.registration) || token !== epoch || session !== actionSession || !snapshot.isOpen || !href ||
              target.kind === 'plugin' && (!deps.isPluginReady(target.pluginId) || !deps.hasPluginRoute(target.pluginId, target.path))) {
              throw new Error('This destination is no longer available.');
            }

            deps.navigate(href);
          },
          openResource: async (target: Extract<SearchScopeV1, { kind: 'resource' }>) => {
            if (execution.signal.aborted || contextErrors.has(entry.registration) || token !== epoch || session !== actionSession || !snapshot.isOpen || !deps.openResource) {
              throw new Error('Resource destination is no longer available.');
            }

            const admitted = admitSearchScope(target);
            if (admitted?.kind !== 'resource' || admitted.pluginId !== entry.registration.plugin) {
              throw new Error('Resource destination is invalid for this provider.');
            }

            if (admitted.uid && !validator) {
              throw new Error('Resource identity cannot be verified.');
            }

            await deps.openResource(admitted, execution.signal, validator ? (data) => validator.call(entry.registration.value, admitted, data) : undefined);
          },
        };
        snapshot = { ...snapshot, executionPending: true };
        emit();
        try {
          if (currentValue.validateAction && !await currentValue.validateAction.call(entry.registration.value, value.action, context)) {
            throw new Error('This action is no longer available.');
          }

          if (execution.signal.aborted || contextErrors.has(entry.registration) || token !== epoch || store?.version !== capturedVersion || !ownerReady(entry.registration.plugin)) {
            return;
          }

          actionAccepted = true;
          const outcome = await currentValue.executeAction.call(entry.registration.value, value.action, context);
          if (!execution.signal.aborted && token === epoch && session === actionSession) {
            if (outcome?.keepOpen) {
              controller.refresh();
            } else {
              controller.close();
            }
          }
        } catch (error) {
          if (!execution.signal.aborted && token === epoch && session === actionSession) {
            feedback = { message: parseAppError(error).detail };
          }
        } finally {
          if (actionExecution === execution) {
            actionExecution = undefined;
            actionAccepted = false;
          }

          if (snapshot.isOpen && deferredLiveRefresh) {
            deferredLiveRefresh = false;
            controller.notifyDataChanged();
          } else if (snapshot.isOpen) {
            publish();
            if (dataRefreshQueued) {
              dataRefreshQueued = false;
              refreshData();
            }
          }
        }

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
