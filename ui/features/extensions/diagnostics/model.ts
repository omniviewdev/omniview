import type { ExtensionPointRegistryContract } from '@omniviewdev/runtime';
import type { PluginService } from '@/features/plugins/core/PluginService';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '../sidebar/extensionPoint';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '../drawer/extensionPoint';
import type { ResourceExtensionRenderContext } from '@/features/plugins/core/types';
import type { DiagnosticCaptureOptions, DiagnosticFilter, DiagnosticLookupRequest, DiagnosticLookupResult, DiagnosticProblem, ExtensionDiagnosticSnapshot } from './types';

export type DiagnosticService = Pick<PluginService, 'getDebugSnapshot' | 'subscribe' | 'onQuarantineActivated' | 'unquarantine'>;
const MAX_ROWS = 2000;
const MAX_TEXT = 2048;
const MAX_TOTAL_TEXT = 100_000;
const REDACTED = '[Exception details redacted; explicitly reveal sensitive details to inspect]';
const COVERAGE = [
  'Registry inventory and host plugin lifecycle, pending targets, dependency warnings, crashes, and quarantine only.',
  'Registration does not prove successful rendering. No render-success observations are collected.',
  'Theme contributions use specialized admission; registry presence does not prove theme admission.',
];
const snapshotGuards = new WeakMap<ExtensionDiagnosticSnapshot, () => boolean>();

export function assertDiagnosticSnapshotCurrent(snapshot: ExtensionDiagnosticSnapshot) {
  if (!snapshot.windowName) {
    throw new Error('Extension diagnostics runtime identity is unavailable.');
  }

  if (snapshot.truncated) {
    throw new Error('Diagnostic capture is truncated. Actions require complete registration identifiers.');
  }

  if (!snapshotGuards.get(snapshot)?.()) {
    throw new Error('Diagnostic selection changed. Select the current registration before acting.');
  }
}

// Read only own data properties. Never inspect plugin values, metadata, prototypes, or accessors.
function data(object: unknown, key: string): unknown {
  if ((typeof object !== 'object' || object === null) && typeof object !== 'function') {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined; 
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freeze(child);
    }

    Object.freeze(value);
  }

  return value;
}

