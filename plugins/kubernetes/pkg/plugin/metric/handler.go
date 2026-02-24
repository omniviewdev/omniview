package metric

import (
	"context"
	"fmt"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"

	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniview/kubernetes/pkg/utils"
)

// compositeQuery is the top-level QueryFunc that routes to either metrics-server
// or Prometheus based on the metric IDs requested or the resource key.
func compositeQuery(
	promClient *prometheusClient,
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	// Cluster-level metrics are Prometheus-only.
	if req.ResourceKey == "cluster::metrics" {
		if req.Shape == sdkmetric.ShapeTimeseries {
			return promClient.queryClusterPrometheusTimeseries(qctx, req)
		}
		return promClient.queryClusterPrometheus(qctx, req)
	}

	// If specific metric IDs are requested, check whether they're all Prometheus
	// or all metrics-server or mixed.
	hasProm := false
	hasMS := false
	for _, id := range req.MetricIDs {
		if strings.HasPrefix(id, "prom_") {
			hasProm = true
		} else {
			hasMS = true
		}
	}

	// If no IDs are specified, fetch all available metrics from both sources.
	wantAll := len(req.MetricIDs) == 0

	var msResp, promResp *sdkmetric.QueryResponse
	var msErr, promErr error

	// Metrics-server query.
	if wantAll || hasMS {
		msResp, msErr = queryMetricsServer(qctx, req)
	}

	// Prometheus query — route to range-query variants for time-series requests.
	// For batch mode (empty ResourceID), use the batch Prometheus handler.
	if wantAll || hasProm {
		if req.Shape == sdkmetric.ShapeTimeseries {
			switch req.ResourceKey {
			case "core::v1::Pod":
				promResp, promErr = promClient.queryPodPrometheusTimeseries(qctx, req)
			case "core::v1::Node":
				promResp, promErr = promClient.queryNodePrometheusTimeseries(qctx, req)
			case "cluster::metrics":
				promResp, promErr = promClient.queryClusterPrometheusTimeseries(qctx, req)
			}
		} else {
			switch req.ResourceKey {
			case "core::v1::Pod":
				if req.ResourceID == "" {
					promResp, promErr = promClient.queryAllPodPrometheus(qctx, req)
				} else {
					promResp, promErr = promClient.queryPodPrometheus(qctx, req)
				}
			case "core::v1::Node":
				promResp, promErr = promClient.queryNodePrometheus(qctx, req)
			}
		}
	}

	// Merge results.
	return mergeResponses(msResp, msErr, promResp, promErr)
}

// mergeResponses combines the results from metrics-server and Prometheus.
func mergeResponses(
	msResp *sdkmetric.QueryResponse, msErr error,
	promResp *sdkmetric.QueryResponse, promErr error,
) (*sdkmetric.QueryResponse, error) {
	// If both failed, return the first error.
	if msErr != nil && promErr != nil {
		return nil, msErr
	}

	results := make([]sdkmetric.MetricResult, 0)
	if msResp != nil && msResp.Success {
		results = append(results, msResp.Results...)
	}
	if promResp != nil && promResp.Success {
		results = append(results, promResp.Results...)
	}

	// If we got at least one source, return success.
	if len(results) > 0 || msErr == nil || promErr == nil {
		return &sdkmetric.QueryResponse{
			Success: true,
			Results: results,
		}, nil
	}

	return &sdkmetric.QueryResponse{
		Success: false,
		Error:   "no metrics available",
	}, nil
}

// queryMetricsServer handles metric queries using the Kubernetes metrics-server API.
func queryMetricsServer(qctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	switch req.ResourceKey {
	case "core::v1::Pod":
		return queryPodMetrics(qctx, req)
	case "core::v1::Node":
		return queryNodeMetrics(qctx, req)
	default:
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   fmt.Sprintf("unsupported resource key: %s", req.ResourceKey),
		}, nil
	}
}

func getMetricsClient(qctx *sdkmetric.QueryContext) (metricsclientset.Interface, error) {
	if qctx.Connection == nil {
		return nil, fmt.Errorf("no connection available in query context")
	}

	ctx := &types.PluginContext{
		Context:    context.Background(),
		Connection: qctx.Connection,
	}

	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get kube clients: %w", err)
	}

	metricsClient, err := metricsclientset.NewForConfig(clients.RestConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	return metricsClient, nil
}

func queryPodMetrics(qctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	// Empty resourceID = batch mode: list metrics for all pods in the namespace.
	if req.ResourceID == "" {
		return queryAllPodMetrics(qctx, req)
	}

	metricsClient, err := getMetricsClient(qctx)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	namespace := req.ResourceNamespace
	name := req.ResourceID

	podMetrics, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(
		context.Background(), name, metav1.GetOptions{},
	)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to get pod metrics: %v", err),
		}, nil
	}

	return buildPodMetricResponse(podMetrics, req.MetricIDs), nil
}

// queryAllPodMetrics fetches metrics for all pods in a namespace via a single List call.
// Returns one MetricResult per metric per pod, with pod/namespace in Labels.
func queryAllPodMetrics(qctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	metricsClient, err := getMetricsClient(qctx)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	podMetricsList, err := metricsClient.MetricsV1beta1().PodMetricses(req.ResourceNamespace).List(
		context.Background(), metav1.ListOptions{},
	)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to list pod metrics: %v", err),
		}, nil
	}

	results := make([]sdkmetric.MetricResult, 0, len(podMetricsList.Items)*2)
	for i := range podMetricsList.Items {
		resp := buildPodMetricResponse(&podMetricsList.Items[i], req.MetricIDs)
		if resp.Success {
			results = append(results, resp.Results...)
		}
	}

	return &sdkmetric.QueryResponse{
		Success: true,
		Results: results,
	}, nil
}

