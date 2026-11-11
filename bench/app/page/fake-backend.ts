/**
 * In-page fake Wails backend for the bench/app profiling build. Imported before
 * anything else in ui/main.tsx (see bench/app/vite.config.ts), so it is in
 * place before the first binding call. Reuses the render-bench transport and
 * fixtures (bench/render), and exposes controls on `window.__ovBench` for the
 * Playwright scenarios and for a native WebView driven by hand.
 *
 * The page reads its starting state from `window.__OV_BENCH__`, which the runner sets with
 * `addInitScript` before navigation. A page opened without a runner (a native WebView) gets
 * the same object from the `ovbench` query parameter: the bootstrap script the build injects
 * at the top of index.html parses it before any other script runs, e.g.
 * `/?ovbench={"plugins":["kubernetes"],"pods":5000,"metrics":"healthy","instance":"production"}#/…`.
 *
 * Calls are answered in the page: there is no IPC, and no native Omniview backend. Everything
 * measured through this fixture is fixture-only evidence about the renderer.
 */
import { getTransport, setTransport, objectNames } from '@wailsio/runtime';
import bindingIndex from 'virtual:wails-binding-index';
import { bindingName, installFakeBackend, handle, handleAll, emit, unhandledCalls } from '../../render/harness/backend';
import { installDefaultFixtures, BENCH_CONNECTION_ID } from '../../render/fixtures/defaults';
import { makePods, servePods, type PodsFixture } from '../../render/fixtures/kubernetes';
import { serveMetrics, type MetricsFixture } from '../../render/fixtures/metrics';
import { startSparseUpdates, type SparseUpdates, type SparseUpdateSpec } from '../../render/fixtures/updates';
import { makeLogLines, makeLogSession, streamLines, type BenchLogSession } from '../../render/fixtures/logs';
import { findByText, findScrollable, nextFrame, waitFor } from '../../render/harness/dom';
import kubernetesPlugin from 'virtual:bench-kubernetes-plugin';
import { installCapture } from './capture';

export interface BenchConfig {
  /** Plugin ids reported as installed; their UI bundles are loaded from /_/plugins/<id>/assets. */
  plugins?: string[];
  /** Pods returned by the kubernetes List call. */
  pods?: number;
  /** Model a new profile with no kubeconfig contexts. */
  emptyConnections?: boolean;
  /**
   * Metric provider state behind the Pod table's CPU and Memory columns, answered with the
   * current host protocol (selection, catalog, observations):
   * `healthy` serves samples, `unavailable` answers every pair `failed` as an absent metrics API does,
   * `hidden` serves a healthy provider but seeds the persisted column visibility so no metric
   * column is shown and no observation may open. Absent: the legacy fixture, which has no metric
   * protocol and therefore no metric columns.
   */
  metrics?: 'hidden' | 'unavailable' | 'healthy';
  /** Fixture host latency per metric collection, ms. */
  metricDelayMs?: number;
  /** Declared metric refresh period, ms; absent follows each observation's own interval. */
  metricRefreshMs?: number;
  /** Fraction of targets whose sample advances on each metric refresh. */
  metricChangedFraction?: number;
  /** The identity a native host embeds in index.html. Absent: a plain preview with no identity. */
  instance?: 'production';
}

export interface StartupTimings {
  ui_main_start_ms: number;
  ui_committed_ms: number;
  ui_ready_ms: number;
}

const config: BenchConfig = window.__OV_BENCH__ ?? {};
const pluginMeta: Record<string, Record<string, unknown>> = { kubernetes: kubernetesPlugin };

installFakeBackend();
const defaults = installDefaultFixtures();

