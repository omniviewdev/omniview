// Short presentation names for known instruments. Raw OTel descriptions stay in Details.
const titles: Readonly<Record<string, string>> = {
  'omniview.process.cpu_time': 'CPU',
  'omniview.process.go_heap_bytes': 'Heap',
  'omniview.process.goroutines': 'Goroutines',
  'omniview.process.memory_peak_rss': 'Peak memory',
  'omniview.plugin.process.cpu_time': 'Plugin CPU',
  'omniview.plugin.process.memory_rss': 'Plugin memory',
  'omniview.plugin.active': 'Plugins loaded',
  'omniview.plugin.load_duration': 'Plugin load time',
  'omniview.plugin.crashes': 'Plugin crashes',
  'omniview.plugin.quarantines': 'Plugin quarantines',
  'omniview.plugin.diagnostics.status': 'Plugin metrics status',
  'omniview.plugin.self.api.calls': 'Plugin API calls',
  'omniview.plugin.self.api.duration': 'Plugin API latency',
  'omniview.plugin.self.watch.streams': 'Plugin open watches',
  'omniview.plugin.self.connection.checks': 'Plugin connection checks',
  'omniview.plugin.self.portforward.sessions': 'Plugin port-forwards',
  'omniview.resource.watches_active': 'Active watches',
  'omniview.resource.op_duration': 'Resource latency',
  'omniview.resource.op_errors': 'Resource errors',
  'omniview.resource.records': 'Records returned',
  'omniview.operation.calls': 'Operations',
  'omniview.operation.active': 'Running operations',
  'omniview.metric.pipeline.state': 'Pipeline state',
  'omniview.metric.pipeline.state_bytes': 'Pipeline memory',
  'omniview.metric.pipeline.events': 'Pipeline events',
  'omniview.metric.pipeline.queue_duration': 'Queue wait',
  'omniview.metric.pipeline.provider_duration': 'Provider latency',
  'omniview.metric.pipeline.work': 'Work dispatched',
  'omniview.metric.pipeline.response_bytes': 'Response size',
  'go.memory.used': 'Go memory',
  'go.memory.allocated': 'Allocated',
  'go.memory.allocations': 'Allocations',
  'go.memory.gc.goal': 'GC target',
  'go.goroutine.count': 'Go goroutines',
  'go.processor.limit': 'Processors',
  'go.config.gogc': 'GOGC',
  'rpc.client.call.duration': 'Plugin RPC latency',
};

export function metricTitle(name: string): string {
  const known = titles[name];
  if (known !== undefined) {
    return known;
  }

  const words = name.replace(/^(omniview|go)\./, '').split(/[._]/).filter(Boolean).join(' ');
  return words === '' ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

export function dimensionLabel(attributes: Readonly<Record<string, string | undefined>> | undefined): string {
  const values = Object.values(attributes ?? {}).filter((value): value is string => value !== undefined && value !== '');
  return values.join(' · ');
}

export function comparisonArea(name: string): string {
  if (name.includes('cpu')) {
    return 'CPU';
  }

  if (name.includes('memory') || name.includes('heap') || name.includes('allocat')) {
    return 'Memory';
  }

  if (name.startsWith('rpc.')) {
    return 'Plugin RPC';
  }

  if (name.includes('pipeline')) {
    return 'Pipeline';
  }

  return 'Other';
}
