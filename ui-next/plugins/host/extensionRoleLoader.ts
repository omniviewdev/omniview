import type { ReactElement } from 'react';
import { SHARED_V1 } from '../loader/shared';
import type { ExtensionAuthority, ExtensionBinding, ExtensionDemand } from './extensionAuthority';
import type { ExtensionRelated } from './extensionRelated';
import type { ExtensionInput } from './extensionProjection';

type Surface = 'detail-tab' | 'sidebar';
type Role = 'features' | 'views';
type Callable = (...args: never[]) => unknown;
type Feature = (input: ExtensionInput, signal: AbortSignal) => unknown;
export type ExtensionBody = (props: { readonly input: ExtensionInput; readonly related?: ExtensionRelated }) => ReactElement | null;
export const EXTENSION_DEADLINE_MS = 5000;
export const EXTENSION_TIMEOUT = Symbol('extension deadline');
const MAX_BYTES = 1 << 20;
const unavailable = () => new Error('Extension unavailable');

// The ordinary page runtime and its URL/import map are deliberately not part of this linker.
const shared = {
  react: SHARED_V1.react,
  'react/jsx-runtime': SHARED_V1['react/jsx-runtime'],
  'react/compiler-runtime': SHARED_V1['react/compiler-runtime'],
  '@omniviewdev/kit': SHARED_V1['@omniviewdev/kit'],
};
type Specifier = keyof typeof shared;
type Publish = (name: string | Record<string, unknown>, value?: unknown) => unknown;
type Declare = (publish: Publish) => {
  readonly setters?: ReadonlyArray<(module: Record<string, unknown>) => void>;
  readonly execute: () => void;
};
type Registration = { readonly dependencies: readonly Specifier[]; readonly declare: Declare };
type Exports = ReadonlyMap<string, Callable>;

/** Native admission parsed the whole AST: exactly one anonymous register, declarative linking, no follow-on import.
 * ReadExtensionAsset checks these same bytes under the verified pin and Running generation. Never call this on a URL. */
function registration(source: string, role: Role): Registration {
  if (typeof source !== 'string' || !source.length || source.length > MAX_BYTES ||
      (source.length > MAX_BYTES / 3 && new Blob([source]).size > MAX_BYTES)) {
    throw unavailable();
  }

  let captured: Registration | undefined;
  const system = {
    register(dependencies: unknown, declare: unknown) {
      if (captured !== undefined || arguments.length !== 2 || !Array.isArray(dependencies) || dependencies.length > (role === 'views' ? 4 : 0) ||
          !dependencies.every((d: unknown): d is Specifier => typeof d === 'string' && Object.hasOwn(shared, d)) ||
          new Set(dependencies).size !== dependencies.length || typeof declare !== 'function') {
        throw unavailable();
      }

      captured = { dependencies, declare: declare as Declare };
    },
  };
  // Capture the registration lexically instead of installing a global or supplying SystemJS's execution context.
  // This verified contributor still runs as trusted code in the host realm, not in a sandbox.
  new Function('System', `"use strict";\n${source}`)(system);
  if (!captured) {
    throw unavailable();
  }

  return captured;
}

/** Rollup emits both publish('name', fn) and publish({ name: fn }); the first returns fn for an inline initializer. */
function link({ dependencies, declare }: Registration, modules: ReadonlyArray<Record<string, unknown>>, names: readonly string[], check: () => void): Exports {
  const functions = new Map<string, Callable>();
  let publishing = true;
  const add = (name: string, value: unknown) => {
    if (!publishing || typeof value !== 'function' || functions.size >= names.length || functions.has(name)) {
      throw unavailable();
    }

    functions.set(name, value as Callable);
  };

  check();
  const { setters = [], execute } = declare((name, value) => {
    if (typeof name === 'string') {
      add(name, value);
      return value;
    }

    for (const key of Reflect.ownKeys(name)) {
      const entry = Object.getOwnPropertyDescriptor(name, key);
      if (typeof key !== 'string' || !entry?.enumerable || !Object.hasOwn(entry, 'value')) {
        throw unavailable();
      }

      add(key, entry.value);
    }

    return name;
  });
  if (setters.length !== dependencies.length || typeof execute !== 'function') {
    throw unavailable();
  }

  for (const [i, setter] of setters.entries()) {
    check();
    setter(modules[i]);
  }

  check();
  try {
    execute();
  } finally {
    publishing = false;
  }

  check();
  if (names.some(name => !functions.has(name))) {
    throw unavailable();
  }

  return functions;
}

async function readRole(binding: ExtensionBinding, role: Role, names: readonly string[], signal: AbortSignal, check: () => void): Promise<Exports> {
  check();
  // Importing Wails boots its platform transport. A browser-only shell must not boot that runtime to list or restore tabs.
  const { PluginManager } = await import('@omniviewdev/runtime/api');
  check();
  const peer = binding.offer.slice(0, binding.offer.indexOf('/'));
  const read = PluginManager.ReadExtensionAsset(peer, binding.contributorPin, binding.contributorGeneration, role);
  const cancel = () => {
    void read.cancel().catch(() => { /* The lease, not native cancellation, fences the response. */ });
  };

  if (signal.aborted) {
    cancel();
  } else {
    signal.addEventListener('abort', cancel, { once: true });
  }

  let source: string;
  try {
    source = await read;
  } finally {
    signal.removeEventListener('abort', cancel);
  }

  check();
  const entry = registration(source, role);
  check();
  const modules = entry.dependencies.length ? await Promise.all(entry.dependencies.map(async name => shared[name]())) : [];
  return link(entry, modules, names, check);
}

