import type { ScopeSession } from './session';
import { pluginPageId } from './target';
import type { SettingsClient } from './types';

export type PluginPage = {
  readonly id: string;
  readonly pluginId: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly session: ScopeSession;
};

export type PluginInventory = { readonly phase: 'loading' | 'ready' | 'failed'; readonly entries: readonly PluginPage[] };
export type SettingsPlugins = {
  readonly getSnapshot: () => PluginInventory;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
};

type ActiveScope = ScopeSession & { readonly changed: () => void };

/** Each installed plugin has its own schema, drafts and transactions. Never manufacture a page from a manifest. */
export function createPluginPages(read: SettingsClient['inventory'], create: (pluginId: string) => ActiveScope) {
  const scopes = new Map<string, ActiveScope>();
  const listeners = new Set<() => void>();
  let snapshot: PluginInventory = { phase: 'loading', entries: [] };
  let generation = 0;
  let disposed = false;

  const publish = (next: PluginInventory): void => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  // The compiled navigation memoizes entries. A phase or schema change invalidates that list; editing a value does not.
  const schemaChanged = (): void => {
    publish({ ...snapshot, entries: [...snapshot.entries] });
  };

  const refresh = (): void => {
    if (disposed) {
      return;
    }

    const mine = ++generation;
    if (snapshot.phase === 'failed') {
      publish({ ...snapshot, phase: 'loading' });
      if (disposed || mine !== generation) {
        return;
      }
    }

    void read().then((inventory) => {
      if (disposed || mine !== generation) {
        return;
      }

      const installed = new Map<string, (typeof inventory)[number]>();
      for (const plugin of inventory) {
        if (plugin.id !== '') {
          installed.set(plugin.id, plugin);
        }
      }

      for (const [id, session] of scopes) {
        if (installed.has(id)) {
          continue;
        }

        scopes.delete(id);
        session.dispose();
      }

      const entries: PluginPage[] = [];
      for (const { id, name, description, icon } of installed.values()) {
        let session = scopes.get(id);
        if (session) {
          session.changed(); // A reload can replace the settings schema without changing the manifest.
        } else {
          session = create(id);
          scopes.set(id, session);
          session.subscribe(schemaChanged);
          session.load();
        }

        // A synchronous subscriber can close Settings or start a newer inventory refresh.
        if (disposed || mine !== generation) {
          return;
        }

        entries.push({ id: pluginPageId(id), pluginId: id, title: name.trim() || id, description, icon, session });
      }

      entries.sort((a, b) => a.title.localeCompare(b.title, 'en') || a.pluginId.localeCompare(b.pluginId, 'en'));
      if (snapshot.phase !== 'ready' || entries.length !== snapshot.entries.length || entries.some((entry, index) => {
        const previous = snapshot.entries[index];
        return entry.session !== previous.session || entry.title !== previous.title || entry.description !== previous.description || entry.icon !== previous.icon;
      })) {
        publish({ phase: 'ready', entries });
      }
    }, () => {
      if (!disposed && mine === generation) {
        publish({ ...snapshot, phase: 'failed' });
      }
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    changed: (pluginId: string) => scopes.get(pluginId)?.changed(),
    dispose: () => {
      disposed = true;
      for (const session of scopes.values()) {
        session.dispose();
      }

      scopes.clear();
      listeners.clear();
    },
  };
}
