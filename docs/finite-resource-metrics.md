# Add metrics to a plugin view

Show resource measurements with a runtime hook and a base-ui component. Omniview handles fetching, shared requests, refreshes, and cleanup.

Resource plugins declare metric IDs, default mappings, and approved public scope. Source providers execute queries. The host shares work without knowing resource kinds.

[Show a metric](#1-show-pod-cpu) · [Show multiple resources](#2-show-multiple-resources) · [Remember settings](#3-remember-view-settings) · [Overlay object attributes](#4-overlay-object-attributes) · [API reference](#api-reference)

## Before you start

- Use a workspace containing the new runtime and base-ui metrics components.
- Connect the resource-owning plugin. The Kubernetes examples below use metrics-server or a configured Grafana/Prometheus source.
- Get resource targets from the resource view, not from names or copied resource JSON.

| Owner | Responsibility |
| --- | --- |
| Resource plugin | Metric definitions, identity field paths, and approved scope fields |
| Source provider | Authentication, query execution, and result joins |
| Host | Admission, scheduling, shared requests, and persistence |

## 1. Show Pod CPU

This component displays one Pod's CPU usage and refreshes every 30 seconds.

```tsx
import { Button } from '@omniviewdev/base-ui';
import { MetricPanel, MetricValue, type MetricPanelState } from '@omniviewdev/base-ui/metrics';
import { useMetricObservation, type ResourceMetricTarget } from '@omniviewdev/runtime';

export function PodCPU({ connectionID, target }: {
  connectionID: string;
  target: ResourceMetricTarget;
}) {
  const metrics = useMetricObservation({
    ownerPluginID: 'kubernetes',
    ownerConnectionID: connectionID,
    resourceKey: 'k8s:/pods',
    targets: [target],
    metricIDs: ['kubernetes.pod.cpu.usage'],
    intervalMs: 30_000,
  });
  const sample = metrics.results[0];
  const unavailable = sample && !['ok', 'missing'].includes(sample.status);
  const state: MetricPanelState = sample?.status === 'ok'
    ? { kind: 'data', updating: metrics.isFetching, freshness: sample.freshness,
        notice: metrics.error ? { tone: 'warning', label: 'Refresh failed' } : undefined }
    : metrics.isLoading ? { kind: 'initial' }
    : metrics.error ? { kind: 'error', message: metrics.error.message }
    : unavailable ? { kind: 'error', message: sample.message || 'CPU unavailable' }
    : { kind: 'empty', message: sample?.message || 'No CPU sample' };

  return <MetricPanel title="CPU usage" state={state} actions={
    <Button onClick={() => { void metrics.refresh(); }}>Refresh</Button>
  }>
    {sample?.status === 'ok' && sample.unit &&
      <MetricValue value={sample.value} unit={sample.unit} />}
  </MetricPanel>;
}
```

**Where does `target` come from?** Use the `HostRecord` supplied by the resource view:

```ts
const target: ResourceMetricTarget = {
  token: record.key,
  reference: record.record.reference,
  route: record.route,
};
```

`token` matches a result to your row. `reference` and `route` identify the observed resource and its connection; keep them intact.

## 2. Show multiple resources

Pass the visible rows in **one hook call**, rather than mounting a fetching hook in every cell:

```ts
const metrics = useMetricObservation({
  ownerPluginID: 'kubernetes',
  ownerConnectionID: connectionID,
  resourceKey: 'k8s:/pods',
  targets: visibleTargets,
  metricIDs: ['kubernetes.pod.cpu.usage', 'kubernetes.pod.memory.working_set'],
  intervalMs: 30_000,
});
```

Match each result using `resourceToken` and `metricID`. Compatible table and sidebar requests can share host collection work. No extra polling timer or query cache is needed in your plugin.

Use `useMetricCatalog` for available metric choices. An observation's catalog describes its admitted samples, not the complete discovery list.

The host reuses recent compatible results across views; refresh bypasses that reuse. Original sample times stay unchanged.

- Source changes refresh only the affected catalogs.
- Temporary collection failures keep authorized samples visible and report the error.
- Permission, source, or configuration changes clear incompatible data. Failed setup never grants permission to reuse old data.

### Virtualized tables

Use `useTableMetricObservation` once in the owning table and share its returned
`TableMetricObservation` through your view's context. This headless hook works
with any resource owner; it has no Kubernetes, column, or component dependencies.

```tsx
import { useEffect } from 'react';
import { MetricValue } from '@omniviewdev/base-ui/metrics';
import { useTableMetricObservation, type TableMetricObservation } from '@omniviewdev/runtime';

// In the owning table, using its current admitted HostRecord membership:
const batch = useTableMetricObservation({
  ownerPluginID,
  ownerConnectionID,
  resourceKey,
  recordsByBody,
  metricIDs,
  source,
  enabled: catalogReady,
  loading: catalogLoading,
  error: catalogError,
});

// Each mounted cell consumes the shared batch, not another observation hook.
function CurrentCell({ body, metricID, batch }: {
  body: object;
  metricID: string;
  batch: TableMetricObservation;
}) {
  useEffect(() => batch.register(body), [batch.register, body]);
  const token = batch.tokenFor(body);
  const sample = token ? batch.metrics.get(token)?.get(metricID) : undefined;
  if (sample?.status === 'ok' && sample.unit) return <MetricValue value={sample.value} unit={sample.unit} />;
  return batch.isLoadingFor(body, metricID) ? <span role="status">Loading…</span> : <span>—</span>;
}
```

`recordsByBody` is the owning table's `WeakMap<object, HostRecord>`. Presentation
bodies select membership; only the admitted record supplies the token, reference,
and route. Unknown bodies do not produce targets. Multiple metric cells for one
body share one target until the last registration is cleaned up. Replace the map
whenever records or membership change; never mutate it in place.

Ask `isLoadingFor(body, metricID)` for each cell. It is `true` while an admitted
cell for a selected metric has no sample and an answer is still expected: its
registration awaits publication, the document is hidden, or its request has not
answered. It is `false` once the cell holds any sample (unavailable and failed
samples are answers), once the request settled without one, after an error, and
when the cell can never be collected: disabled collection, an unselected metric,
or a body the table did not admit. `loading` keeps such cells pending while
source/catalog discovery runs. A new row therefore shows loading beside samples
that are already displayed, never an unavailable value, and a settled empty cell
does not spin again during background refresh. The returned function changes
whenever any cell's answer can change, so memoized cells re-render. `isLoading`
is only the table-level aggregate: upstream discovery, or a published request
that has answered nothing yet.

The runtime publishes target membership after 120 milliseconds without changes,
and no later than 250 milliseconds after the first unpublished change, so
continuous scrolling still publishes. Until then the published targets stay in
force. When the table replaces `recordsByBody` and the bodies it replaced, rows
keep their samples and the host keeps the same observation until the replacement
bodies publish. Retained targets never cross a change of plugin, connection, or
resource type, and a source change still clears samples at once. A recreated
resource keeps its host token with a new incarnation: `tokenFor` returns
`undefined` while only the previous incarnation's samples are held for that
token, so a cell never shows the previous resource's value. The timers stop
when the owning table unmounts, whichever order React cleans up the table and
its cells, and a StrictMode replay re-arms the demand that was still
unpublished.

Collection pauses while the document is hidden, and prepared results are indexed
by host token and metric ID. `loading` and `error` describe upstream
source/catalog discovery; upstream errors block collection and loading.
`isFetching` and `refresh()` retain the underlying observation's meaning.
`intervalMs` defaults to 30,000; set it to zero for initial/manual collection only.
The timers batch view demand, not provider polling. The host still owns
admission, scheduling, shared work, and result reuse.

Keep column selection, source preferences, headers, bounds, and rendering in the
owning view. Source-provider endpoint failure handling remains provider-specific;
this hook adds neither a provider cache nor an SDK retry policy.

| Pod metric | ID | Value returned |
| --- | --- | --- |
| CPU usage | `kubernetes.pod.cpu.usage` | Cores |
| Memory working set | `kubernetes.pod.memory.working_set` | Bytes |

Node views use `k8s:/nodes` with `kubernetes.node.cpu.usage` and `kubernetes.node.memory.working_set`. Native Pod and Node metrics support `current` only. External mappings declare their own applicability and supported shapes.

Let base-ui format the value. Missing measurements are `null`, not zero. Read supported shapes from the catalog; native sources can support history too.

## 3. Remember view settings

Import `useMetricViewPreferences` from `@omniviewdev/runtime` and call it inside your metrics component:

```ts
const view = useMetricViewPreferences('kubernetes', 'k8s:/pods', {
  metric_ids: ['kubernetes.pod.cpu.usage', 'kubernetes.pod.memory.working_set'],
  layout: 'grid',
});
```

Pass `view.preferences.metric_ids` to the observation hook to use the saved selection.

In an async event handler, save only the fields that changed:

```ts
await view.update({ layout: 'stack' });
```

For a change based on the previous selection, use a function:

```ts
await view.update(current => ({
  metric_ids: current.metric_ids.filter(id => id !== 'kubernetes.pod.memory.working_set'),
}));
```

Settings follow the resource type across Pods, tabs, and restarts in the same profile. An intentionally empty selection stays empty. Defaults apply only before the first save.

Display `view.error` when a save fails, and handle the rejected promise in your event handler. The hook handles storage and conflicting saves; your component does not manage revision numbers.

### Configure a source separately

Add a Grafana connection in **Settings → Metrics**. Select its datasource in the resource connection's **Metrics** settings. Connection mappings override global defaults without copying them.

For a source picker in your view, import `useMetricViewSourceSelection`:

```ts
const source = useMetricViewSourceSelection('kubernetes', connectionID, 'k8s:/pods');

// Call from the picker's async event handler.
await source.update('external', {
  plugin_id: 'grafana',
  connection_id: grafanaConnectionID,
  datasource_uid: 'prometheus',
  datasource_kind: 'prometheus',
});
```

Use `source.update('native')` for the resource owner's built-in source or `source.update('inherit')` for connection/global defaults. Show `source.error` if saving fails.

### Show history

Choose a range-capable source, then add these options to `useMetricObservation`:

```ts
shape: 'range',
durationMs: 3_600_000, // Moving last hour.
stepMs: 15_000,
```

The host advances the range on each refresh. For a fixed window, use `startTime` and `endTime` instead of `durationMs`. Kubernetes metrics-server has no history.

See the [host reference](finite-resource-metrics-reference.md) for source precedence, permissions, and collection limits.

## 4. Overlay object attributes

Pass numeric references alongside your existing measurements. Your plugin reads the typed resource body; base-ui draws the overlay. No additional metric request is needed.

For example, `volume` is the admitted resource body, with optional numeric byte quantities:

```tsx
import { TimeSeriesChart, type MetricReference } from '@omniviewdev/base-ui/metrics';

const references: readonly MetricReference[] = [
  { kind: 'line', id: 'request', label: 'Request',
    value: volume.spec?.requestedBytes, lineStyle: 'dashed',
    source: 'Current resource configuration' },
  { kind: 'line', id: 'limit', label: 'Limit',
    value: volume.spec?.limitBytes, lineStyle: 'dotted',
    source: 'Current resource configuration' },
];

<TimeSeriesChart label="Storage used" series={series} domain={domain}
  unit={{ kind: 'bytes', display: 'binary' }} references={references} />;
```

Use the same `references` prop on stacked charts, capacity bars, compact metric cells, gauges, and ranked bars. `MetricValue` shows a compact summary without inventing a numeric scale, so value-only views keep the same context.

| Reference | Fields |
| --- | --- |
| Line | `kind: 'line'`, `id`, `label`, `value` |
| Band | `kind: 'band'`, `id`, `label`, `from`, `to` |
| Optional presentation | `tone`, `lineStyle`, `source` |

- **Use base units.** Byte references remain bytes even when the axis displays MiB. CPU references follow the component's declared cores/millicores base.
- **Keep missing values missing.** Undefined, null, and non-finite values are omitted; real zero remains visible. Resource plugins decide effective aggregation and whether a partial limit is meaningful.
- **Keep bounds honest.** Automatic chart bounds include references. Explicit domains stay pinned. Capacity percentages still require a real positive `bound`.
- **Describe current configuration.** Object-derived references update with the resource, not the metric query. They do not reconstruct historical requests, limits, or quotas.

## API reference

### `useMetricObservation(options)`

| Option | Purpose | Default |
| --- | --- | --- |
| `ownerPluginID`, `ownerConnectionID` | Plugin and connection that own the admitted resources | Required |
| `resourceKey` | Resource type, such as `k8s:/pods` | Required |
| `targets` | Observed resources to measure | Required |
| `metricIDs` | Measurements to request | Required |
| `bindingID`, `source` | Owner binding or explicit typed source override | Inherit saved view/binding/profile choice |
| `intervalMs` | Automatic refresh interval, in milliseconds | `0`: initial/manual only |
| `enabled` | Pause collection when `false` | `true` |
| `shape` | Live values (`current`) or history (`range`) | `current` |
| `durationMs` | Moving relative range, without absolute bounds | Range-capable sources only |
| `startTime`, `endTime`, `stepMs` | Fixed range bounds and positive step; relative ranges also require step | Range-capable sources only |

An empty target or metric list disables collection. Each source catalog declares whether a metric supports `current`, `range`, or both.

| Returned field | Use it to… |
| --- | --- |
| `results` | Render prepared values, units, and source timestamps |
| `catalog` | Discover the selected source's metrics and capabilities |
| `isLoading` | Show initial loading, including an incomplete empty frame while collection continues |
| `isFetching` | Show a refresh without clearing existing data |
| `error` | Report a collection failure |
| `refresh()` | Request an immediate refresh |
| `domain` | Read the displayed history range, when available |
| `stepMs` | Use the resolution of displayed history, not a pending replacement request |
| `isPartial` | Indicate that displayed data is incomplete; check `isFetching` separately for active collection |

Range progress keeps data, domain and step together. A partial update does not
erase selected numeric samples from the same source inside the requested window.
Until non-regressing progress arrives, that history keeps its original domain
and step. Another Pod's history does not block a new selection's partial frame,
even when the resolution changes. A metric's source change clears only that
metric's incompatible history; unchanged metrics retain their displayed domain
and step. An absent pair in an incomplete frame is pending, not proof of a
missing source sample. A final incomplete frame remains partial without staying
busy.

### `useMetricViewPreferences(pluginID, resourceKey, defaults?)`

Returns `preferences`, `isLoading`, `error`, and `update(patchOrFunction)`.

| Preference | Example |
| --- | --- |
| Visible metrics and their order | `metric_ids: ['kubernetes.pod.cpu.usage']` |
| Layout | `layout: 'grid'` or `'stack'` |
| Per-metric display | `displays: { 'kubernetes.pod.cpu.usage': 'capacity' }` |
| Expanded details | `details: { 'kubernetes.pod.cpu.usage': true }` |
| Relative time selection | `time_mode: 'relative', duration_ms: 3_600_000` |
| Absolute time selection | `time_mode: 'absolute', start_ms, end_ms` |

Preferences save choices; your view renders them. They do not add history or capacity data to a source.

## Go deeper

- **Writing a backend provider?** Start with the [SDK provider guide](https://github.com/omniviewdev/plugin-sdk/blob/main/docs/finite-resource-metrics.md).
- **Maintaining the host?** See [limits, permissions, timestamps, and transport lifecycle](finite-resource-metrics-reference.md).
