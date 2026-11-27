import { extensionRootOf, type ExtensionRootV1, type ResourceReference } from '@omniviewdev/runtime/ui/v1';
import { extensionRootProof, subscribeExtensionRoot } from '@omniviewdev/runtime/internal/extensions-v1';
import type { PanelHostV1, ResourceShellRequestV1, TerminalMenuOriginV1 } from '../contract/v1';
import { openResourceShellFeed, type ResourceShellLaunch, type ResourceShellTransport } from '../../shell/panel/terminal/resourceShellFeed';
import type { TerminalFeedHandle } from '../../shell/panel/terminal/feed';
import type { TerminalSessions } from '../../shell/panel/terminal/TerminalSessions';
import type { ConnectionsStore } from './connections/store';
import type { PluginEntry } from './pluginStore';
import type { PluginSource } from './contributions';
import { resourceShellTransport } from './resourceShellTransport';

export type ShellOwner = PluginEntry & { readonly phase: 'ready' };
export type ShellOrigin = Omit<TerminalMenuOriginV1, 'surface'> & {
  readonly entry: ShellOwner;
  readonly current: () => boolean;
  readonly verify: (signal?: AbortSignal) => Promise<boolean>;
  readonly onRetire: (listener: () => void) => () => void;
};
type MenuWitness = { readonly root: ExtensionRootV1; readonly current: () => boolean; readonly verify: (signal: AbortSignal) => Promise<boolean> };
type FeedOrigin = ShellOrigin & { readonly witnessOf: (root: ExtensionRootV1) => MenuWitness | undefined };
export type ResourceShells = {
  readonly handle: (owner: string, connection: string) => NonNullable<PanelHostV1['terminal']> | undefined;
  readonly originOf: (feed: TerminalFeedHandle) => FeedOrigin | undefined;
};
type Dependencies = {
  readonly plugins: PluginSource; readonly connections: Pick<ConnectionsStore, 'getSnapshot' | 'subscribe'>; readonly sessions: TerminalSessions;
  readonly activated: () => boolean | undefined;
  readonly transport?: ResourceShellTransport;
};
const refused = () => new Error('This resource shell is unavailable.');
function sameReference(a: ResourceReference, b: ResourceReference): boolean {
  const left = a.address, right = b.address;
  return a.incarnation === b.incarnation && left.provider === right.provider && left.authority === right.authority &&
    left.type === right.type && left.id === right.id && left.scope.length === right.scope.length &&
    left.scope.every((entry, index) => entry.dimension === right.scope[index].dimension && entry.value === right.scope[index].value);
}

function word(s: unknown): s is string {
  if (typeof s !== 'string' || !s.length || s.length > 256) {
    return false;
  }

  let bytes = 0;
  for (const char of s) {
    const code = char.codePointAt(0)!;
    if (code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) {
      return false;
    }

    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }

  return bytes <= 256;
}

/** Read supplied members exactly once. Never let an accessor change the selected page or proof between checks. */
function members<T>(input: T, allowed: readonly string[]): T {
  if (!input || typeof input !== 'object' || (Object.getPrototypeOf(input) !== null && Object.getPrototypeOf(input) !== Object.prototype)) {
    throw refused();
  }

  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length) {
    throw refused();
  }

  const result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw refused();
    }

    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) {
      throw refused();
    }

    result[key] = d.value;
  }

  return result as T;
}

function fields(input: unknown, maximum: number): Readonly<Record<string, string>> {
  if (input === null || typeof input !== 'object' || (Object.getPrototypeOf(input) !== null && Object.getPrototypeOf(input) !== Object.prototype)) {
    throw refused();
  }

  const output: Record<string, string> = Object.create(null);
  const keys = Reflect.ownKeys(input);
  if (keys.length > maximum) {
    throw refused();
  }

  for (const key of keys) {
    if (typeof key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/u.test(key) || ['connection', 'constructor', 'prototype'].includes(key)) {
      throw refused();
    }

    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value') || !word(d.value)) {
      throw refused();
    }

    output[key] = d.value;
  }

  return Object.freeze(output);
}

