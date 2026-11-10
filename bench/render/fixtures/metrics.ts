/**
 * Current host finite-metrics protocol for the Kubernetes Pod table, answered in the page.
 *
 * The Pod table reaches metrics through exactly these host calls
 * (backend/pkg/plugin/metric/finite_*.go, runtime hooks/metric):
 *
 * 1. GetMetricViewSourceSelection: the durable routing choice. The host's default for a view
 *    with no stored choice is `mode: "inherit"` with no source and an empty revision.
 * 2. GetResourceMetricsCatalog: the selected source's catalog. Its `current`-shape
 *    descriptors become the CPU and Memory columns; without a catalog there are no metric
 *    columns at all.
 * 3. OpenMetricsObservation, then AttachMetricsObservation: only visible metric columns open
 *    an observation, and only mounted rows are its targets. Open reserves a token and returns
 *    the acknowledgement snapshot (sequence 1, the catalog, no data). Attach is the barrier
 *    after which the host collects and publishes `metric/observation` events: a progress
 *    frame (`fetching: true`) and then the data frame, each with the next sequence number of
 *    the observation's generation. CloseMetricsObservation retires it.
 *
 * An unhandled call resolves to `null`, which is neither a healthy nor an unavailable
 * provider: the selection hook throws on it and the table never learns that metrics exist.
 * Both modes here are real protocol answers:
 *
 * - `healthy`: every requested (target, metric) pair answers `ok` with a physical value
 *   (cores, bytes) and a source timestamp, `complete: true`.
 * - `unavailable`: the metrics API is absent, as the Kubernetes native provider reports it
 *   (kubernetes/pkg/plugin/metric/native.go): every pair answers status `failed` with its
 *   message, `complete: false`, and the scan failure as a warning. The catalog and the
 *   columns are still present; the cells show a gap with the status as their tooltip.
 *
 * Refresh follows the host: an attached observation is collected again every `interval_ms`
 * of its own spec (the table asks for 30 s). A sparse-update workload may declare a shorter
 * `refreshMs` and a `changedFraction`: on a refresh only that fraction of targets gets a new
 * value and source timestamp, as metrics-server only advances a sample when it scrapes.
 *
 * Every snapshot is a fresh object (JSON round trip), as a decoded wire event is.
 */
import { emit, handleAll } from '../harness/backend';

export type MetricsMode = 'healthy' | 'unavailable';

export interface MetricsFixtureOptions {
  mode: MetricsMode;
  pluginId?: string;
  resourceKey?: string;
  /** Host latency for each collection. */
  delayMs?: number;
  /** Declared refresh period replacing the observation's own `interval_ms`. */
  refreshMs?: number;
  /** Fraction of targets whose sample advances on a refresh after the first collection. */
  changedFraction?: number;
  seed?: number;
}

export interface MetricsStats {
  mode: MetricsMode;
  selectionReads: number;
  catalogReads: number;
  opens: number;
  attaches: number;
  refreshes: number;
  closes: number;
  /** Observations currently open. */
  active: number;
  /** Targets requested over all Opens, counting a target once per Open. */
  targetsRequested: number;
  maxTargetsPerOpen: number;
  distinctTargets: number;
  progressFrames: number;
  dataFrames: number;
  resultsEmitted: number;
  failedResults: number;
}

export interface MetricsFixture {
  stats(): MetricsStats;
}

const CPU = 'kubernetes.pod.cpu.usage';
const MEMORY = 'kubernetes.pod.memory.working_set';
const MAX_TARGETS = 256;
const MAX_METRICS = 32;
const MAX_SAMPLE_AGE_NS = 120_000_000_000;
const WINDOW_NS = 60_000_000_000;
const FAILURE = 'Native metrics namespace scan failed';

/** FNV-1a, mapped to [0, 1). Deterministic per text, so values never depend on run order. */
function unit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

interface Target { token: string }
interface Spec {
  owner_plugin_id: string;
  owner_connection_id: string;
  resource_key: string;
  targets: Target[];
  metric_ids: string[];
  interval_ms: number;
}

interface Sample { version: number; observedAt: number }

