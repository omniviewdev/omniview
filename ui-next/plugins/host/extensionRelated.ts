import { Call } from '@omniviewdev/runtime/runtime';
import { extensionRootProof, subscribeExtensionRoot } from '@omniviewdev/runtime/internal/extensions-v1';
import type { ExtensionRootV1 } from '@omniviewdev/runtime/ui/v1';
import { useState, useSyncExternalStore } from 'react';
import type { ExtensionAuthority, ExtensionDemand } from './extensionAuthority';
import type { ExtensionFields } from './extensionContract';
import type { ExtensionInput } from './extensionProjection';
import { weigh } from './portSize';

/** These are display data only. Neither an address, a query nor a native proof is a Body prop. */
export type ExtensionRelated = { readonly state: 'unavailable' | 'loading' | 'failed' } | {
  readonly state: 'ready'; readonly coverage: 'partial' | 'complete'; readonly truncated: boolean; readonly rows: readonly ExtensionInput[];
};

type Snapshot = { readonly revision: number; readonly related: ExtensionRelated };
const loading = Object.freeze({ state: 'loading' } as const);
const failed = Object.freeze({ state: 'failed' } as const);
const unavailable = Object.freeze({ state: 'unavailable' } as const);
const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.ExtensionReadService.ReadRelatedV1';
const stalled = new WeakMap<ExtensionAuthority, { generation: string; owner: string }>();
const unsubscribeNone = () => undefined;

function property(raw: Record<string, unknown> | readonly unknown[], name: string): unknown {
  const d = Object.getOwnPropertyDescriptor(raw, name);
  return d?.enumerable && Object.hasOwn(d, 'value') ? d.value : undefined;
}

function plain(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) &&
    (Object.getPrototypeOf(raw) === null || Object.getPrototypeOf(raw) === Object.prototype);
}

/** Validate the native response against the admitted row, not the component's TypeScript annotation. */
function relatedResult(raw: unknown, fields: ExtensionFields): ExtensionRelated {
  if (!plain(raw)) {
    return failed;
  }

  const state = property(raw, 'state');
  if (state === 'unavailable' && Reflect.ownKeys(raw).length === 1) {
    return unavailable;
  }

  if (state !== 'ready' || Reflect.ownKeys(raw).length !== 2) {
    return failed;
  }

  const page = property(raw, 'page');
  if (!plain(page) || Reflect.ownKeys(page).length !== 3) {
    return failed;
  }

  const coverage = property(page, 'coverage'), truncated = property(page, 'truncated'), list = property(page, 'rows');
  if ((coverage !== 'complete' && coverage !== 'partial') || typeof truncated !== 'boolean' || !Array.isArray(list) ||
      list.length > 128 || Reflect.ownKeys(list).length !== list.length + 1) {
    return failed;
  }

  const keys = Object.keys(fields);
  const rows: ExtensionInput[] = [];
  let remaining = 64 * 1024 - `{"state":"ready","rows":[],"coverage":"${coverage}","truncated":${truncated}}`.length;
  for (let i = 0; i < list.length; i++) {
    const row = property(list, String(i));
    if (!plain(row) || Reflect.ownKeys(row).length !== keys.length) {
      return failed;
    }

    const output: Record<string, string | number> = Object.create(null);
    for (const key of keys) {
      const value = property(row, key);
      if (typeof value === 'string' && fields[key] === 'string' && value.length <= 4096) {
        output[key] = value;
      } else if (typeof value === 'number' && fields[key] === 'number' && Number.isFinite(value)) {
        output[key] = value === 0 ? 0 : value;
      } else {
        return failed;
      }
    }

    if (i > 0) {
      remaining--;
    }

    const bytes = weigh(output, remaining, 4096);
    if (typeof bytes !== 'number') {
      return failed;
    }

    remaining -= bytes;
    rows.push(Object.freeze(output));
  }

  return Object.freeze({ state: 'ready', rows: Object.freeze(rows), coverage, truncated });
}

/** One selected visit. A cancelled view never donates a cached answer or failure to another visit. */
class SelectedRead {
  private value: Snapshot;
  private readonly withdrawn: Snapshot;

  constructor(
    readonly authority: ExtensionAuthority,
    readonly demand: ExtensionDemand,
    readonly root: ExtensionRootV1 | undefined,
    readonly revision: number,
  ) {
    this.value = { revision, related: loading };
    this.withdrawn = { revision: revision + 1, related: unavailable };
  }