export function captureExtensionSnapshot(
  registry: ExtensionPointRegistryContract,
  service: DiagnosticService,
  options: DiagnosticCaptureOptions,
): ExtensionDiagnosticSnapshot {
  let truncated = false;
  let rows = 0;
  let remainingText = MAX_TOTAL_TEXT;
  const take = () => {
    if (rows >= MAX_ROWS) {
      truncated = true; return false; 
    }

    rows++; return true; 
  };

  const text = (value: unknown, fallback = '') => {
    if (typeof value !== 'string') {
      return fallback;
    }

    const limit = Math.min(MAX_TEXT, remainingText);
    const result = value.slice(0, limit);
    remainingText -= result.length;
    if (result.length !== value.length) {
      truncated = true;
    }

    return result;
  };

  const detail = (value: unknown) => options.includeSensitive ? text(value) : REDACTED;
  const debug = service.getDebugSnapshot();
  const records = new Map(Object.entries(debug.plugins).flatMap(([pluginId, plugin]) => plugin.contributions.map(record => [JSON.stringify([record.extensionPointId, pluginId, record.id]), record] as const)));
  const quarantined = new Map(debug.quarantinedContributions.map(record => [JSON.stringify([record.extensionPointId, record.pluginId, record.contributionId]), record.crashCount] as const));
  const capturedCrashCounts = new Map<string, number>();
  for (const crash of debug.recentCrashes) {
    const identity = JSON.stringify([crash.extensionPointId, crash.pluginId, crash.contributionId]);
    capturedCrashCounts.set(identity, (capturedCrashCounts.get(identity) ?? 0) + 1);
  }

  const snapshot: ExtensionDiagnosticSnapshot = {
    schemaVersion: 1, capturedAt: new Date().toISOString(), windowName: text(options.windowName),
    points: [], pending: [], plugins: [], problems: [], coverage: options.windowName ? [...COVERAGE] : ['Runtime window identity is unavailable; capture export and actions are disabled.', ...COVERAGE],
    limits: { quarantineCrashThreshold: debug.config.quarantineCrashThreshold, maxCrashRecordsPerContribution: debug.config.maxCrashRecordsPerContribution },
    truncated: false,
  };
  const observedStores = registry.listExtensionPoints().map(id => {
    const store = registry.getExtensionPoint(id);
    return { id, store, version: store?.version };
  });
  const observedPlugins = Object.entries(debug.plugins).map(([id, plugin]) => [id, plugin.loadedAt] as const);
  snapshotGuards.set(snapshot, () => {
    const current = service.getDebugSnapshot();
    return registry.listExtensionPoints().length === observedStores.length
      && observedStores.every(({ id, store, version }) => registry.getExtensionPoint(id) === store && store?.version === version)
      && Object.keys(current.plugins).length === observedPlugins.length
      && observedPlugins.every(([id, loadedAt]) => current.plugins[id]?.loadedAt === loadedAt);
  });
  const problem = (value: DiagnosticProblem) => {
    if (take()) {
      snapshot.problems.push(value);
    } 
  };

  for (const id of registry.listExtensionPoints()) {
    if (!take()) {
      break;
    }

    const store = registry.getExtensionPoint(id);
    if (!store) {
      continue;
    }

    const point = { id: text(id), owner: text(store.pluginId, 'unknown'), mode: store.mode, version: store.version, contributions: [] as ExtensionDiagnosticSnapshot['points'][number]['contributions'] };
    for (const entry of store.listAll()) {
      if (!take()) {
        break;
      }

      const rawId = data(entry, 'id');
      const rawPluginId = data(entry, 'plugin');
      const identity = typeof rawId === 'string' && typeof rawPluginId === 'string' ? JSON.stringify([id, rawPluginId, rawId]) : undefined;
      const record = identity ? records.get(identity) : undefined;
      point.contributions.push({
        id: text(rawId), pluginId: text(rawPluginId), label: text(data(entry, 'label')),
        source: text(record?.source, 'registry'), valueType: typeof data(entry, 'value'),
        ...(record?.resourceKey === undefined ? {} : { resourceKey: text(record.resourceKey) }),
        status: identity && quarantined.has(identity) ? 'quarantined' : 'registered',
        crashCount: identity ? Math.max(record?.crashCount ?? 0, quarantined.get(identity) ?? 0, capturedCrashCounts.get(identity) ?? 0) : 0,
      });
    }

    snapshot.points.push(point);
  }

  for (const [pluginId, plugin] of Object.entries(debug.plugins)) {
    if (!take()) {
      break;
    }

    const warnings: string[] = [];
    for (const warning of plugin.dependencyWarnings) {
      if (!take()) {
        break;
      }

      const message = options.includeSensitive ? text(warning) : 'Declared dependency is unavailable.';
      warnings.push(message);
      problem({ id: `dependency:${text(pluginId)}:${warnings.length}`, kind: 'dependency-warning', pluginId: text(pluginId), message });
    }

    snapshot.plugins.push({ id: text(pluginId), phase: text(plugin.phase), warnings, ...(plugin.error ? { error: detail(plugin.error) } : {}) });
    if (Boolean(plugin.error) || plugin.phase === 'error') {
      problem({ id: `plugin:${text(pluginId)}`, kind: 'plugin-error', pluginId: text(pluginId), message: detail(plugin.error) });
    }
  }

  for (const entries of Object.values(debug.pendingContributions)) {
    for (const entry of entries) {
      if (!take()) {
        break;
      }

      const pending = { id: text(entry.contributionId), pluginId: text(entry.pluginId), pointId: text(entry.extensionPointId), source: text(records.get(JSON.stringify([entry.extensionPointId, entry.pluginId, entry.contributionId]))?.source, 'unknown'), status: 'pending-target' as const };
      snapshot.pending.push(pending);
      problem({ id: text(JSON.stringify(['pending', entry.extensionPointId, entry.pluginId, entry.contributionId])), kind: 'pending-target', pluginId: pending.pluginId, pointId: pending.pointId, contributionId: pending.id, message: 'Target extension point is not registered.' });
    }
  }

  for (const record of debug.quarantinedContributions) {
    problem({ id: text(JSON.stringify(['quarantine', record.extensionPointId, record.pluginId, record.contributionId])), kind: 'quarantined', pluginId: text(record.pluginId), pointId: text(record.extensionPointId), contributionId: text(record.contributionId), message: 'Contribution was quarantined after repeated crashes.', crashCount: record.crashCount, timestamp: record.quarantinedAt });
    if (rows >= MAX_ROWS) {
      break;
    }
  }

  for (const [index, crash] of debug.recentCrashes.entries()) {
    problem({ id: `crash:${index}:${text(crash.contributionId)}`, kind: 'render-error', pluginId: text(crash.pluginId), pointId: text(crash.extensionPointId), contributionId: text(crash.contributionId), message: detail(crash.errorMessage), boundary: text(crash.boundary), timestamp: crash.timestamp,
      ...(options.includeSensitive ? { stack: text(crash.stack), componentStack: text(crash.componentStack) } : {}) });
    if (rows >= MAX_ROWS) {
      break;
    }
  }

  snapshot.truncated = truncated || rows >= MAX_ROWS;
  return freeze(snapshot);
}