interface Observation {
  token: string;
  generation: number;
  sequence: number;
  spec: Spec;
  catalog: unknown;
  attached: boolean;
  closed: boolean;
  running: boolean;
  /** Collections completed so far. */
  tick: number;
  samples: Map<string, Sample>;
  data: unknown;
  timer: number | undefined;
}

export function serveMetrics(options: MetricsFixtureOptions): MetricsFixture {
  const pluginId = options.pluginId ?? 'kubernetes';
  const resourceKey = options.resourceKey ?? 'k8s:/pods';
  const delayMs = options.delayMs ?? 25;
  const seed = options.seed ?? 20261109;
  const changedFraction = options.changedFraction ?? 0.2;
  const observations = new Map<string, Observation>();
  const distinct = new Set<string>();
  let generation = 0;
  const stats: MetricsStats = {
    mode: options.mode, selectionReads: 0, catalogReads: 0, opens: 0, attaches: 0, refreshes: 0, closes: 0, active: 0,
    targetsRequested: 0, maxTargetsPerOpen: 0, distinctTargets: 0, progressFrames: 0, dataFrames: 0, resultsEmitted: 0, failedResults: 0,
  };

  const catalogFor = (connection: string, key: string) => ({
    source: { plugin_id: pluginId, connection_id: connection, datasource_uid: '', datasource_kind: '', native: true },
    metrics: key === resourceKey ? [
      { id: CPU, name: 'CPU usage', resource_key: key, unit: 'cores', shapes: ['current'],
        description: 'Sum of container CPU usage, in cores averaged over the metrics-server measurement window.' },
      { id: MEMORY, name: 'Memory working set', resource_key: key, unit: 'bytes', shapes: ['current'],
        description: 'Sum of container memory working sets in bytes, from metrics-server.' },
    ] : [],
    max_targets: MAX_TARGETS,
    max_sample_age: MAX_SAMPLE_AGE_NS,
  });

  const value = (token: string, metric: string, version: number) => {
    const base = unit(`${token}|${metric}`);
    const drift = 1 + (((version * 37) % 11) - 5) / 100;
    return metric === CPU
      ? Math.round((0.002 + base * 0.4) * drift * 1e6) / 1e6
      : Math.round((16 + base * 496) * drift) * 1024 * 1024;
  };

  const build = (o: Observation) => {
    const now = Date.now();
    const first = o.tick === 0;
    const results: Array<Record<string, unknown>> = [];
    for (const { token } of o.spec.targets) {
      let sample = o.samples.get(token);
      if (!sample) {
        // A sample's source time is in the past, within one scrape of now.
        sample = { version: 0, observedAt: now - Math.floor(unit(`${token}|at|${seed}`) * 30_000) };
        o.samples.set(token, sample);
      } else if (!first && unit(`${token}|${o.tick}|${seed}`) < changedFraction) {
        sample.version++;
        sample.observedAt = now;
      }
      for (const metric of o.spec.metric_ids) {
        results.push(options.mode === 'healthy'
          ? { resource_token: token, metric_id: metric, status: 'ok', value: value(token, metric, sample.version), points: [],
              dimensions: {}, observed_at: new Date(sample.observedAt).toISOString(), window: WINDOW_NS, identity_scope: 'incarnation', message: '' }
          : { resource_token: token, metric_id: metric, status: 'failed', value: null, points: [],
              dimensions: {}, observed_at: null, window: 0, identity_scope: '', message: FAILURE });
      }
    }
    return options.mode === 'healthy'
      ? { results, complete: true, warnings: [] as string[] }
      : { results, complete: false, warnings: [FAILURE] };
  };

  /** Publish the observation's current state as the next sequence of its generation. */
  const publish = (o: Observation, fetching: boolean) => {
    o.sequence++;
    const snapshot = JSON.parse(JSON.stringify({
      client_token: o.token, generation: o.generation, sequence: o.sequence, data: o.data, catalog: o.catalog,
      fetching, error: '', domain_start: null, domain_end: null, invalidated: false,
    }));
    emit('metric/observation', snapshot);
  };

  const collect = (o: Observation) => {
    if (o.closed || o.running) return;
    o.running = true;
    stats.progressFrames++;
    publish(o, true);
    o.timer = window.setTimeout(() => {
      o.timer = undefined;
      if (o.closed) return;
      o.running = false;
      const data = build(o);
      o.data = data;
      o.tick++;
      stats.dataFrames++;
      stats.resultsEmitted += data.results.length;
      if (options.mode === 'unavailable') stats.failedResults += data.results.length;
      publish(o, false);
      const interval = options.refreshMs ?? o.spec.interval_ms;
      if (interval > 0) o.timer = window.setTimeout(() => { o.timer = undefined; collect(o); }, interval);
    }, delayMs);
  };

  const find = (token: string): Observation => {
    const o = observations.get(token);
    if (!o) throw Object.assign(new Error('Observation is not owned by this session.'), { code: 'NOT_FOUND' });
    return o;
  };

  handleAll({
    'metric/servicewrapper.GetMetricViewSourceSelection': (ownerPlugin: string, ownerConnection: string, key: string) => {
      stats.selectionReads++;
      if (!ownerPlugin || !ownerConnection || !key) throw new Error('View source owner connection and resource key are required.');
      return { owner_plugin_id: ownerPlugin, owner_connection_id: ownerConnection, resource_key: key, mode: 'inherit', revision: '' };
    },
    'metric/servicewrapper.GetResourceMetricsCatalog': (request: { owner_connection_id: string; resource_key: string }) => {
      stats.catalogReads++;
      return catalogFor(request.owner_connection_id, request.resource_key);
    },
    'metric/servicewrapper.OpenMetricsObservation': (request: { client_token: string; spec: Spec }) => {
      const { client_token: token, spec } = request;
      if (!token || token.length > 128) throw new Error('Client token must contain 1..128 UTF-8 bytes without NUL or line breaks.');
      if (!spec.targets?.length || spec.targets.length > MAX_TARGETS || !spec.metric_ids?.length || spec.metric_ids.length > MAX_METRICS) {
        throw Object.assign(new Error('Observation target or metric count is outside bounds.'), { code: 'RESOURCE_LIMIT' });
      }
      if (observations.has(token)) throw Object.assign(new Error('Observation token is already registered.'), { code: 'CONFLICT' });
      stats.opens++;
      stats.targetsRequested += spec.targets.length;
      stats.maxTargetsPerOpen = Math.max(stats.maxTargetsPerOpen, spec.targets.length);
      for (const target of spec.targets) distinct.add(target.token);
      stats.distinctTargets = distinct.size;
      const catalog = catalogFor(spec.owner_connection_id, spec.resource_key);
      const o: Observation = {
        token, generation: ++generation, sequence: 1, spec, catalog, attached: false, closed: false, running: false,
        tick: 0, samples: new Map(), data: null, timer: undefined,
      };
      observations.set(token, o);
      stats.active = observations.size;
      return JSON.parse(JSON.stringify({
        client_token: token, generation: o.generation, sequence: 1, data: null, catalog,
        fetching: false, error: '', domain_start: null, domain_end: null, invalidated: false,
      }));
    },
    'metric/servicewrapper.AttachMetricsObservation': (token: string) => {
      const o = find(token);
      stats.attaches++;
      if (o.attached) return;
      o.attached = true;
      collect(o);
    },
    'metric/servicewrapper.RefreshMetricsObservation': (token: string) => {
      const o = find(token);
      stats.refreshes++;
      // A refresh joins a collection already in flight, as the host's does.
      if (o.running || !o.attached) return;
      window.clearTimeout(o.timer);
      o.timer = undefined;
      collect(o);
    },
    'metric/servicewrapper.CloseMetricsObservation': (token: string) => {
      stats.closes++;
      const o = observations.get(token);
      if (!o) return;
      o.closed = true;
      window.clearTimeout(o.timer);
      o.timer = undefined;
      observations.delete(token);
      stats.active = observations.size;
    },
    // Presentation preferences (the drawer's metrics page): the host's unpersisted default.
    'metric/servicewrapper.GetMetricViewPreferences': () => ({
      version: 1, revision: 0, metric_ids: [], displays: {}, layout: 'auto', time_mode: 'relative',
      duration_ms: 3_600_000, start_ms: 0, end_ms: 0, details: {},
    }),
    'metric/servicewrapper.SaveMetricViewPreferences': () => undefined,
  });

  return { stats: () => ({ ...stats }) };
}
