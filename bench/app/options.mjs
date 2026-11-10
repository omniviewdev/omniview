/**
 * Command line of bench/app/run.mjs, parsed and validated without touching the process.
 *
 * Two families of scenarios share one runner:
 * - the legacy whole-app scenarios (`cold-start`, `cold-start-k8s`, `pods`, `logs`; workload
 *   `whole-app/v1`), unchanged: `--runs`, one CPU throttle, profiling build by default;
 * - the scroll scenarios (`pods-paced`, `pods-reversal`, `pods-jump`), which take their protocol
 *   (warmup, trials, trial length), metric state, update workload and CPU throttles from the
 *   options below and must be told which React build they are measuring.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const LEGACY_SCENARIOS = Object.freeze(['cold-start', 'cold-start-k8s', 'pods', 'logs']);
export const SCROLL_SCENARIOS = Object.freeze(['pods-paced', 'pods-reversal', 'pods-jump']);
export const METRICS_MODES = Object.freeze(['hidden', 'unavailable', 'healthy']);
/** `plugin`: the Kubernetes plugin's own Pod table. `generic`: the host's generic resource table over the same Pods, mounted through the host's resource browser route. */
export const SURFACES = Object.freeze(['plugin', 'generic']);

/** The sprint's reference protocol (#459/#460). A run that differs is labeled, never hidden. */
export const REFERENCE_PROTOCOL = Object.freeze({
  react: 'normal',
  pods: 5000,
  viewport: Object.freeze({ width: 1440, height: 900 }),
  warmupSeconds: 30,
  trialSeconds: 20,
  trials: 3,
  cpuThrottles: Object.freeze([1, 4]),
  capture: 'full',
  refreshHz: 60,
});

const OPTIONS = {
  runs: { type: 'string', default: '5' },
  only: { type: 'string' },
  'no-build': { type: 'boolean', default: false },
  'build-only': { type: 'boolean', default: false },
  'serve-only': { type: 'boolean', default: false },
  headed: { type: 'boolean', default: false },
  out: { type: 'string' },
  markdown: { type: 'string' },
  'cpu-throttle': { type: 'string', default: '1' },
  react: { type: 'string' },
  minify: { type: 'string', default: 'app' },
  'app-root': { type: 'string' },
  dist: { type: 'string' },
  label: { type: 'string' },
  port: { type: 'string' },
  'config-loader': { type: 'string', default: 'bundle' },
  'plugin-assets': { type: 'string' },
  'plugin-metadata': { type: 'string' },
  pods: { type: 'string', default: String(REFERENCE_PROTOCOL.pods) },
  metrics: { type: 'string', default: METRICS_MODES.join(',') },
  surface: { type: 'string', default: 'plugin' },
  'allow-harness-drift': { type: 'boolean', default: false },
  updates: { type: 'string', default: 'none' },
  'update-rate': { type: 'string', default: '5' },
  'update-batch': { type: 'string', default: '2' },
  'update-recreate-every': { type: 'string', default: '10' },
  'update-seed': { type: 'string', default: '20261109' },
  'metric-refresh-ms': { type: 'string' },
  'metric-changed-fraction': { type: 'string', default: '0.2' },
  'metric-delay-ms': { type: 'string', default: '25' },
  'warmup-seconds': { type: 'string' },
  'trial-seconds': { type: 'string' },
  trials: { type: 'string' },
  speed: { type: 'string', default: '1200' },
  'input-hz': { type: 'string', default: '60' },
  'reversal-segment-seconds': { type: 'string', default: '2' },
  'jump-pages': { type: 'string', default: '30' },
  capture: { type: 'string', default: 'full' },
  'coverage-every': { type: 'string', default: '1' },
  mutations: { type: 'boolean' },
  'no-raw': { type: 'boolean', default: false },
  'overhead-control': { type: 'boolean', default: false },
  smoke: { type: 'boolean', default: false },
};

const number = (name, value, { min = 0, integer = false, exclusiveMin = false } = {}) => {
  const n = Number(value);
  const ok = Number.isFinite(n) && (exclusiveMin ? n > min : n >= min) && (!integer || Number.isInteger(n));
  if (!ok) throw new Error(`--${name} must be ${integer ? 'an integer' : 'a number'} ${exclusiveMin ? '>' : '>='} ${min}, not ${JSON.stringify(value)}`);
  return n;
};

const list = (name, value, allowed) => {
  const items = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new Error(`--${name} needs at least one of ${allowed.join(', ')}`);
  for (const item of items) if (!allowed.includes(item)) throw new Error(`--${name}: unknown value ${item}; have ${allowed.join(', ')}`);
  return [...new Set(items)];
};

