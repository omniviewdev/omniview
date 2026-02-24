package metric

import (
	"github.com/omniviewdev/plugin-sdk/pkg/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

// Register registers the metric capability with the Kubernetes plugin.
// It creates a composite QueryFunc that routes to metrics-server for built-in
// metrics and to Prometheus for prom_* prefixed metrics.
func Register(plugin *sdk.Plugin) {
	promClient := newPrometheusClient(plugin.SettingsProvider)

	metric.RegisterPlugin(plugin, metric.PluginOpts{
		ProviderInfo: metric.ProviderInfo{
			ID:          "k8s-metrics",
			Name:        "Kubernetes Metrics",
			Icon:        "SiKubernetes",
			Description: "Kubernetes metrics from metrics-server and Prometheus",
		},
		Handlers: map[string]metric.Handler{
			// --- Pod metrics (metrics-server + Prometheus) ---
			"core::v1::Pod": {
				Resource: "core::v1::Pod",
				Metrics: []metric.MetricDescriptor{
					// ── metrics-server (instant only) ──
					{
						ID:              "cpu_usage",
						Name:            "CPU Usage",
						Unit:            metric.UnitMillicores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "memory_usage",
						Name:            "Memory Usage",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},

					// ── CPU (Prometheus, time-series) ──
					{
						ID:              "prom_cpu_usage_rate",
						Name:            "CPU Usage Rate",
						Unit:            metric.UnitCores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU",
					},
					{
						ID:              "prom_cpu_throttle_rate",
						Name:            "CPU Throttle Rate",
						Unit:            metric.UnitPercentage,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU Throttle",
					},

					// ── Memory (Prometheus, time-series) ──
					{
						ID:              "prom_memory_working_set",
						Name:            "Memory Working Set",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory",
					},
					{
						ID:              "prom_memory_rss",
						Name:            "Memory RSS",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory",
					},
					{
						ID:              "prom_memory_cache",
						Name:            "Memory Cache",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory",
					},
					{
						ID:              "prom_memory_max",
						Name:            "Memory Max Usage",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},

					// ── Network (Prometheus, time-series) ──
					{
						ID:              "prom_network_receive_rate",
						Name:            "Network Receive",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuArrowDown",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Network",
					},
					{
						ID:              "prom_network_transmit_rate",
						Name:            "Network Transmit",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuArrowUp",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Network",
					},

					// ── Disk I/O (Prometheus, time-series) ──
					{
						ID:              "prom_disk_read_bytes",
						Name:            "Disk Read Throughput",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk I/O",
					},
					{
						ID:              "prom_disk_write_bytes",
						Name:            "Disk Write Throughput",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk I/O",
					},
					{
						ID:              "prom_disk_read_iops",
						Name:            "Disk Read IOPS",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk IOPS",
					},
					{
						ID:              "prom_disk_write_iops",
						Name:            "Disk Write IOPS",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk IOPS",
					},
					{
						ID:              "prom_fs_usage",
						Name:            "Filesystem Usage",
						Unit:            metric.UnitBytes,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Storage",
					},

					// ── Process (Prometheus, time-series) ──
					{
						ID:              "prom_threads",
						Name:            "Threads",
						Unit:            metric.UnitCount,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Threads",
					},

					// ── Page faults (Prometheus, time-series) ──
					{
						ID:              "prom_page_faults",
						Name:            "Page Faults",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Page Faults",
					},
					{
						ID:              "prom_major_page_faults",
						Name:            "Major Page Faults",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Page Faults",
					},

					// ── Resource requests & limits (kube-state-metrics, time-series) ──
					// These are overlays for the CPU chart
					{
						ID:              "prom_cpu_request",
						Name:            "CPU Request",
						Unit:            metric.UnitCores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU",
					},
					{
						ID:              "prom_cpu_limit",
						Name:            "CPU Limit",
						Unit:            metric.UnitCores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU",
					},
					// These are overlays for the Memory chart
					{
						ID:              "prom_memory_request",
						Name:            "Memory Request",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory",
					},
					{
						ID:              "prom_memory_limit",
						Name:            "Memory Limit",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory",
					},

					// ── Resource efficiency (derived, time-series) ──
					{
						ID:              "prom_cpu_pct_request",
						Name:            "CPU % of Request",
						Unit:            metric.UnitPercentage,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU % of Request",
					},
					{
						ID:              "prom_memory_pct_request",
						Name:            "Memory % of Request",
						Unit:            metric.UnitPercentage,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory % of Request",
					},

					// ── Lifecycle (instant + time-series for restarts trend) ──
					{
						ID:              "prom_restart_count",
						Name:            "Container Restarts",
						Unit:            metric.UnitCount,
						Icon:            "LuRotateCcw",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Restarts",
					},
					{
						ID:              "prom_oom_killed_count",
						Name:            "OOM Kills",
						Unit:            metric.UnitCount,
						Icon:            "LuAlertTriangle",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_pod_uptime",
						Name:            "Uptime",
						Unit:            metric.UnitSeconds,
						Icon:            "LuClock",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},

					// ── Probe health (kubelet, instant) ──
					{
						ID:              "prom_probe_success_rate",
						Name:            "Probe Success Rate",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_probe_avg_latency",
						Name:            "Probe Avg Latency",
						Unit:            metric.UnitSeconds,
						Icon:            "LuClock",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},

					// ── Storage (kubelet, instant) ──
					{
						ID:              "prom_log_fs_used",
						Name:            "Log Filesystem Used",
						Unit:            metric.UnitBytes,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
				},
			},
			// --- Node metrics (metrics-server + Prometheus) ---
			"core::v1::Node": {
				Resource: "core::v1::Node",
				Metrics: []metric.MetricDescriptor{
					// metrics-server (instant only)
					{
						ID:              "cpu_usage",
						Name:            "CPU Usage",
						Unit:            metric.UnitMillicores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "cpu_capacity",
						Name:            "CPU Capacity",
						Unit:            metric.UnitMillicores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "memory_usage",
						Name:            "Memory Usage",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "memory_capacity",
						Name:            "Memory Capacity",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					// Prometheus (time-series capable)
					{
						ID:              "prom_cpu_utilization",
						Name:            "CPU Utilization",
						Unit:            metric.UnitPercentage,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU Utilization",
					},
					{
						ID:              "prom_memory_utilization",
						Name:            "Memory Utilization",
						Unit:            metric.UnitPercentage,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory Utilization",
					},
					{
						ID:              "prom_network_receive_rate",
						Name:            "Network Receive",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuArrowDown",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Network",
					},
					{
						ID:              "prom_network_transmit_rate",
						Name:            "Network Transmit",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuArrowUp",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Network",
					},
					// Prometheus (instant only)
					{
						ID:              "prom_memory_total",
						Name:            "Memory Total",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					// Prometheus (instant + timeseries)
					{
						ID:              "prom_disk_utilization",
						Name:            "Disk Utilization",
						Unit:            metric.UnitPercentage,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk Utilization",
					},
					{
						ID:              "prom_disk_total",
						Name:            "Disk Total",
						Unit:            metric.UnitBytes,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_load_avg_1m",
						Name:            "Load Average (1m)",
						Unit:            metric.UnitNone,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Load Average",
					},
					{
						ID:              "prom_load_avg_5m",
						Name:            "Load Average (5m)",
						Unit:            metric.UnitNone,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Load Average",
					},
					{
						ID:              "prom_load_avg_15m",
						Name:            "Load Average (15m)",
						Unit:            metric.UnitNone,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Load Average",
					},
					{
						ID:              "prom_pod_count",
						Name:            "Pod Count",
						Unit:            metric.UnitCount,
						Icon:            "LuBox",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Pod Count",
					},
					{
						ID:              "prom_disk_read_rate",
						Name:            "Disk Read",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuHardDriveDownload",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk I/O",
					},
					{
						ID:              "prom_disk_write_rate",
						Name:            "Disk Write",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuHardDriveUpload",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Disk I/O",
					},
					{
						ID:              "prom_network_errors",
						Name:            "Network Errors",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuAlertTriangle",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "System Activity",
					},
					{
						ID:              "prom_context_switches",
						Name:            "Context Switches",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuArrowLeftRight",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "System Activity",
					},
				},
			},
			// --- Cluster-wide metrics (Prometheus only) ---
			"cluster::metrics": {
				Resource: "cluster::metrics",
				Metrics: []metric.MetricDescriptor{
					// Time-series capable
					{
						ID:              "prom_cluster_cpu_utilization",
						Name:            "Cluster CPU Utilization",
						Unit:            metric.UnitPercentage,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU Utilization",
					},
					{
						ID:              "prom_cluster_memory_utilization",
						Name:            "Cluster Memory Utilization",
						Unit:            metric.UnitPercentage,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory Utilization",
					},
					// Instant only
					{
						ID:              "prom_cluster_pod_count",
						Name:            "Total Pods",
						Unit:            metric.UnitCount,
						Icon:            "LuBox",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_cluster_node_count",
						Name:            "Total Nodes",
						Unit:            metric.UnitCount,
						Icon:            "LuServer",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_cluster_pod_running",
						Name:            "Running Pods",
						Unit:            metric.UnitCount,
						Icon:            "LuPlay",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_cluster_pod_pending",
						Name:            "Pending Pods",
						Unit:            metric.UnitCount,
						Icon:            "LuClock",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_cluster_pod_failed",
						Name:            "Failed Pods",
						Unit:            metric.UnitCount,
						Icon:            "LuAlertTriangle",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					// Network I/O (namespace-filterable)
					{
						ID:              "prom_cluster_network_receive_rate",
						Name:            "Network Receive",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuArrowDown",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Network",
					},
					{
						ID:              "prom_cluster_network_transmit_rate",
						Name:            "Network Transmit",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuArrowUp",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Network",
					},
					// Namespace workload aggregates (namespace-filterable)
					{
						ID:              "prom_namespace_cpu_usage",
						Name:            "Workload CPU Usage",
						Unit:            metric.UnitCores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Workload CPU",
					},
					{
						ID:              "prom_namespace_memory_usage",
						Name:            "Workload Memory Usage",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Workload Memory",
					},
					// Capacity metrics
					{
						ID:              "prom_cluster_cpu_cores",
						Name:            "CPU Cores (Total)",
						Unit:            metric.UnitCores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "CPU Capacity",
					},
					{
						ID:              "prom_cluster_cpu_usage_cores",
						Name:            "CPU Usage (Cores)",
						Unit:            metric.UnitCores,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "CPU Capacity",
					},
					{
						ID:              "prom_cluster_memory_total",
						Name:            "Memory Total",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Memory Capacity",
					},
					{
						ID:              "prom_cluster_memory_usage",
						Name:            "Memory Usage",
						Unit:            metric.UnitBytes,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Memory Capacity",
					},
					{
						ID:              "prom_cluster_pod_capacity",
						Name:            "Pod Capacity",
						Unit:            metric.UnitCount,
						Icon:            "LuBox",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					// Filesystem
					{
						ID:              "prom_cluster_fs_total",
						Name:            "Filesystem Total",
						Unit:            metric.UnitBytes,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent},
					},
					{
						ID:              "prom_cluster_fs_usage_pct",
						Name:            "Filesystem Usage %",
						Unit:            metric.UnitPercentage,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Filesystem",
					},
					// Disk I/O
					{
						ID:              "prom_cluster_disk_read_rate",
						Name:            "Disk Read Throughput",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Disk I/O",
					},
					{
						ID:              "prom_cluster_disk_write_rate",
						Name:            "Disk Write Throughput",
						Unit:            metric.UnitBytesPerSec,
						Icon:            "LuHardDrive",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Disk I/O",
					},
					// Load averages
					{
						ID:              "prom_cluster_load1",
						Name:            "Load Average (1m)",
						Unit:            metric.UnitNone,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Load Average",
					},
					{
						ID:              "prom_cluster_load5",
						Name:            "Load Average (5m)",
						Unit:            metric.UnitNone,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Load Average",
					},
					{
						ID:              "prom_cluster_load15",
						Name:            "Load Average (15m)",
						Unit:            metric.UnitNone,
						Icon:            "LuActivity",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Load Average",
					},
					// Resource requests vs allocatable
					{
						ID:              "prom_cluster_cpu_requests_pct",
						Name:            "CPU Requests %",
						Unit:            metric.UnitPercentage,
						Icon:            "LuCpu",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Resource Requests",
					},
					{
						ID:              "prom_cluster_memory_requests_pct",
						Name:            "Memory Requests %",
						Unit:            metric.UnitPercentage,
						Icon:            "LuMemoryStick",
						SupportedShapes: []metric.MetricShape{metric.ShapeCurrent, metric.ShapeTimeseries},
						ChartGroup:      "Resource Requests",
					},
					// Container health
					{
						ID:              "prom_cluster_container_restarts",
						Name:            "Container Restart Rate",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuRotateCcw",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Container Health",
					},
					{
						ID:              "prom_cluster_oom_events",
						Name:            "OOM Event Rate",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuAlertTriangle",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Container Health",
					},
					// Namespace-scoped container restarts
					{
						ID:              "prom_namespace_container_restarts",
						Name:            "Container Restart Rate (NS)",
						Unit:            metric.UnitOpsPerSec,
						Icon:            "LuRotateCcw",
						SupportedShapes: []metric.MetricShape{metric.ShapeTimeseries},
						ChartGroup:      "Container Health",
					},
				},
			},
		},
		QueryFunc: func(qctx *metric.QueryContext, req metric.QueryRequest) (*metric.QueryResponse, error) {
			return compositeQuery(promClient, qctx, req)
		},
		StreamFunc: nil, // SDK will poll QueryFunc
	})
}