type Current = () => boolean;
type Flight = { readonly users: Set<Current>; readonly stop: AbortController; readonly result: Promise<Exports> };
// Different windows and re-admissions (even the same digest after a disconnect) never share this weak key.
// Cache only code, not a render, selection, invocation or result. The native source owns the lifetime of the key.
const bySource = new WeakMap<readonly string[], Exports | Flight>();

function start(binding: ExtensionBinding, role: Role, names: readonly string[]): Flight {
  const users = new Set<Current>();
  const stop = new AbortController();
  const check = () => {
    if (!stop.signal.aborted) {
      for (const current of users) {
        if (current()) {
          return;
        }
      }
    }

    throw unavailable();
  };

  // Reserve the shared flight before the native call or any peer evaluation can reenter the host.
  const work = Promise.resolve().then(async () => {
    try {
      const functions = await readRole(binding, role, names, stop.signal, check);
      check();
      bySource.set(names, functions);
      return functions;
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      if (bySource.get(names) === flight) {
        bySource.delete(names);
      }
    }
  });
  // The app targets ES2023; only the test project can use Promise.withResolvers.
  // An expired flight stays in the cache, refused to new demands, until its underlying work actually settles.
  const timer = setTimeout(() => {
    stop.abort(EXTENSION_TIMEOUT);
  }, EXTENSION_DEADLINE_MS);
  const stopped = new Promise<never>((_, reject) => {
    stop.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(unavailable());
    }, { once: true });
  });
  const flight: Flight = { users, stop, result: Promise.race([work, stopped]) };
  bySource.set(names, flight);
  return flight;
}

/** The native export list is unique per source lifetime AND role; names, versions and digest strings alone are not keys. */
async function load(authority: ExtensionAuthority, demand: ExtensionDemand, role: Role, signal: AbortSignal): Promise<Callable> {
  const { binding } = demand;
  const current = () => !document.hidden && !signal.aborted && !demand.signal.aborted && authority.current(demand);
  if (!current()) {
    throw unavailable();
  }

  const names = role === 'views' ? binding.viewExports : binding.featureExports;

  const entry = bySource.get(names) ?? start(binding, role, names);
  let functions: Exports;
  if ('users' in entry) {
    const flight = entry;
    flight.users.add(current);
    const abandon = () => {
      if (!flight.users.size && !flight.stop.signal.aborted && bySource.get(names) === flight) {
        // A timed-out transport may ignore abort. Refuse that generation until the original native read settles.
        if (signal.reason !== EXTENSION_TIMEOUT) {
          bySource.delete(names);
        }

        flight.stop.abort(signal.reason);
      }
    };

    let cancel!: () => void;
    const withdrawn = new Promise<never>((_, reject) => {
      cancel = () => {
        flight.users.delete(current);
        // Hand off only an uninterrupted admission. A revoke followed immediately by regrant/Retry cannot adopt its old read.
        if (signal.reason !== EXTENSION_TIMEOUT && authority.point(binding.point).includes(binding)) {
          queueMicrotask(abandon);
        } else {
          abandon();
        }

        reject(unavailable());
      };
    });
    signal.addEventListener('abort', cancel, { once: true });
    try {
      functions = await Promise.race([flight.result, withdrawn]);
    } finally {
      signal.removeEventListener('abort', cancel);
      flight.users.delete(current);
    }
  } else {
    functions = entry;
  }

  const named = functions.get(binding.declaration.id);
  if (!named || !current()) {
    throw unavailable();
  }

  return named;
}

/** A verified sidebar and a ready object outlet can share code; they never share scope or props. */
export async function loadExtensionBody(authority: ExtensionAuthority, demand: ExtensionDemand, surface: Surface): Promise<ExtensionBody> {
  const { binding } = demand;
  if (binding.placement !== surface || binding.declaration.kind !== 'view' ||
      (surface === 'sidebar' && (binding.fields.length > 0 || binding.declaration.requestRead === true || binding.read !== undefined))) {
    throw unavailable();
  }

  return await load(authority, demand, 'views', demand.signal) as ExtensionBody;
}

/** A menu that opens a view has no feature. In particular it must not load the feature role as a side effect. */
export async function loadExtensionFeature(authority: ExtensionAuthority, demand: ExtensionDemand, signal: AbortSignal): Promise<Feature> {
  const { declaration, placement } = demand.binding;
  if (!(declaration.kind === 'section' && placement === 'overview-section') &&
      !(declaration.kind === 'menu' && declaration.action.kind === 'info' && placement === 'context-menu')) {
    throw unavailable();
  }

  return await load(authority, demand, 'features', signal) as Feature;
}
