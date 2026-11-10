/**
 * The scroll workloads of bench/app: what each id means, which cells a command line expands
 * to, and the declared input plan of each cell.
 *
 * A workload id names a definition. Change the id whenever the driver, the declared parameters
 * or what is fixed about the fixture changes, so results of different workloads are never
 * compared as if they matched. The parameters actually applied are recorded with every cell
 * (`meta.scenarios[key].workload.params`), and the compare report refuses to pair cells whose
 * ids or parameters differ.
 */

export const SCROLL_WORKLOADS = Object.freeze({
  'pods-paced': {
    id: 'pods-paced/v1',
    kind: 'paced',
    driver: 'cdp-wheel',
    description: 'Continuous downward wheel input at a constant declared velocity and cadence, sent from Node over CDP.',
  },
  'pods-reversal': {
    id: 'pods-reversal/v1',
    kind: 'reversal',
    driver: 'cdp-wheel',
    description: 'The same wheel input with the direction reversed every declared segment, oscillating between two offsets away from both scroll boundaries.',
  },
  'pods-jump': {
    id: 'pods-jump/v1',
    kind: 'jump',
    driver: 'in-page-settle',
    description: 'The existing viewport-jump driver (whole-app/v1 scroll step): up to N viewport-sized jumps, each waiting for a painted frame, then a reset. A settling driver, not continuous input.',
  },
});

/** A plugin-surface key stays as it was; another surface prefixes it so the two never pair in a comparison. */
export const cellKey = (scenario, metrics, updates, cpuThrottle, surface = 'plugin') =>
  `${surface === 'plugin' ? '' : `${surface}:`}${scenario}[metrics=${metrics},updates=${updates},cpu=${cpuThrottle}x]`;

/** With sparse updates the fixture host refreshes metrics this often unless told otherwise (the host's own interval is 30 s). */
export const DEFAULT_SPARSE_METRIC_REFRESH_MS = 5000;

/** The declared metric refresh period of a cell; null leaves each observation's own interval. */
export function metricRefreshFor(options, cell) {
  return cell.updates === 'sparse' ? options.metricRefreshMs ?? DEFAULT_SPARSE_METRIC_REFRESH_MS : null;
}

/** Every (scenario, metric state, update workload, CPU throttle) the command line selects. */
export function buildCells(options) {
  const cells = [];
  for (const scenario of options.scroll) {
    for (const metrics of options.metrics) {
      for (const updates of options.updates) {
        for (const cpuThrottle of options.cpuThrottles) {
          cells.push({ key: cellKey(scenario, metrics, updates, cpuThrottle, options.surface), scenario, workload: SCROLL_WORKLOADS[scenario], surface: options.surface ?? 'plugin', metrics, updates, cpuThrottle });
        }
      }
    }
  }
  return cells;
}

/** The parameters this run applies to a cell, as recorded with it. */
export function workloadParams(options, cell) {
  const common = {
    viewport: { width: 1440, height: 900 },
    pods: options.pods,
    warmupSeconds: options.warmupSeconds,
    trials: options.trials,
    metrics: cell.metrics,
    surface: cell.surface ?? 'plugin',
    updates: cell.updates === 'sparse'
      ? { ...options.update, metricRefreshMs: metricRefreshFor(options, cell), metricChangedFraction: options.metricChangedFraction }
      : 'none',
    metricDelayMs: options.metricDelayMs,
  };
  if (cell.workload.kind === 'jump') return { ...common, pages: options.jumpPages };
  return {
    ...common,
    trialSeconds: options.trialSeconds,
    speedPxPerSecond: options.speed,
    inputHz: options.inputHz,
    ...(cell.workload.kind === 'reversal' ? { segmentSeconds: options.reversalSegmentSeconds } : {}),
  };
}

/**
 * The declared input of one trial: where it starts and its velocity segments. Throws when the
 * table is too short for the declared distance, rather than letting a boundary clamp the input
 * and quietly change the workload.
 *
 * @param {{ speed: number, trialSeconds: number, reversalSegmentSeconds: number }} options
 * @param {{ workload: { kind: string } }} cell
 * @param {{ maxScroll: number, rowHeightPx: number }} table
 */
export function wheelPlan(options, cell, table) {
  const trialMs = options.trialSeconds * 1000;
  const margin = Math.max(2 * (table.rowHeightPx || 30), 60);
  let startPx = 0;
  let segments;
  if (cell.workload.kind === 'paced') {
    segments = [{ durationMs: trialMs, pxPerSec: options.speed }];
  } else if (cell.workload.kind === 'reversal') {
    const segmentMs = options.reversalSegmentSeconds * 1000;
    segments = [];
    for (let at = 0, direction = 1; at < trialMs; at += segmentMs, direction = -direction) {
      segments.push({ durationMs: Math.min(segmentMs, trialMs - at), pxPerSec: direction * options.speed });
    }
    // Oscillate between startPx and startPx + one segment of travel: clear of the top.
    startPx = Math.round(options.speed * options.reversalSegmentSeconds + margin);
  } else {
    throw new Error(`${cell.workload.kind} has no wheel plan`);
  }
  let position = startPx;
  let top = startPx;
  let bottom = startPx;
  for (const segment of segments) {
    position += (segment.pxPerSec * segment.durationMs) / 1000;
    top = Math.min(top, position);
    bottom = Math.max(bottom, position);
  }
  if (top < margin - 1 && cell.workload.kind === 'reversal') throw new Error('the reversal plan reaches the top of the table');
  if (bottom > table.maxScroll - margin) {
    throw new Error(`${cell.workload.kind}: the declared input reaches ${Math.round(bottom)} px but the table scrolls only ${Math.round(table.maxScroll)} px; lower --speed or --trial-seconds, or serve more --pods`);
  }
  return { startPx, segments, marginPx: margin };
}