func queryNodeMetrics(qctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	metricsClient, err := getMetricsClient(qctx)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	name := req.ResourceID

	nodeMetrics, err := metricsClient.MetricsV1beta1().NodeMetricses().Get(
		context.Background(), name, metav1.GetOptions{},
	)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to get node metrics: %v", err),
		}, nil
	}

	return buildNodeMetricResponse(nodeMetrics, req.MetricIDs, req.ResourceData), nil
}

func buildPodMetricResponse(podMetrics *metricsv1beta1.PodMetrics, metricIDs []string) *sdkmetric.QueryResponse {
	now := time.Now()
	results := make([]sdkmetric.MetricResult, 0)

	wantAll := len(metricIDs) == 0
	wantMetric := func(id string) bool {
		if wantAll {
			return true
		}
		for _, mid := range metricIDs {
			if mid == id {
				return true
			}
		}
		return false
	}

	// Aggregate CPU and memory across all containers
	var totalCPUMillicores int64
	var totalMemoryBytes int64

	for _, container := range podMetrics.Containers {
		cpuQuantity := container.Usage.Cpu()
		memQuantity := container.Usage.Memory()

		totalCPUMillicores += cpuQuantity.MilliValue()
		totalMemoryBytes += memQuantity.Value()
	}

	if wantMetric("cpu_usage") {
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  "cpu_usage",
				Value:     float64(totalCPUMillicores),
				Timestamp: now,
				Labels: map[string]string{
					"pod":       podMetrics.Name,
					"namespace": podMetrics.Namespace,
				},
			},
		})
	}

	if wantMetric("memory_usage") {
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  "memory_usage",
				Value:     float64(totalMemoryBytes),
				Timestamp: now,
				Labels: map[string]string{
					"pod":       podMetrics.Name,
					"namespace": podMetrics.Namespace,
				},
			},
		})
	}

	return &sdkmetric.QueryResponse{
		Success: true,
		Results: results,
	}
}

func buildNodeMetricResponse(
	nodeMetrics *metricsv1beta1.NodeMetrics,
	metricIDs []string,
	resourceData map[string]interface{},
) *sdkmetric.QueryResponse {
	now := time.Now()
	results := make([]sdkmetric.MetricResult, 0)

	wantAll := len(metricIDs) == 0
	wantMetric := func(id string) bool {
		if wantAll {
			return true
		}
		for _, mid := range metricIDs {
			if mid == id {
				return true
			}
		}
		return false
	}

	cpuUsage := nodeMetrics.Usage.Cpu().MilliValue()
	memUsage := nodeMetrics.Usage.Memory().Value()

	labels := map[string]string{
		"node": nodeMetrics.Name,
	}

	if wantMetric("cpu_usage") {
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  "cpu_usage",
				Value:     float64(cpuUsage),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	if wantMetric("memory_usage") {
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  "memory_usage",
				Value:     float64(memUsage),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	// Capacity metrics from the node's status (passed in resourceData)
	if wantMetric("cpu_capacity") {
		if cpuCap := extractNodeCapacity(resourceData, "cpu"); cpuCap > 0 {
			results = append(results, sdkmetric.MetricResult{
				CurrentValue: &sdkmetric.CurrentValue{
					MetricID:  "cpu_capacity",
					Value:     cpuCap,
					Timestamp: now,
					Labels:    labels,
				},
			})
		}
	}

	if wantMetric("memory_capacity") {
		if memCap := extractNodeCapacity(resourceData, "memory"); memCap > 0 {
			results = append(results, sdkmetric.MetricResult{
				CurrentValue: &sdkmetric.CurrentValue{
					MetricID:  "memory_capacity",
					Value:     memCap,
					Timestamp: now,
					Labels:    labels,
				},
			})
		}
	}

	return &sdkmetric.QueryResponse{
		Success: true,
		Results: results,
	}
}

// extractNodeCapacity extracts capacity values from the node's resource data.
// The data is expected to be a full Node object with status.capacity.
func extractNodeCapacity(resourceData map[string]interface{}, resource string) float64 {
	status, ok := resourceData["status"].(map[string]interface{})
	if !ok {
		return 0
	}
	capacity, ok := status["capacity"].(map[string]interface{})
	if !ok {
		return 0
	}
	val, ok := capacity[resource]
	if !ok {
		return 0
	}

	switch v := val.(type) {
	case float64:
		if resource == "cpu" {
			// CPU capacity in cores, convert to millicores
			return v * 1000
		}
		return v
	case string:
		// Parse k8s quantity strings like "4", "16Gi"
		return parseQuantityString(v, resource)
	}
	return 0
}

func parseQuantityString(s string, resource string) float64 {
	// Simplified k8s quantity parsing
	// For a full implementation, use k8s.io/apimachinery/pkg/api/resource
	var val float64
	var unit string
	fmt.Sscanf(s, "%f%s", &val, &unit)

	if resource == "cpu" {
		switch unit {
		case "m":
			return val
		case "":
			return val * 1000 // cores to millicores
		}
	}
	if resource == "memory" {
		switch unit {
		case "Ki":
			return val * 1024
		case "Mi":
			return val * 1024 * 1024
		case "Gi":
			return val * 1024 * 1024 * 1024
		case "Ti":
			return val * 1024 * 1024 * 1024 * 1024
		case "":
			return val
		}
	}
	return val
}
