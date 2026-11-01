/**
 * In-page fake Wails backend for the bench/app profiling build. Imported before
 * anything else in ui/main.tsx (see bench/app/vite.config.ts), so it is in
 * place before the first binding call. Reuses the render-bench transport and
 * fixtures (bench/render), and exposes controls on `window.__ovBench` for the
 * Playwright scenarios.
 *
 * The page reads its starting state from `window.__OV_BENCH__`, which the spec
 * sets with `addInitScript` before navigation.
 */
import { getTransport, setTransport, objectNames } from '@wailsio/runtime';
import bindingIndex from 'virtual:wails-binding-index';
import { bindingName, installFakeBackend, handle, handleAll, emit, unhandledCalls } from '../../render/harness/backend';
import { installDefaultFixtures, BENCH_CONNECTION_ID } from '../../render/fixtures/defaults';
import { makePods, servePods } from '../../render/fixtures/kubernetes';
import { makeLogLines, makeLogSession, streamLines, type BenchLogSession } from '../../render/fixtures/logs';
import { findByText, findScrollable, nextFrame, waitFor } from '../../render/harness/dom';
import kubernetesPlugin from 'virtual:bench-kubernetes-plugin';

export interface BenchConfig {
  /** Plugin ids reported as installed; their UI bundles are loaded from /_/plugins/<id>/assets. */
  plugins?: string[];
  /** Pods returned by the kubernetes List call. */
  pods?: number;
}

export interface StartupTimings {
  ui_main_start_ms: number;
  ui_committed_ms: number;
  ui_ready_ms: number;
}

const config: BenchConfig = (window as any).__OV_BENCH__ ?? {};
const pluginMeta: Record<string, any> = { kubernetes: kubernetesPlugin };

installFakeBackend();
installDefaultFixtures();

// Count binding calls by name, so a scenario can report what the app asked the backend for.
const callCounts: Record<string, number> = {};
const inner = getTransport()!;
// NameMethod in the pinned @wailsio/runtime Window API.
const WINDOW_NAME_METHOD = 18;
setTransport({
  call: (objectID: number, method: number, windowName: string, args: any) => {
    if (objectID === objectNames.Window && method === WINDOW_NAME_METHOD) {
      return Promise.resolve('main');
    }
    if (objectID === objectNames.Call && (typeof args?.methodID === 'number' || typeof args?.methodName === 'string')) {
      const name = typeof args.methodName === 'string' ? bindingName(args.methodName) : (bindingIndex as Record<string, string>)[args.methodID] ?? String(args.methodID);
      callCounts[name] = (callCounts[name] ?? 0) + 1;
    }
    return inner.call(objectID, method, windowName, args);
  },
});

const plugins = (config.plugins ?? []).map((id) => ({
  id,
  metadata: pluginMeta[id] ?? { id, name: id, version: '0.0.0-bench' },
  phase: 'Running',
  enabled: true,
  devMode: false,
  capabilities: pluginMeta[id]?.capabilities ?? ['ui'],
}));

let startup: StartupTimings | null = null;
const startupWaiters: Array<(t: StartupTimings) => void> = [];

const connection = {
  id: BENCH_CONNECTION_ID,
  uid: BENCH_CONNECTION_ID,
  name: 'bench',
  description: '',
  avatar: '',
  labels: {},
  data: {},
  last_refresh: new Date().toISOString(),
};

/** Resource types the fixtures serve; all report as synced so no sync modal opens. */
const POD_KEY = 'k8s:/pods';
const SYNCED = 2; // WatchState.WatchStateSynced