  // React rechecks the external store before commit. A stale value cannot get one last paint while an effect catches up.
  snapshot = (): Snapshot => this.access() ? this.value : this.withdrawn;

  subscribe = (notify: () => void): (() => void) => {
    const original = this.access();
    if (!original || !this.root) {
      return unsubscribeNone;
    }

    const { authority, demand, revision } = this;
    const b = demand.binding;
    let live = true, cancel: (() => void) | undefined, timer: number | undefined;
    const current = () => {
      const now = live && this.access();
      return now && now.proof === original.proof && now.scope.continuity === original.scope.continuity && now.scope.subject === original.scope.subject;
    };

    const clear = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };

    const retire = () => {
      live = false;
      clear();
      cancel?.();
      cancel = undefined;
      this.value = this.withdrawn;
      notify();
    };

    demand.signal.addEventListener('abort', retire, { once: true });
    const unsubscribe = subscribeExtensionRoot(this.root, retire);
    // Do not dispatch for a render that never committed, or a StrictMode subscription immediately released on the same turn.
    queueMicrotask(() => {
      if (!current()) {
        return;
      }

      const held = stalled.get(authority);
      if (held?.owner === original.proof.owner && held.generation === b.ownerGeneration) {
        this.value = { revision, related: unavailable };
        notify();
        return;
      }

      const binding = { point: b.point, offer: b.offer, ownerPin: b.ownerPin, ownerGeneration: b.ownerGeneration,
        contributorPin: b.contributorPin, contributorGeneration: b.contributorGeneration, read: original.read, continuity: original.scope.continuity };
      const generation = { owner: original.proof.owner, generation: b.ownerGeneration };
      let expired = false;
      try {
        const request = { binding, root: original.proof };
        if (typeof weigh(request, 16 * 1024) !== 'number' || !current()) {
          this.value = this.withdrawn;
          notify();
          return;
        }

        const call = Call.ByName(service, JSON.stringify(request));
        cancel = () => {
          void call.cancel().catch(() => { /* Lost transport already withdrew the lease. */ });
        };

        if (!current()) {
          cancel();
        }

        timer = window.setTimeout(() => {
          if (!current()) {
            return;
          }

          expired = true;
          stalled.set(authority, generation);
          this.value = { revision, related: failed };
          cancel?.();
          notify();
        }, 5000);
        const publish = (value: unknown) => {
          clear();
          if (stalled.get(authority) === generation) {
            stalled.delete(authority);
          }

          cancel = undefined;
          if (expired || !current()) {
            return;
          }

          let related: ExtensionRelated;
          try {
            related = relatedResult(value, original.fields);
          } catch {
            related = failed;
          }

          if (!current()) {
            return;
          }

          this.value = { revision, related };
          notify();
        };

        void call.then(publish, () => {
          publish(undefined);
        });
      } catch {
        if (current()) {
          this.value = { revision, related: failed };
          notify();
        }
      }
    });
    return () => {
      live = false;
      clear();
      cancel?.();
      unsubscribe();
      demand.signal.removeEventListener('abort', retire);
    };
  };

  private access() {
    const { binding } = this.demand;
    const scope = !document.hidden && !this.demand.signal.aborted && this.authority.readScope(this.demand);
    if (!scope || !this.root) {
      return undefined;
    }

    const proof = extensionRootProof(this.root);
    if (proof?.owner !== binding.point.slice(0, binding.point.indexOf('/')) || proof.connection !== scope.connection ||
        proof.reference.incarnation !== scope.scopeKey || binding.declaration.kind !== 'view' || !binding.declaration.requestRead ||
        !binding.declaration.read || !binding.read) {
      return undefined;
    }

    return { proof, scope, fields: binding.declaration.read.row, read: binding.read };
  }
}

export function useExtensionRelated(authority: ExtensionAuthority, demand: ExtensionDemand, root: ExtensionRootV1 | undefined): Snapshot {
  const [previous, setVisit] = useState(() => new SelectedRead(authority, demand, root, 0));
  let visit = previous;
  if (previous.authority !== authority || previous.demand !== demand || previous.root !== root) {
    visit = new SelectedRead(authority, demand, root, previous.revision + 2);
    setVisit(visit);
  }

  return useSyncExternalStore(visit.subscribe, visit.snapshot, visit.snapshot);
}
