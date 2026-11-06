# Add metrics to a plugin view

Show resource measurements with a runtime hook and a base-ui component. Omniview handles fetching, shared requests, refreshes, and cleanup.

**Available now:** live Pod and Node CPU/memory from Kubernetes metrics-server, plus configured Grafana or direct Prometheus-compatible sources with finite current and range queries. Source catalogs declare the supported metrics and shapes.

[Show a metric](#1-show-pod-cpu) · [Show multiple resources](#2-show-multiple-resources) · [Remember settings](#3-remember-view-settings) · [API reference](#api-reference)

## Before you start

- Use a workspace containing the new runtime and base-ui metrics components.
- Connect a Kubernetes cluster for resource ownership. Use metrics-server for native live values, or configure an external source for mapped current/range values.
- Get resource targets from the resource view, not from names or copied Pod JSON.

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

| Pod metric | ID | Value returned |
| --- | --- | --- |
| CPU usage | `kubernetes.pod.cpu.usage` | Cores |
| Memory working set | `kubernetes.pod.memory.working_set` | Bytes |

Node views use `k8s:/nodes` with `kubernetes.node.cpu.usage` and `kubernetes.node.memory.working_set`. Native Pod and Node metrics support `current` only. External mappings declare their own applicability and supported shapes.

Let base-ui format the value. Missing measurements are `null`, not zero. Native metrics are live values, not a time-series history.

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

Add a Grafana connection in **Settings → Metrics**. Select its datasource in the cluster's **Metrics** settings. Cluster mappings override global defaults without copying them.

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

Use `source.update('native')` for metrics-server or `source.update('inherit')` for cluster/global defaults. Show `source.error` if saving fails.

### Show history

Choose a range-capable source, then add these options to `useMetricObservation`:

```ts
shape: 'range',
durationMs: 3_600_000, // Moving last hour.
stepMs: 15_000,
```

The host advances the range on each refresh. For a fixed window, use `startTime` and `endTime` instead of `durationMs`. Native metrics-server has no history.

See the [host reference](finite-resource-metrics-reference.md) for source precedence, permissions, and collection limits.

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

An empty target or metric list disables collection. Native metrics-server supports `current` only; selected external mappings can also support `range`.

| Returned field | Use it to… |
| --- | --- |
| `results` | Render prepared values, units, and source timestamps |
| `catalog` | Discover the selected source's metrics and capabilities |
| `isLoading` | Show the initial loading state |
| `isFetching` | Show a refresh without clearing existing data |
| `error` | Report a collection failure |
| `refresh()` | Request an immediate refresh |
| `domain` | Read the displayed history range, when available |

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

- **Writing a backend provider?** Start with the [SDK provider guide](https://github.com/omniviewdev/plugin-sdk/blob/feature/metrics-native-cutover-20261105-f0ad9ab1/docs/finite-resource-metrics.md).
- **Maintaining the host?** See [limits, permissions, timestamps, and transport lifecycle](finite-resource-metrics-reference.md).