/**
 * @param {string[]} argv
 * @param {{ harnessRoot: string, cwd?: string, env?: Record<string, string | undefined>, now?: Date }} context
 */
export function parseOptions(argv, { harnessRoot, cwd = process.cwd(), env = process.env, now = new Date() }) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false });

  const requested = values.only ? values.only.split(',').map((name) => name.trim()).filter(Boolean) : [...LEGACY_SCENARIOS];
  const names = [];
  for (const name of requested) {
    if (name === 'scroll') names.push(...SCROLL_SCENARIOS);
    else if (LEGACY_SCENARIOS.includes(name) || SCROLL_SCENARIOS.includes(name)) names.push(name);
    else throw new Error(`unknown scenario ${name}; have ${[...LEGACY_SCENARIOS, ...SCROLL_SCENARIOS, 'scroll'].join(', ')}`);
  }
  const only = [...new Set(names)];
  const legacy = only.filter((name) => LEGACY_SCENARIOS.includes(name));
  const scroll = only.filter((name) => SCROLL_SCENARIOS.includes(name));

  if (values['build-only'] && values['serve-only']) throw new Error('--build-only and --serve-only are mutually exclusive');
  if (values['build-only'] && values['no-build']) throw new Error('--build-only and --no-build contradict each other');

  const cpuThrottles = String(values['cpu-throttle']).split(',').map((item) => number('cpu-throttle', item.trim(), { min: 1 }));
  if (!cpuThrottles.length) throw new Error('--cpu-throttle needs a value');
  if (legacy.length && cpuThrottles.length > 1) {
    throw new Error('the legacy scenarios take one --cpu-throttle; run them once per throttle (or select only scroll scenarios)');
  }

  const buildMode = values['build-only'] || values['serve-only'];
  const needsReact = scroll.length > 0 || buildMode;
  if (values.react !== undefined && !['normal', 'profiling'].includes(values.react)) {
    throw new Error(`--react must be normal or profiling, not ${JSON.stringify(values.react)}`);
  }
  if (needsReact && values.react === undefined && !values['no-build']) {
    throw new Error('--react normal|profiling is required here: say which React build is being measured (normal for timing, profiling for React attribution)');
  }
  if (!['app', 'on', 'off'].includes(values.minify)) throw new Error(`--minify must be app, on or off, not ${JSON.stringify(values.minify)}`);
  if (!['bundle', 'runner'].includes(values['config-loader'])) throw new Error('--config-loader must be bundle or runner');
  if (!['full', 'frames', 'off'].includes(values.capture)) throw new Error('--capture must be full, frames or off');

  const appRoot = path.resolve(cwd, values['app-root'] ?? harnessRoot);
  const react = values.react ?? 'profiling';
  const label = (values.label ?? path.basename(path.dirname(appRoot)) ?? 'host').replace(/[^A-Za-z0-9._-]+/g, '-') || 'host';
  const slug = `${label}-${crypto.createHash('sha256').update(appRoot).digest('hex').slice(0, 8)}-${react}`;
  const dist = values.dist
    ? path.resolve(cwd, values.dist)
    : appRoot === harnessRoot && !scroll.length && !buildMode && values.label === undefined
      ? path.join(harnessRoot, 'bench/app/dist')
      : path.join(harnessRoot, '.local/bench-app/builds', slug, 'dist');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const out = values.out
    ? path.resolve(cwd, values.out)
    : scroll.length
      ? path.join(harnessRoot, '.local/bench-app/results', `${label}-${react}-${stamp}.json`)
      : path.join(harnessRoot, 'bench/app/results/latest.json');

  const smoke = values.smoke;
  const warmupSeconds = number('warmup-seconds', values['warmup-seconds'] ?? (smoke ? 2 : REFERENCE_PROTOCOL.warmupSeconds));
  const trialSeconds = number('trial-seconds', values['trial-seconds'] ?? (smoke ? 3 : REFERENCE_PROTOCOL.trialSeconds), { exclusiveMin: true });
  const trials = number('trials', values.trials ?? (smoke ? 1 : REFERENCE_PROTOCOL.trials), { min: 1, integer: true });

  const updates = list('updates', values.updates, ['none', 'sparse']);
  const surface = values.surface;
  if (!SURFACES.includes(surface)) throw new Error(`--surface must be one of ${SURFACES.join(', ')}`);
  // The generic table builds its columns from the resource definition and has no metric columns, so metrics are not a dimension there.
  if (surface === 'generic' && values.metrics !== METRICS_MODES.join(',')) throw new Error('--metrics does not apply to --surface generic: the generic table has no metric columns');
  const metrics = surface === 'generic' ? ['none'] : list('metrics', values.metrics, METRICS_MODES);
  const pods = number('pods', values.pods, { min: 1, integer: true });
  const speed = number('speed', values.speed, { exclusiveMin: true });
  const inputHz = number('input-hz', values['input-hz'], { exclusiveMin: true });
  const reversalSegmentSeconds = number('reversal-segment-seconds', values['reversal-segment-seconds'], { exclusiveMin: true });
  const mutations = values.mutations ?? react === 'profiling';

  return {
    runs: number('runs', values.runs, { min: 1, integer: true }),
    only, legacy, scroll,
    noBuild: values['no-build'],
    buildOnly: values['build-only'],
    serveOnly: values['serve-only'],
    headed: values.headed,
    out,
    outExplicit: values.out !== undefined,
    markdown: values.markdown ? path.resolve(cwd, values.markdown) : scroll.length ? out.replace(/\.json$/, '.md') : null,
    cpuThrottles,
    react,
    reactExplicit: values.react !== undefined,
    minify: values.minify,
    configLoader: values['config-loader'],
    appRoot,
    dist,
    label,
    port: values.port === undefined ? Number(env.OV_BENCH_PORT ?? 9345) : number('port', values.port, { min: 0, integer: true }),
    pluginAssets: values['plugin-assets'] ? path.resolve(cwd, values['plugin-assets']) : null,
    pluginMetadata: values['plugin-metadata'] ? path.resolve(cwd, values['plugin-metadata']) : null,
    pods, metrics, updates,
    update: {
      eventsPerSecond: number('update-rate', values['update-rate'], { exclusiveMin: true }),
      recordsPerEvent: number('update-batch', values['update-batch'], { min: 1, integer: true }),
      recreateEvery: number('update-recreate-every', values['update-recreate-every'], { min: 0, integer: true }),
      seed: number('update-seed', values['update-seed'], { min: 0, integer: true }),
    },
    metricRefreshMs: values['metric-refresh-ms'] === undefined ? null : number('metric-refresh-ms', values['metric-refresh-ms'], { min: 1000 }),
    metricChangedFraction: number('metric-changed-fraction', values['metric-changed-fraction'], { min: 0 }),
    metricDelayMs: number('metric-delay-ms', values['metric-delay-ms'], { min: 0 }),
    warmupSeconds, trialSeconds, trials,
    speed, inputHz, reversalSegmentSeconds,
    jumpPages: number('jump-pages', values['jump-pages'], { min: 1, integer: true }),
    capture: values.capture,
    coverageEvery: number('coverage-every', values['coverage-every'], { min: 1, integer: true }),
    surface,
    allowHarnessDrift: values['allow-harness-drift'],
    mutations,
    raw: !values['no-raw'],
    overheadControl: values['overhead-control'],
    smoke,
  };
}