export function filterExtensionSnapshot(snapshot: ExtensionDiagnosticSnapshot, filter: DiagnosticFilter): ExtensionDiagnosticSnapshot {
  const query = filter.query?.toLocaleLowerCase().trim();
  const search = (...values: Array<string | undefined>) => !query || values.some(value => value?.toLocaleLowerCase().includes(query));
  const matches = (pluginId: string, pointId?: string) => (!filter.pluginId || pluginId === filter.pluginId) && (!filter.pointId || pointId === filter.pointId);
  const scopedProblems = snapshot.problems.filter(problem => matches(problem.pluginId, problem.pointId));
  const issues = new Set(scopedProblems.flatMap(problem => problem.contributionId ? [JSON.stringify([problem.pointId, problem.pluginId, problem.contributionId])] : []));
  const issuePlugins = new Set(scopedProblems.filter(problem => !problem.contributionId).map(problem => problem.pluginId));
  const points = snapshot.points.flatMap(point => {
    if (filter.pointId && point.id !== filter.pointId) {
      return [];
    }

    const ancestorMatches = search(point.id, point.owner);
    const contributions = point.contributions.filter(entry => matches(entry.pluginId, point.id)
      && (!filter.issuesOnly || issues.has(JSON.stringify([point.id, entry.pluginId, entry.id])) || issuePlugins.has(entry.pluginId))
      && (ancestorMatches || search(entry.id, entry.pluginId, entry.label, entry.resourceKey, entry.source)));
    return contributions.length || (!filter.pluginId && !filter.issuesOnly && ancestorMatches) ? [{ ...point, contributions }] : [];
  });
  const pending = snapshot.pending.filter(entry => matches(entry.pluginId, entry.pointId) && search(entry.id, entry.pluginId, entry.pointId, entry.source));
  const problems = scopedProblems.filter(problem => search(problem.id, problem.pluginId, problem.pointId, problem.message, problem.contributionId));
  const plugins = snapshot.plugins.filter(plugin => (!filter.pluginId || filter.pluginId === plugin.id)
    && (!filter.issuesOnly || scopedProblems.some(problem => problem.pluginId === plugin.id))
    && (!filter.pointId || points.some(point => point.contributions.some(entry => entry.pluginId === plugin.id)) || pending.some(entry => entry.pluginId === plugin.id) || problems.some(problem => problem.pluginId === plugin.id))
    && search(plugin.id, plugin.phase, ...plugin.warnings));
  const filtered = freeze({ ...snapshot, points, pending, plugins, problems });
  const guard = snapshotGuards.get(snapshot);
  if (guard) {
    snapshotGuards.set(filtered, guard);
  }

  return filtered;
}

