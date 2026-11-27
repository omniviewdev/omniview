import type { ExtensionAuthority, ExtensionSource } from './extensionAuthority';
import type { InstalledPlugin } from './inventory';
import type { PluginStore } from './pluginStore';
import { STATE_CHANGE_EVENT, UNLOADED_EVENT, type EventSource } from './lifecycle';

type Policy = Parameters<ExtensionAuthority['replacePolicy']>[0];
type Listed = InstalledPlugin & { readonly extension?: Omit<ExtensionSource, 'id' | 'ordinaryReady'> | null; readonly extensionRefused?: boolean };
export const inventoryEvents = ['plugin/init_complete', 'plugin/inventory_changed', 'plugin/install_finished', 'plugin/update_complete', 'plugin/enablement_changed'] as const;

type ChangedPair = { readonly point: string; readonly offer: string; readonly fields?: readonly string[]; readonly readOnly?: true };
type LinkedChange = { readonly revision: string; readonly affected: readonly ChangedPair[] };

function linkedChange(value: unknown, previous: string | undefined): value is LinkedChange {
  if (!previous || !value || typeof value !== 'object' || !('previous' in value) || value.previous !== previous ||
      !('revision' in value) || typeof value.revision !== 'string' || !value.revision ||
      !('affected' in value) || !Array.isArray(value.affected) || value.affected.length > 2048) {
    return false;
  }

  return value.affected.every((pair: unknown) => {
    if (!pair || typeof pair !== 'object' || !('point' in pair) || typeof pair.point !== 'string' ||
        !('offer' in pair) || typeof pair.offer !== 'string') {
      return false;
    }

    if ('readOnly' in pair) {
      return pair.readOnly === true && !('fields' in pair);
    }

    return !('fields' in pair) || (Array.isArray(pair.fields) && pair.fields.length <= 128 &&
      pair.fields.every((field: unknown) => typeof field === 'string'));
  });
}

/** One instance per mounted window. Never accept query-cache data as proof of a live generation. */
export class ExtensionWindow {
  private epoch = 0;
  private live = false;
  private admitted = new Map<string, string>();

  constructor(private readonly authority: ExtensionAuthority, private readonly pages: PluginStore) {}

  async inventory<T extends Listed>(list: () => Promise<readonly T[]>): Promise<readonly T[]> {
    const epoch = this.epoch;
    const subscribed = this.live;
    let rows: readonly T[];
    try {
      rows = await list(); 
    } catch (error) {
      if (epoch === this.epoch) {
        this.authority.clearSources();
      }

      throw error;
    }

    if (!subscribed || !this.live) {
      return rows;
    }

    if (epoch !== this.epoch) {
      throw new Error('Plugin inventory changed during read');
    }

    const ready = this.readyPages();
    const sources: ExtensionSource[] = [];
    const owners = new Map<string, string>();
    for (const row of rows) {
      if (!row.extension || row.extensionRefused === true || row.phase !== 'Running' || !row.enabled || row.origin === 'builtin' || row.incompatible != null) {
        continue;
      }

      const owner = row.hasPage === true && !!row.extension.pageDigest;
      if (owner) {
        owners.set(row.id, row.extension.generation);
      }

      sources.push({ ...row.extension, id: row.id, ordinaryReady: owner && ready.get(row.id) === row.extension.generation });
    }

    this.admitted = owners;
    // Ordinary page discovery never waits for extension metadata hashing.
    void this.authority.replaceSources(sources).catch(() => {
      if (epoch === this.epoch) {
        this.authority.clearSources();
      } 
    });
    return rows;
  }

  listen(events: EventSource, readPolicy: () => Promise<Policy>, refresh: () => void, transport: (fn: (connected: boolean) => void) => () => void): () => void {
    this.live = false;
    let policyRevision = 0;
    let previousRevision: string | undefined;
    let queued = false;
    const stops: Array<() => void> = [];
    const schedule = () => {
      if (queued) {
        return;
      }

      queued = true;
      queueMicrotask(() => {
        if (queued) {
          refresh();
        }

        queued = false; 
      });
    };

    const invalidate = (data?: unknown) => {
      this.epoch++;
      const id = data && typeof data === 'object'
        ? 'pluginID' in data ? data.pluginID : 'id' in data ? data.id : undefined
        : undefined;
      if (typeof id === 'string' && id) {
        this.authority.retireSource(id);
      } else {
        this.authority.clearSources();
      }

      schedule();
    };

    const policy = (change?: unknown) => {
      if (!this.live) {
        return;
      }

      const revision = ++policyRevision;
      if (linkedChange(change, previousRevision)) {
        this.authority.retireGrants(change.affected, change.revision);
      } else {
        this.authority.clearPolicy();
      }

      previousRevision = undefined;
      void readPolicy().then(snapshot => {
        if (this.live && revision === policyRevision) {
          this.authority.replacePolicy(snapshot);
          previousRevision = snapshot.known ? snapshot.revision : undefined;
        }
      }, () => {
        if (this.live && revision === policyRevision) {
          this.authority.clearPolicy();
        } 
      });
    };

    const stop = () => {
      this.live = false; this.epoch++; policyRevision++; queued = false;
      this.admitted.clear(); this.authority.clearSources(); this.authority.clearPolicy();
      for (const unsubscribe of stops) {
        unsubscribe();
      }
    };

    try {
      for (const event of [...inventoryEvents, STATE_CHANGE_EVENT, UNLOADED_EVENT]) {
        stops.push(events.On(event, ({ data }) => {
          invalidate(data); 
        }));
      }

      stops.push(events.On('ui-extensions:policy-invalidated', ({ data }) => {
        policy(data); 
      }));
      let initialTransport = true;
      stops.push(transport(connected => {
        this.live = connected;
        if (!initialTransport) {
          invalidate();
        }

        initialTransport = false;
        if (connected) {
          policy();
        } else {
          policyRevision++; previousRevision = undefined; this.authority.clearPolicy(); 
        }
      }));
      stops.push(this.pages.subscribe(() => {
        if (!this.admitted.size) {
          return;
        }

        const ready = this.readyPages();
        for (const [id, generation] of this.admitted) {
          this.authority.setOrdinaryReady(id, ready.get(id) === generation);
        }
      }));
    } catch {
      stop(); 
    }

    return stop;
  }

  private readyPages(): Map<string, string> {
    const ready = new Map<string, string>();
    for (const page of this.pages.getSnapshot()) {
      if (page.phase === 'ready' && page.artifact) {
        ready.set(page.id, page.artifact.generation);
      }
    }

    return ready;
  }
}
