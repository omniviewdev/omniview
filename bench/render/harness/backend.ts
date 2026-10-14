/**
 * Fake Wails backend. Installs a custom runtime transport so the real generated
 * bindings and `Events` API run unchanged, while calls are answered by fixture
 * handlers registered by name (suffix of "<package path>.<Method>").
 */
import { setTransport, objectNames } from '@wailsio/runtime';
import bindingIndex from 'virtual:wails-binding-index';

type Handler = (...args: any[]) => unknown;

const handlers = new Map<string, Handler>();
const resolvedByID = new Map<number, Handler | null>();
const unhandled = new Set<string>();

/**
 * Register a handler for a binding method. `name` matches the end of the
 * binding path, e.g. "resource/servicewrapper.List" or "logs/servicewrapper.CreateSession".
 */
export function handle(name: string, fn: Handler): void {
  handlers.set(name, fn);
  resolvedByID.clear();
}

export function handleAll(map: Record<string, Handler>): void {
  for (const [name, fn] of Object.entries(map)) handle(name, fn);
}

function lookup(methodID: number): Handler | null {
  if (resolvedByID.has(methodID)) return resolvedByID.get(methodID)!;
  const name = (bindingIndex as Record<string, string>)[methodID];
  let found: Handler | null = null;
  if (name) {
    for (const [suffix, fn] of handlers) {
      if (name === suffix || name.endsWith('/' + suffix)) { found = fn; break; }
    }
    if (!found && !unhandled.has(name)) {
      unhandled.add(name);
      if (import.meta.env.BENCH_VERBOSE) console.debug('[fake-backend] unhandled call', name);
    }
  }
  resolvedByID.set(methodID, found);
  return found;
}

/** Binding methods that were called without a handler (answered with null). */
export function unhandledCalls(): string[] {
  return [...unhandled].sort();
}

/** Deliver a backend event to frontend `Events.On` listeners. */
export function emit(name: string, data: unknown): void {
  (window as any)._wails.dispatchWailsEvent({ name, data });
}

export function installFakeBackend(): void {
  setTransport({
    call: async (objectID: number, method: number, _windowName: string, args: any) => {
      if (objectID === objectNames.Call && args && typeof args.methodID === 'number') {
        const fn = lookup(args.methodID);
        return fn ? await fn(...(args.args ?? [])) : null;
      }
      // Window, Browser, Clipboard, Events.Emit, CancelCall …: no-ops.
      if (objectID === objectNames.Window && typeof method === 'number') return false;
      return null;
    },
  });
}