/** Per-window private index, by live feed identity. It has no setter for targets, restored records, strings, or plugins. */
export function createResourceShells({ plugins, connections, sessions, activated, transport = resourceShellTransport }: Dependencies): ResourceShells {
  const origins = new WeakMap<TerminalFeedHandle, FeedOrigin>();
  const handles = new WeakMap<ShellOwner, Map<string, NonNullable<PanelHostV1['terminal']>>>();
  const ownerOf = (id: string) => plugins.getSnapshot().find(entry => entry.id === id);
  function connected(entry: ShellOwner, connection: string) {
    const state = connections.getSnapshot();
    if (!state.loaded || state.failed || ownerOf(entry.id) !== entry) {
      return false;
    }

    let found = false;
    for (const row of state.connections) {
      if (row.plugin !== entry.id || row.key !== connection) {
        continue;
      }

      if (found || row.state !== 'connected' || row.busy !== undefined) {
        return false;
      }

      found = true;
    }

    return found;
  }

  async function open(entry: ShellOwner, connection: string, request: ResourceShellRequestV1) {
    if (activated() !== true || !connected(entry, connection) || document.hidden) {
      throw refused();
    }

    const saved = members(request, ['record', 'route', 'params']);
    const { record } = saved, route = members(saved.route, ['page', 'params']);
    if (!word(route.page) || !Object.hasOwn(entry.contribution.pages, route.page) || entry.contribution.pages[route.page]?.kind !== 'detail') {
      throw refused();
    }

    const locator = Object.freeze({ page: route.page, params: fields(route.params, 24) });
    const { params: suppliedParams = {} } = saved;
    const params = fields(suppliedParams, 8);
    for (const key of Object.keys(params)) {
      if (params[key] !== locator.params[key]) {
        throw refused();
      }
    }

    const root = extensionRootOf(record);
    const proof = root && extensionRootProof(root);
    const scope = proof?.reference.incarnation;
    if (!root || proof?.owner !== entry.id || proof.connection !== connection || !word(scope)) {
      throw refused();
    }

    // Never serialize the locator, extension contract, record body or provider argv. Only the native proof and producer selectors go to exec.
    const id = crypto.randomUUID();
    const encoded = JSON.stringify({ id, root: proof, params });
    const pending: { launch?: ResourceShellLaunch } = {};
    let lost = false;
    const keep = () => !lost && connected(entry, connection) && extensionRootProof(root) === proof;
    const failIfStale = () => {
      if (!lost && !keep()) {
        lost = true; void Promise.resolve(pending.launch?.feed.close()).catch(() => undefined);
      }
    };

    const off = [plugins.subscribe(failIfStale), connections.subscribe(failIfStale), subscribeExtensionRoot(root, failIfStale)];
    try {
      if (!keep() || document.hidden) {
        throw refused();
      }

      // The panel allocates its own ID. A new launch must never acquire a restored tab or disclose the native session ID.
      const opened = sessions.open({ plugin: entry.id, id: 'resource-shell', title: proof.reference.address.id,
        open: () => {
          pending.launch = openResourceShellFeed(transport, entry.id, id, encoded); return pending.launch.feed;
        } }, { focus: true });
      if (!opened || !pending.launch) {
        throw refused();
      }

      const { feed, ready, verify } = pending.launch;
      await ready;
      if (!keep() || feed.getSnapshot().state !== 'running' || sessions.feedOf(opened.id) !== feed) {
        await feed.close(); throw refused();
      }

      let live = true;
      const watchers = new Set<() => void>();
      const current = () => live && connected(entry, connection) && sessions.feedOf(opened.id) === feed && feed.getSnapshot().state === 'running';
      const onRetire = (listener: () => void) => {
        watchers.add(listener); return () => {
          watchers.delete(listener);
        };
      };

      // The launch view can be gone. Match the current owner's independently issued witness by full native identity.
      const witnessOf = (root: ExtensionRootV1): MenuWitness | undefined => {
        const shown = extensionRootProof(root);
        if (!shown || !current() || shown.owner !== entry.id || shown.connection !== connection || !sameReference(shown.reference, proof.reference)) {
          return undefined;
        }

        const sameRow = () => extensionRootProof(root) === shown;
        let encodedRoot: string | undefined;
        return { root, current: sameRow, verify: async signal => sameRow() && await verify(signal, encodedRoot ??= JSON.stringify(shown)) && sameRow() };
      };

      origins.set(feed, Object.freeze({ entry, route: locator, connection, extensionScopeKey: scope, current, verify, onRetire, witnessOf }));
      // A lost origin cannot reappear after a reconnect; only the producer/registry ends a shell. A grant or check never clears a transcript.
      function withdraw() {
        live = false; origins.delete(feed);
        for (const stop of stops.splice(0)) {
          stop();
        }

        for (const listener of watchers) {
          listener();
        }

        watchers.clear();
      }

      const check = () => {
        if (!current()) {
          withdraw();
        }
      };

      const stops = [plugins.subscribe(check), connections.subscribe(check), sessions.subscribeFeeds(check),
        feed.subscribe(() => {
          if (feed.getSnapshot().state !== 'running') {
            withdraw();
          }
        })];
      check();
    } finally {
      for (const stop of off) {
        stop();
      }
    }
  }

  return { originOf: feed => origins.get(feed), handle(id, connection) {
    const entry = ownerOf(id);
    if (entry?.phase !== 'ready' || !connection) {
      return undefined;
    }

    let byScope = handles.get(entry);
    if (!byScope) {
      handles.set(entry, byScope = new Map());
    }

    let handle = byScope.get(connection);
    if (!handle) {
      handle = Object.freeze({ open: async (request: ResourceShellRequestV1) => open(entry, connection, request) }); byScope.set(connection, handle);
    }

    return handle;
  } };
}
