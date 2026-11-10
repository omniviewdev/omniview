/**
 * Host services every screen reaches, answered with their real protocols.
 *
 * - Plugin data store (backend/pkg/plugin/data/controller.go): `Get`, `Set`, `Delete`, `Keys`,
 *   `GetSnapshot` and `CompareAndSwap`. The runtime's `usePluginData` updates with a snapshot and
 *   a compare-and-swap; the Kubernetes cluster route records recent access that way. An unhandled
 *   `GetSnapshot` resolves to `null`, `snapshot.value` throws, and the route reports
 *   "Cluster opened, but recent history could not be saved." Values are stored as JSON text and
 *   a revision is a hash of that text, so a revision is equal exactly when the stored bytes are:
 *   a missing key has the empty revision and swaps only against the empty revision. (The host's
 *   revision is SHA-256 hex; consumers treat it as an opaque token, and the Web Crypto API is not
 *   available in every context, so this uses a 53-bit string hash.)
 * - Window service (backend/window/service.go): per-window state slots (`GetState`, `SaveState`,
 *   `ListStates`), the live window list and `ReportViewport`. State lives in the page, so every
 *   page load starts empty, as a first launch does.
 * - Host profiling status: the footer polls it every few seconds. Profiling is off.
 *
 * Nothing is persisted and there is one window, `main`.
 */
import { handleAll } from '../harness/backend';

export interface HostFixture {
  /** Stored keys of a plugin's data store. */
  pluginDataKeys(pluginID: string): string[];
  /** Window state slots by window name, a copy. */
  windowState(): Record<string, Record<string, string>>;
  /** Viewport sizes reported by windows, a copy. */
  viewports(): Record<string, { width: number; height: number }>;
  /** Calls the shell made, by method name. */
  calls(): Record<string, number>;
}

/** cyrb53: a 53-bit string hash, hex encoded. Equal text, equal revision. */
function revisionOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function installHostFixtures(windowName = 'main'): HostFixture {
  const data = new Map<string, Map<string, string>>();
  const windows = new Map<string, Record<string, string>>([[windowName, {}]]);
  const viewports = new Map<string, { width: number; height: number }>();
  const callCounts: Record<string, number> = {};
  const counted = <A extends unknown[], R>(name: string, fn: (...args: A) => R) => (...args: A): R => {
    callCounts[name] = (callCounts[name] ?? 0) + 1;
    return fn(...args);
  };
  const raw = (pluginID: string, key: string): string | undefined => data.get(pluginID)?.get(key);
  const write = (pluginID: string, key: string, value: unknown) => {
    // A stored value is JSON text, so what is read back is a fresh decode, never the caller's object.
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) throw new Error('value is not JSON-serializable');
    let store = data.get(pluginID);
    if (!store) data.set(pluginID, (store = new Map()));
    store.set(key, text);
  };

  handleAll({
    'plugin/data/servicewrapper.Get': counted('data.Get', (pluginID: string, key: string) => {
      const text = raw(pluginID, key);
      return text === undefined ? null : JSON.parse(text);
    }),
    'plugin/data/servicewrapper.GetSnapshot': counted('data.GetSnapshot', (pluginID: string, key: string) => {
      const text = raw(pluginID, key);
      return text === undefined ? { value: null, revision: '' } : { value: JSON.parse(text), revision: revisionOf(text) };
    }),
    'plugin/data/servicewrapper.Set': counted('data.Set', (pluginID: string, key: string, value: unknown) => {
      write(pluginID, key, value);
    }),
    'plugin/data/servicewrapper.CompareAndSwap': counted('data.CompareAndSwap', (pluginID: string, key: string, expected: string, value: unknown) => {
      const text = raw(pluginID, key);
      if (text === undefined ? expected !== '' : expected !== revisionOf(text)) return false;
      write(pluginID, key, value);
      return true;
    }),
    'plugin/data/servicewrapper.Delete': counted('data.Delete', (pluginID: string, key: string) => {
      data.get(pluginID)?.delete(key);
    }),
    'plugin/data/servicewrapper.Keys': counted('data.Keys', (pluginID: string) => [...(data.get(pluginID)?.keys() ?? [])].sort()),

    'window/service.List': counted('window.List', () => [...windows.keys()].map((name) => ({ name, kind: 'workspace' }))),
    'window/service.GetState': counted('window.GetState', (name: string) => ({ ...(windows.get(name) ?? {}) })),
    'window/service.SaveState': counted('window.SaveState', (name: string, slot: string, stateJSON: string) => {
      const slots = windows.get(name);
      if (slots) slots[slot] = stateJSON;
    }),
    'window/service.ListStates': counted('window.ListStates', () =>
      Object.fromEntries([...windows].map(([name, slots]) => [name, { ...slots }]))),
    // The host ignores reports from windows it does not know.
    'window/service.ReportViewport': counted('window.ReportViewport', (name: string, width: number, height: number) => {
      if (windows.has(name)) viewports.set(name, { width, height });
    }),

    'profiling/servicewrapper.GetStatus': counted('profiling.GetStatus', () => ({ running: false, url: '', source: '', error: '' })),
  });

  return {
    pluginDataKeys: (pluginID) => [...(data.get(pluginID)?.keys() ?? [])].sort(),
    windowState: () => Object.fromEntries([...windows].map(([name, slots]) => [name, { ...slots }])),
    viewports: () => Object.fromEntries(viewports),
    calls: () => ({ ...callCounts }),
  };
}