// Count binding calls by name, so a scenario can report what the app asked the backend for.
const callCounts: Record<string, number> = {};
const inner = getTransport()!;
// NameMethod in the pinned @wailsio/runtime Window API.
const WINDOW_NAME_METHOD = 18;
setTransport({
  call: (objectID: number, method: number, windowName: string, args: { methodID?: number; methodName?: string; args?: unknown[] } | undefined) => {
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

/** Resource type served by the Kubernetes fixture. */
const POD_KEY = 'k8s:/pods';

handleAll({
  'resource/servicewrapper.GetConnection': () => connection,
  'resource/servicewrapper.GetResourceGroups': () => [
    { id: 'workloads', name: 'Workloads', description: '', icon: '', resources: [POD_KEY] },
  ],
  'resource/servicewrapper.GetSourceStates': (_plugin: string, route: unknown) => ({
    route,
    types: { [POD_KEY]: { state: 'following', mode: 'snapshotAndUpdates', continuity: 'bestEffort',
      count: { kind: 'exact', value: String(config.pods ?? 0) } } },
  }),
  'resource/servicewrapper.GetAllConnectionStates': () => ({}),
  // Startup calls with nothing to report (empty state dir).
  'diagnostics/diagnosticsclient.Log': () => null,
  'devserver/servicewrapper.ListDevServerStates': () => [],
  'exec/servicewrapper.ListSessions': () => [],
  'networker/servicewrapper.ListAllPortForwardSessions': () => [],
  'plugin/servicewrapper.ListPlugins': () => plugins,
  'plugin/servicewrapper.GetPlugin': (id: string) => plugins.find((p) => p.id === id) ?? null,
  'plugin/servicewrapper.GetPluginMeta': (id: string) => pluginMeta[id] ?? { id, name: id, version: '0.0.0-bench' },
  'plugin/servicewrapper.ListAvailablePlugins': () => [],
  'resource/servicewrapper.ListConnections': () => config.emptyConnections ? [] : [{ id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }],
  'resource/servicewrapper.ListAllConnections': () =>
    Object.fromEntries(plugins.map((p) => [p.id, config.emptyConnections ? [] : [{ id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }]])),
  'resource/servicewrapper.StartConnection': () => ({ connection: { id: BENCH_CONNECTION_ID, name: 'bench', labels: {} }, status: 'CONNECTED' }),
  // The startup marker the cold-start script also uses (ui/features/perf/startup.ts).
  'diagnostics/diagnosticsclient.ReportStartupReady': (t: StartupTimings) => {
    startup = t;
    startupWaiters.splice(0).forEach((fn) => fn(t));
  },
});

/**
 * The host's instance descriptor (internal/devcontract/instance.go) for the boot identity the
 * page was given. The shell fetches it after first paint and compares identity, kind and
 * generation: anything else is a `mismatch` state with a warning in the footer.
 */
const bootIdentity = window.__OMNIVIEW_INSTANCE__;
if (config.instance && bootIdentity) {
  handleAll({
    'appservice.GetInstanceInfo': () => ({
      schemaVersion: 1, workspaceID: '', instanceID: bootIdentity.instanceID, generation: bootIdentity.generation,
      kind: bootIdentity.kind, channel: 'bench', displayName: bootIdentity.displayName, stateRoot: '',
      process: { pid: 0, startIdentity: '', executable: '', workspaceID: '', generation: bootIdentity.generation, role: 'host' },
      version: '0.0.0-bench', commit: '', repositories: null,
      endpoints: { browser: null, vite: null, hmr: null, mcp: null, control: null, health: null },
      plugins: null, readiness: 'host-ready', startedAt: new Date().toISOString(),
    }),
  });
}

let podsFixture: PodsFixture | null = null;
let metricsFixture: MetricsFixture | null = null;
let updates: SparseUpdates | null = null;

/**
 * Persisted per-view UI state the kubernetes plugin keeps in localStorage
 * (`kubernetes-<connection>-<resource>-column-visibility`, plugin useStoredState). A scenario
 * with a declared metric state starts from a clean slate, and `hidden` is the same persisted
 * choice a user makes by hiding the CPU and Memory columns. The runner verifies the outcome
 * from the rendered headers and the metric demand, so a renamed key fails loudly rather than
 * silently measuring the wrong columns.
 */
function seedPodTableState(metrics: NonNullable<BenchConfig['metrics']>) {
  try {
    const prefix = `kubernetes-${BENCH_CONNECTION_ID}-`;
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    if (metrics === 'hidden') {
      localStorage.setItem(`${prefix}${POD_KEY}-column-visibility`, JSON.stringify({ cpuUsage: false, memUsage: false }));
    }
  } catch {
    // A restricted storage cannot seed state; the verification step reports the mismatch.
  }
}

if (config.pods) {
  podsFixture = servePods(makePods(config.pods));
  if (config.metrics) {
    seedPodTableState(config.metrics);
    metricsFixture = serveMetrics({
      mode: config.metrics === 'unavailable' ? 'unavailable' : 'healthy',
      delayMs: config.metricDelayMs,
      refreshMs: config.metricRefreshMs,
      changedFraction: config.metricChangedFraction,
    });
  }
}

const logSessions: string[] = [];
const sessions = new Map<string, BenchLogSession>();
handleAll({
  'logs/servicewrapper.CreateSession': (plugin: string, connection: string, encoded: string) => {
    const id = `bench-log-${logSessions.length}`;
    const session = makeLogSession(id, plugin, connection, encoded);
    logSessions.push(session.id);
    sessions.set(session.id, session);
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

const { capture, scroll, help } = installCapture();

window.__ovBench = {
  connectionId: BENCH_CONNECTION_ID,
  config,
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
  servePods: (count: number) => { podsFixture = servePods(makePods(count)); },
  /** Log sessions the app created, oldest first. */
  logSessions,
  /** DOM helpers for scenarios (bench/render/harness/dom.ts). */
  dom: { findByText, findScrollable, nextFrame, waitFor },
  /** Bounded page-side sampler: frames, viewport coverage, wheel/scroll accounting, long tasks. */
  capture,
  /** Table location, readiness, positioning and the viewport-jump driver. */
  scroll,
  /** What the fixtures delivered, and the declared sparse-update workload. */
  fixture: {
    stats: () => ({
      pods: podsFixture ? { count: podsFixture.pods().length, views: podsFixture.views() } : null,
      metrics: metricsFixture?.stats() ?? null,
      activity: { revision: defaults.activity.revision(), armedSubscriptions: defaults.activity.armedSubscriptions(), calls: defaults.activity.calls() },
      host: { dataKeys: { kubernetes: defaults.host.pluginDataKeys('kubernetes') }, windowState: defaults.host.windowState(), viewports: defaults.host.viewports(), calls: defaults.host.calls() },
      updates: updates?.ledger() ?? null,
    }),
    updates: {
      start: (spec: SparseUpdateSpec) => {
        if (!podsFixture) throw new Error('no pod fixture is served: set pods in the bench config');
        updates?.stop();
        updates = startSparseUpdates(podsFixture, spec);
        return updates.ledger();
      },
      stop: () => updates?.stop() ?? null,
      ledger: () => updates?.ledger() ?? null,
    },
  },
  help,
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