handleAll({
  'window/service.List': () => [{ name: 'main', kind: 'workspace' }],
  'window/service.GetState': () => ({}),
  'window/service.SaveState': () => null,
  'resource/servicewrapper.GetConnection': () => connection,
  'resource/servicewrapper.GetResourceGroups': () => [
    { id: 'workloads', name: 'Workloads', description: '', icon: '', resources: [POD_KEY] },
  ],
  'resource/servicewrapper.GetWatchState': () => ({
    connectionId: BENCH_CONNECTION_ID,
    resources: { [POD_KEY]: SYNCED },
    resourceCounts: { [POD_KEY]: { kind: 'exact', value: String(config.pods ?? 0) } },
  }),
  'resource/servicewrapper.GetEditorSchemas': () => [],
  'resource/servicewrapper.SubscribeResource': () => null,
  'resource/servicewrapper.GetAllConnectionStates': () => ({}),
  // Startup calls with nothing to report (empty state dir).
  'diagnostics/diagnosticsclient.Log': () => null,
  'plugin/data/servicewrapper.Get': () => null,
  'devserver/servicewrapper.ListDevServerStates': () => [],
  'exec/servicewrapper.ListSessions': () => [],
  'networker/servicewrapper.ListAllPortForwardSessions': () => [],
  'plugin/servicewrapper.ListPlugins': () => plugins,
  'plugin/servicewrapper.GetPlugin': (id: string) => plugins.find((p) => p.id === id) ?? null,
  'plugin/servicewrapper.GetPluginMeta': (id: string) => pluginMeta[id] ?? { id, name: id, version: '0.0.0-bench' },
  'plugin/servicewrapper.ListAvailablePlugins': () => [],
  'resource/servicewrapper.ListConnections': () => [{ id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }],
  'resource/servicewrapper.ListAllConnections': () =>
    Object.fromEntries(plugins.map((p) => [p.id, [{ id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }]])),
  'resource/servicewrapper.StartConnection': () => ({ connection: { id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }, status: 'CONNECTED' }),
  // The startup marker the cold-start script also uses (ui/features/perf/startup.ts).
  'diagnostics/diagnosticsclient.ReportStartupReady': (t: StartupTimings) => {
    startup = t;
    startupWaiters.splice(0).forEach((fn) => fn(t));
  },
});

if (config.pods) servePods(makePods(config.pods));

const logSessions: string[] = [];
const sessions = new Map<string, BenchLogSession>();
handleAll({
  'logs/servicewrapper.CreateSession': (plugin: string, connection: string, encoded: string) => {
    const id = `bench-log-${logSessions.length}`;
    const session = makeLogSession(id, plugin, connection, encoded);
    logSessions.push(id);
    sessions.set(id, session);
    return session;
  },
  'logs/servicewrapper.GetSession': (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown benchmark log session: ${id}`);
    return session;
  },
  'logs/servicewrapper.CloseSession': (id: string) => { sessions.delete(id); },
});

let logLineOffset = 0;

(window as any).__ovBench = {
  connectionId: BENCH_CONNECTION_ID,
  handle,
  emit,
  unhandledCalls,
  /** Binding calls by name since the last call to takeCalls(). */
  takeCalls: () => {
    const out = { ...callCounts };
    for (const k of Object.keys(callCounts)) delete callCounts[k];
    return out;
  },
  /** Resolves with the app's startup timings once the shell is interactive. */
  startup: (): Promise<StartupTimings> => (startup ? Promise.resolve(startup) : new Promise((r) => startupWaiters.push(r))),
  servePods: (count: number) => servePods(makePods(count)),
  /** Log sessions the app created, oldest first. */
  logSessions,
  /** DOM helpers for scenarios (bench/render/harness/dom.ts). */
  dom: { findByText, findScrollable, nextFrame, waitFor },
  /**
   * Stream `count` fixture lines to a log session in backend-sized batches, one
   * batch per task (as separate Wails events would arrive). Resolves with the
   * index of the last line sent.
   */
  streamLogs: async (sessionId: string, count: number, batchSize = 100): Promise<number> => {
    const lines = makeLogLines(sessionId, count, logLineOffset);
    logLineOffset += count;
    for (let i = 0; i < lines.length; i += batchSize) {
      streamLines(sessionId, lines.slice(i, i + batchSize), batchSize);
      await new Promise((r) => setTimeout(r, 0));
    }
    return logLineOffset - 1;
  },
};