export function lookupExtensionContext(registry: ExtensionPointRegistryContract, service: DiagnosticService, request: DiagnosticLookupRequest, windowName: string): DiagnosticLookupResult {
  if (request.pointId !== RESOURCE_SIDEBAR_EXTENSION_POINT_ID && request.pointId !== RESOURCE_DRAWER_EXTENSION_POINT_ID) {
    throw new Error('Context lookup supports only builtin resource sidebar and drawer extension points.');
  }

  if (![request.pluginId, request.resourceKey, windowName].every(value => typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT)) {
    throw new Error('Lookup requires bounded plugin, resource, and window identifiers.');
  }

  const store = registry.getExtensionPoint<unknown, ResourceExtensionRenderContext>(request.pointId);
  if (!store) {
    throw new Error('Requested extension point is not registered.');
  }

  const quarantine = new Set(service.getDebugSnapshot().quarantinedContributions.map(record => JSON.stringify([record.extensionPointId, record.pluginId, record.contributionId])));
  let selected;
  try {
    // Omit the optional cache key so every explicit lookup observes current matcher state.
    selected = store.list({ pluginId: request.pluginId, resourceKey: request.resourceKey });
  } catch {
    throw new Error('Context matcher failed. Exception details are redacted.'); 
  }

  if (selected.length > 16) {
    throw new Error('Context lookup exceeded the contribution limit.');
  }

  return freeze({ schemaVersion: 1, capturedAt: new Date().toISOString(), windowName,
    pointId: request.pointId, pluginId: request.pluginId, resourceKey: request.resourceKey,
    inventoryCount: store.listAll().length,
    selected: selected.map(entry => {
      const id = data(entry, 'id');
      const pluginId = data(entry, 'plugin');
      return { id: typeof id === 'string' ? id.slice(0, MAX_TEXT) : '', pluginId: typeof pluginId === 'string' ? pluginId.slice(0, MAX_TEXT) : '', quarantined: typeof id === 'string' && typeof pluginId === 'string' && quarantine.has(JSON.stringify([request.pointId, pluginId, id])) };
    }), coverage: ['Explicit matcher selection only; components are not mounted.', ...COVERAGE],
  });
}

export function recoverExtensionContribution(registry: ExtensionPointRegistryContract, service: DiagnosticService, contributionId: string, expectedSnapshot?: ExtensionDiagnosticSnapshot, windowName = expectedSnapshot?.windowName ?? '') {
  if (expectedSnapshot) {
    assertDiagnosticSnapshotCurrent(expectedSnapshot);
  }

  const snapshot = captureExtensionSnapshot(registry, service, { windowName });
  assertDiagnosticSnapshotCurrent(snapshot);
  const identities = new Set<string>();
  for (const point of snapshot.points) {
    for (const entry of point.contributions) {
      if (entry.id === contributionId) {
        identities.add(JSON.stringify([point.id, entry.pluginId, entry.id]));
      }
    }
  }

  for (const entry of snapshot.pending) {
    if (entry.id === contributionId) {
      identities.add(JSON.stringify([entry.pointId, entry.pluginId, entry.id]));
    }
  }

  for (const problem of snapshot.problems) {
    if (problem.contributionId === contributionId) {
      identities.add(JSON.stringify([problem.pointId, problem.pluginId, contributionId]));
    }
  }

  // The lifecycle service's recovery API is ID-only. Never clear another tuple's state.
  if (identities.size !== 1) {
    throw new Error('Recovery requires an unambiguous contribution ID across all extension points and plugins.');
  }

  if (!snapshot.problems.some(problem => problem.kind === 'quarantined' && problem.contributionId === contributionId)) {
    throw new Error('Selected contribution is no longer quarantined.');
  }

  service.unquarantine(contributionId);
}