/**
 * How a scroll run differs from the reference protocol. Empty means it matches; anything else is
 * printed in the report so a short smoke run or a profiling build is never read as a reference.
 */
export function protocolDeviations(options, { reactBuild = options.react, refreshHz = null } = {}) {
  const out = [];
  if (reactBuild !== REFERENCE_PROTOCOL.react) out.push(`React build is ${reactBuild}, the reference is ${REFERENCE_PROTOCOL.react}`);
  if (options.pods !== REFERENCE_PROTOCOL.pods) out.push(`${options.pods} Pods, the reference is ${REFERENCE_PROTOCOL.pods}`);
  if (options.warmupSeconds !== REFERENCE_PROTOCOL.warmupSeconds) out.push(`${options.warmupSeconds} s warmup, the reference is ${REFERENCE_PROTOCOL.warmupSeconds} s`);
  if (options.trialSeconds !== REFERENCE_PROTOCOL.trialSeconds) out.push(`${options.trialSeconds} s trials, the reference is ${REFERENCE_PROTOCOL.trialSeconds} s`);
  if (options.trials !== REFERENCE_PROTOCOL.trials) out.push(`${options.trials} trials, the reference is ${REFERENCE_PROTOCOL.trials}`);
  if (options.capture !== REFERENCE_PROTOCOL.capture) out.push(`capture mode ${options.capture}, the reference is ${REFERENCE_PROTOCOL.capture}`);
  if (options.coverageEvery !== 1) out.push(`coverage sampled every ${options.coverageEvery} frames, the reference samples every frame`);
  if (options.minify !== 'app') out.push(`minifier forced ${options.minify}: not the app's own production configuration`);
  if (typeof refreshHz === 'number' && Math.abs(refreshHz - REFERENCE_PROTOCOL.refreshHz) > 5) {
    out.push(`display refresh measured at ${refreshHz} Hz, the 60 Hz reference does not apply; keep it separate`);
  }
  return out;
}
