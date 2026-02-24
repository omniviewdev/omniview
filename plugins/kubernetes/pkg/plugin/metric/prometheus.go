package metric

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/settings"

	"k8s.io/client-go/kubernetes"
)

// prometheusClient handles querying Prometheus for metrics. It uses the
// Kubernetes API proxy as the primary access method and falls back to
// SPDY port-forwarding when the proxy is unavailable. Kube clients are
// cached per-connection, and Prometheus availability is auto-detected.
type prometheusClient struct {
	settings    pkgsettings.Provider
	pfManager   *PortForwardManager
	clientCache *ClientCache
	detector    *PrometheusDetector

	// proxyFailed tracks connections where the API proxy has failed,
	// so we skip it and go straight to port-forward on subsequent queries.
	proxyFailedMu sync.RWMutex
	proxyFailed   map[string]bool
}

func newPrometheusClient(settings pkgsettings.Provider) *prometheusClient {
	return &prometheusClient{
		settings:  settings,
		pfManager: NewPortForwardManager(PortForwardOpts{}),
		clientCache: NewClientCache(ClientCacheOpts{
			Factory: DefaultClientFactory,
		}),
		detector:    NewPrometheusDetector(DetectorOpts{}),
		proxyFailed: make(map[string]bool),
	}
}

// prometheusConfig holds the user-configured Prometheus overrides.
type prometheusConfig struct {
	Service   string
	Namespace string
	Port      int
}

func (c *prometheusClient) getConfig(resourceData map[string]interface{}) prometheusConfig {
	cfg := prometheusConfig{
		Service:   "prometheus-server",
		Namespace: "monitoring",
		Port:      9090,
	}

	// Per-connection override (injected by frontend into resourceData).
	if mc, ok := resourceData["__metric_config__"].(map[string]interface{}); ok {
		if svc, ok := mc["service"].(string); ok && svc != "" {
			cfg.Service = svc
		}
		if ns, ok := mc["namespace"].(string); ok && ns != "" {
			cfg.Namespace = ns
		}
		if port, ok := mc["port"].(float64); ok && port > 0 {
			cfg.Port = int(port)
		}
		return cfg
	}

	// Fall back to global plugin settings.
	if svc, err := c.settings.GetString("prometheus_service_name"); err == nil && svc != "" {
		cfg.Service = svc
	}
	if ns, err := c.settings.GetString("prometheus_service_namespace"); err == nil && ns != "" {
		cfg.Namespace = ns
	}
	if port, err := c.settings.GetInt("prometheus_service_port"); err == nil && port > 0 {
		cfg.Port = port
	}
	return cfg
}

// detect checks whether Prometheus is available for the given connection,
// using the cached kube clients and auto-detection.
func (c *prometheusClient) detect(
	connectionID string,
	conn *types.Connection,
	resourceData map[string]interface{},
) (*DetectionResult, error) {
	clients, err := c.clientCache.Get(connectionID, conn)
	if err != nil {
		return nil, fmt.Errorf("failed to get kube clients for detection: %w", err)
	}

	cfg := c.getConfig(resourceData)
	checker := &kubeServiceChecker{clientset: clients.Clientset}
	result := c.detector.Detect(connectionID, checker, cfg.Service, cfg.Namespace, cfg.Port)
	return result, nil
}

// --- Prometheus HTTP API types (instant / vector) ---

type promAPIResponse struct {
	Status string       `json:"status"`
	Data   promDataBody `json:"data"`
	Error  string       `json:"error,omitempty"`
}

type promDataBody struct {
	ResultType string             `json:"resultType"`
	Result     []promVectorResult `json:"result"`
}

type promVectorResult struct {
	Metric map[string]string `json:"metric"`
	Value  [2]interface{}    `json:"value"` // [timestamp, "value"]
}

// --- Prometheus HTTP API types (range / matrix) ---

type promMatrixResult struct {
	Metric map[string]string `json:"metric"`
	Values [][2]interface{}  `json:"values"` // [[timestamp, "value"], ...]
}

type promMatrixDataBody struct {
	ResultType string             `json:"resultType"`
	Result     []promMatrixResult `json:"result"`
}

type promMatrixAPIResponse struct {
	Status string             `json:"status"`
	Data   promMatrixDataBody `json:"data"`
	Error  string             `json:"error,omitempty"`
}

// query executes a PromQL instant query against the Prometheus instance
// associated with the given connection. It uses cached kube clients and
// auto-detects the Prometheus service.
func (c *prometheusClient) query(
	ctx context.Context,
	connectionID string,
	conn *types.Connection,
	promql string,
	resourceData map[string]interface{},
) (*promAPIResponse, error) {
	// Auto-detect Prometheus availability.
	detection, err := c.detect(connectionID, conn, resourceData)
	if err != nil {
		return nil, err
	}
	if !detection.Found {
		return nil, fmt.Errorf("prometheus not detected in cluster for connection %s", connectionID)
	}

	clients, err := c.clientCache.Get(connectionID, conn)
	if err != nil {
		return nil, fmt.Errorf("failed to get kube clients: %w", err)
	}

	log.Printf("[DEBUG] prometheus query: svc=%s ns=%s port=%d promql=%s", detection.Service, detection.Namespace, detection.Port, promql)

	// Check if proxy already failed for this connection — skip straight to port-forward.
	c.proxyFailedMu.RLock()
	skipProxy := c.proxyFailed[connectionID]
	c.proxyFailedMu.RUnlock()

	var proxyErr error
	if !skipProxy {
		// Try API proxy first — uses the kube API server's service proxy,
		// which reuses the existing kubeconfig auth with no port management.
		var result *promAPIResponse
		result, proxyErr = c.queryViaProxy(clients.Clientset, detection, promql)
		if proxyErr == nil {
			log.Printf("[DEBUG] proxy succeeded: resultType=%s numResults=%d", result.Data.ResultType, len(result.Data.Result))
			if len(result.Data.Result) > 0 {
				log.Printf("[DEBUG] first result value: %v", result.Data.Result[0].Value)
			}
			return result, nil
		}
		log.Printf("[DEBUG] proxy failed (caching for future queries): %v", proxyErr)
		c.proxyFailedMu.Lock()
		c.proxyFailed[connectionID] = true
		c.proxyFailedMu.Unlock()
	}

	// Use SPDY port-forward (reuses existing tunnel if available).
	pfURL, err := c.pfManager.GetOrCreate(
		connectionID,
		clients.RestConfig,
		clients.Clientset,
		detection.Namespace,
		detection.Service,
		detection.Port,
	)
	if err != nil {
		return nil, fmt.Errorf("all prometheus query methods failed: proxy: %v, port-forward: %w", proxyErr, err)
	}

	result, err := c.queryDirect(pfURL, promql)
	if err != nil {
		return nil, fmt.Errorf("all prometheus query methods failed: proxy: %v, direct: %w", proxyErr, err)
	}
	log.Printf("[DEBUG] query succeeded via port-forward: resultType=%s numResults=%d", result.Data.ResultType, len(result.Data.Result))
	if len(result.Data.Result) > 0 {
		log.Printf("[DEBUG] first result value: %v", result.Data.Result[0].Value)
	}
	return result, nil
}

// queryViaProxy queries Prometheus through the Kubernetes API server's
// service proxy endpoint.
func (c *prometheusClient) queryViaProxy(
	clientset kubernetes.Interface,
	detection *DetectionResult,
	promql string,
) (*promAPIResponse, error) {
	raw, err := clientset.CoreV1().Services(detection.Namespace).ProxyGet(
		"",
		detection.Service,
		fmt.Sprintf("%d", detection.Port),
		fmt.Sprintf("/api/v1/query?query=%s&time=%d", url.QueryEscape(promql), time.Now().Unix()),
		nil,
	).DoRaw(context.Background())
	if err != nil {
		return nil, fmt.Errorf("API proxy request failed: %w", err)
	}

	var result promAPIResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("failed to decode proxy response: %w", err)
	}
	if result.Status != "success" {
		return nil, fmt.Errorf("prometheus query error: %s", result.Error)
	}
	return &result, nil
}

// queryDirect queries a Prometheus instance at the given base URL (port-forward path).
func (c *prometheusClient) queryDirect(baseURL string, promql string) (*promAPIResponse, error) {
	u := fmt.Sprintf("%s/api/v1/query?query=%s&time=%d",
		strings.TrimRight(baseURL, "/"),
		url.QueryEscape(promql),
		time.Now().Unix(),
	)

	resp, err := http.Get(u)
	if err != nil {
		return nil, fmt.Errorf("prometheus query failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read prometheus response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus returned status %d: %s", resp.StatusCode, string(body))
	}

	var result promAPIResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode prometheus response: %w", err)
	}

	if result.Status != "success" {
		return nil, fmt.Errorf("prometheus query error: %s", result.Error)
	}

	return &result, nil
}

// extractScalarValue extracts a float64 from a Prometheus vector result.
// Returns 0 if no results are present or the value is NaN/Inf.
func extractScalarValue(resp *promAPIResponse) float64 {
	if resp == nil || len(resp.Data.Result) == 0 {
		return 0
	}
	if len(resp.Data.Result[0].Value) < 2 {
		return 0
	}
	valStr, ok := resp.Data.Result[0].Value[1].(string)
	if !ok {
		return 0
	}

	// Prometheus returns "NaN", "+Inf", "-Inf" as strings — treat as 0.
	if valStr == "NaN" || valStr == "+Inf" || valStr == "-Inf" {
		return 0
	}

	var v float64
	if _, err := fmt.Sscanf(valStr, "%f", &v); err != nil {
		return 0
	}
	return v
}

// queryRange executes a PromQL range query against the Prometheus instance.
// It uses the same proxy-then-port-forward fallback pattern as query().
func (c *prometheusClient) queryRange(
	ctx context.Context,
	connectionID string,
	conn *types.Connection,
	promql string,
	resourceData map[string]interface{},
	start, end time.Time,
	step time.Duration,
) (*promMatrixAPIResponse, error) {
	detection, err := c.detect(connectionID, conn, resourceData)
	if err != nil {
		return nil, err
	}
	if !detection.Found {
		return nil, fmt.Errorf("prometheus not detected in cluster for connection %s", connectionID)
	}

	clients, err := c.clientCache.Get(connectionID, conn)
	if err != nil {
		return nil, fmt.Errorf("failed to get kube clients: %w", err)
	}

	log.Printf("[DEBUG] prometheus query_range: promql=%s start=%d end=%d step=%s",
		promql, start.Unix(), end.Unix(), step)

	c.proxyFailedMu.RLock()
	skipProxy := c.proxyFailed[connectionID]
	c.proxyFailedMu.RUnlock()

	var proxyErr error
	if !skipProxy {
		result, pErr := c.queryRangeViaProxy(clients.Clientset, detection, promql, start, end, step)
		if pErr == nil {
			return result, nil
		}
		proxyErr = pErr
		log.Printf("[DEBUG] range proxy failed: %v", proxyErr)
		c.proxyFailedMu.Lock()
		c.proxyFailed[connectionID] = true
		c.proxyFailedMu.Unlock()
	}

	pfURL, err := c.pfManager.GetOrCreate(
		connectionID, clients.RestConfig, clients.Clientset,
		detection.Namespace, detection.Service, detection.Port,
	)
	if err != nil {
		return nil, fmt.Errorf("all prometheus query_range methods failed: proxy: %v, port-forward: %w", proxyErr, err)
	}

	result, err := c.queryRangeDirect(pfURL, promql, start, end, step)
	if err != nil {
		return nil, fmt.Errorf("all prometheus query_range methods failed: proxy: %v, direct: %w", proxyErr, err)
	}
	return result, nil
}

func (c *prometheusClient) queryRangeViaProxy(
	clientset kubernetes.Interface,
	detection *DetectionResult,
	promql string,
	start, end time.Time,
	step time.Duration,
) (*promMatrixAPIResponse, error) {
	path := fmt.Sprintf("/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		url.QueryEscape(promql), start.Unix(), end.Unix(), int(step.Seconds()))

	raw, err := clientset.CoreV1().Services(detection.Namespace).ProxyGet(
		"", detection.Service, fmt.Sprintf("%d", detection.Port), path, nil,
	).DoRaw(context.Background())
	if err != nil {
		return nil, fmt.Errorf("API proxy range request failed: %w", err)
	}

	var result promMatrixAPIResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("failed to decode proxy range response: %w", err)
	}
	if result.Status != "success" {
		return nil, fmt.Errorf("prometheus range query error: %s", result.Error)
	}
	return &result, nil
}

func (c *prometheusClient) queryRangeDirect(
	baseURL string,
	promql string,
	start, end time.Time,
	step time.Duration,
) (*promMatrixAPIResponse, error) {
	u := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		strings.TrimRight(baseURL, "/"),
		url.QueryEscape(promql),
		start.Unix(), end.Unix(), int(step.Seconds()))

	resp, err := http.Get(u)
	if err != nil {
		return nil, fmt.Errorf("prometheus range query failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read prometheus range response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus returned status %d: %s", resp.StatusCode, string(body))
	}

	var result promMatrixAPIResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode prometheus range response: %w", err)
	}
	if result.Status != "success" {
		return nil, fmt.Errorf("prometheus range query error: %s", result.Error)
	}
	return &result, nil
}

// extractTimeSeries converts a Prometheus matrix response into SDK DataPoints.
// It aggregates across all result series by summing values at each timestamp.
func extractTimeSeries(resp *promMatrixAPIResponse) []sdkmetric.DataPoint {
	if resp == nil || len(resp.Data.Result) == 0 {
		return nil
	}

	// If there's a single series, extract directly.
	if len(resp.Data.Result) == 1 {
		series := resp.Data.Result[0]
		points := make([]sdkmetric.DataPoint, 0, len(series.Values))
		for _, pair := range series.Values {
			ts, val := parsePromPair(pair)
			if ts.IsZero() {
				continue
			}
			points = append(points, sdkmetric.DataPoint{
				Timestamp: ts,
				Value:     val,
			})
		}
		return points
	}

	// Multiple series — sum values at each timestamp.
	// Use the first series' timestamps as the canonical set.
	type tsVal struct {
		ts  time.Time
		sum float64
	}
	buckets := make(map[int64]*tsVal)
	var order []int64

	for _, series := range resp.Data.Result {
		for _, pair := range series.Values {
			ts, val := parsePromPair(pair)
			if ts.IsZero() {
				continue
			}
			key := ts.Unix()
			if b, ok := buckets[key]; ok {
				b.sum += val
			} else {
				buckets[key] = &tsVal{ts: ts, sum: val}
				order = append(order, key)
			}
		}
	}

	points := make([]sdkmetric.DataPoint, 0, len(order))
	for _, key := range order {
		b := buckets[key]
		points = append(points, sdkmetric.DataPoint{
			Timestamp: b.ts,
			Value:     b.sum,
		})
	}
	return points
}

// parsePromPair extracts a timestamp and float64 value from a Prometheus [timestamp, "value"] pair.
func parsePromPair(pair [2]interface{}) (time.Time, float64) {
	var ts time.Time
	switch t := pair[0].(type) {
	case float64:
		ts = time.Unix(int64(t), 0)
	}

	valStr, ok := pair[1].(string)
	if !ok || valStr == "NaN" || valStr == "+Inf" || valStr == "-Inf" {
		return ts, 0
	}

	var v float64
	if _, err := fmt.Sscanf(valStr, "%f", &v); err != nil {
		return ts, 0
	}
	return ts, v
}

// --- Pod Prometheus Queries ---

func (c *prometheusClient) queryPodPrometheus(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	// Auto-detect — if Prometheus isn't available, return empty (not error).
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	pod := extractResourceName(req.ResourceData, req.ResourceID)
	ns := extractResourceNamespace(req.ResourceData, req.ResourceNamespace)
	now := time.Now()

	log.Printf("[DEBUG] queryPodPrometheus: pod=%q namespace=%q (raw resourceID=%q) metricIDs=%v", pod, ns, req.ResourceID, req.MetricIDs)

	// Diagnostic: check if cAdvisor metrics exist at all for this pod.
	diagResp, diagErr := c.query(ctx, qctx.ConnectionID, qctx.Connection,
		fmt.Sprintf(`container_cpu_usage_seconds_total{pod="%s",namespace="%s"}`, pod, ns), req.ResourceData)
	if diagErr != nil {
		log.Printf("[DEBUG] diagnostic: cAdvisor check failed: %v", diagErr)
	} else {
		log.Printf("[DEBUG] diagnostic: container_cpu_usage_seconds_total (no container filter) numResults=%d", len(diagResp.Data.Result))
		if len(diagResp.Data.Result) > 0 {
			log.Printf("[DEBUG] diagnostic: first result labels: %v value: %v", diagResp.Data.Result[0].Metric, diagResp.Data.Result[0].Value)
		} else {
			// Check if ANY cAdvisor metrics exist in this namespace
			anyResp, anyErr := c.query(ctx, qctx.ConnectionID, qctx.Connection,
				fmt.Sprintf(`count(container_cpu_usage_seconds_total{namespace="%s"})`, ns), req.ResourceData)
			if anyErr != nil {
				log.Printf("[DEBUG] diagnostic: cAdvisor namespace check failed: %v", anyErr)
			} else if len(anyResp.Data.Result) > 0 {
				log.Printf("[DEBUG] diagnostic: cAdvisor metrics exist in namespace %s: count=%v", ns, anyResp.Data.Result[0].Value)
			} else {
				log.Printf("[DEBUG] diagnostic: NO cAdvisor metrics found in namespace %s - check if kubelet/cAdvisor scraping is configured", ns)
			}
		}
	}

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)
	labels := map[string]string{"pod": pod, "namespace": ns}

	type promMetric struct {
		id     string
		promql string
	}

	// NOTE: We only filter container!="POD" (to exclude the pause/sandbox
	// container on setups that export per-container labels). We intentionally
	// do NOT filter container!="" or image!="" because some Prometheus/cAdvisor
	// setups (e.g. minikube with kube-prometheus-stack) only export pod-level
	// aggregate metrics without `container` or `image` labels.
	metrics := []promMetric{
		// --- CPU ---
		{
			id:     "prom_cpu_usage_rate",
			promql: fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_cpu_throttle_rate",
			promql: fmt.Sprintf(`sum(rate(container_cpu_cfs_throttled_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m])) / sum(rate(container_cpu_usage_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m])) * 100`, pod, ns, pod, ns),
		},
		// --- Memory ---
		{
			id:     "prom_memory_working_set",
			promql: fmt.Sprintf(`sum(container_memory_working_set_bytes{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		{
			id:     "prom_memory_rss",
			promql: fmt.Sprintf(`sum(container_memory_rss{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		{
			id:     "prom_memory_cache",
			promql: fmt.Sprintf(`sum(container_memory_cache{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		{
			id:     "prom_memory_max",
			promql: fmt.Sprintf(`sum(container_memory_max_usage_bytes{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		// --- Network ---
		{
			id:     "prom_network_receive_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{pod="%s",namespace="%s"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_network_transmit_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{pod="%s",namespace="%s"}[5m]))`, pod, ns),
		},
		// --- Disk I/O ---
		{
			id:     "prom_disk_read_bytes",
			promql: fmt.Sprintf(`sum(rate(container_fs_reads_bytes_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_disk_write_bytes",
			promql: fmt.Sprintf(`sum(rate(container_fs_writes_bytes_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_disk_read_iops",
			promql: fmt.Sprintf(`sum(rate(container_fs_reads_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_disk_write_iops",
			promql: fmt.Sprintf(`sum(rate(container_fs_writes_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_fs_usage",
			promql: fmt.Sprintf(`sum(container_fs_usage_bytes{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		// --- Process ---
		{
			id:     "prom_threads",
			promql: fmt.Sprintf(`sum(container_threads{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		// --- Page faults ---
		{
			id:     "prom_page_faults",
			promql: fmt.Sprintf(`sum(rate(container_memory_failures_total{pod="%s",namespace="%s",container!="POD",failure_type="pgfault",scope="container"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_major_page_faults",
			promql: fmt.Sprintf(`sum(rate(container_memory_failures_total{pod="%s",namespace="%s",container!="POD",failure_type="pgmajfault",scope="container"}[5m]))`, pod, ns),
		},
		// --- Resource requests & limits (kube-state-metrics) ---
		{
			id:     "prom_cpu_request",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="cpu"})`, pod, ns),
		},
		{
			id:     "prom_cpu_limit",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_limits{pod="%s",namespace="%s",resource="cpu"})`, pod, ns),
		},
		{
			id:     "prom_memory_request",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="memory"})`, pod, ns),
		},
		{
			id:     "prom_memory_limit",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_limits{pod="%s",namespace="%s",resource="memory"})`, pod, ns),
		},
		// --- Resource efficiency (derived) ---
		{
			id:     "prom_cpu_pct_request",
			promql: fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m])) / sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="cpu"}) * 100`, pod, ns, pod, ns),
		},
		{
			id:     "prom_memory_pct_request",
			promql: fmt.Sprintf(`sum(container_memory_working_set_bytes{pod="%s",namespace="%s",container!="POD"}) / sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="memory"}) * 100`, pod, ns, pod, ns),
		},
		// --- Lifecycle ---
		{
			id:     "prom_restart_count",
			promql: fmt.Sprintf(`sum(kube_pod_container_status_restarts_total{pod="%s",namespace="%s"})`, pod, ns),
		},
		{
			id:     "prom_oom_killed_count",
			promql: fmt.Sprintf(`sum(kube_pod_container_status_last_terminated_reason{pod="%s",namespace="%s",reason="OOMKilled"})`, pod, ns),
		},
		{
			id:     "prom_pod_uptime",
			promql: fmt.Sprintf(`time() - min(kube_pod_created{pod="%s",namespace="%s"})`, pod, ns),
		},
		// --- Probe health (kubelet) ---
		{
			id:     "prom_probe_success_rate",
			promql: fmt.Sprintf(`sum(rate(prober_probe_total{pod="%s",namespace="%s",result="successful"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_probe_avg_latency",
			promql: fmt.Sprintf(`rate(prober_probe_duration_seconds_sum{pod="%s",namespace="%s"}[5m]) / rate(prober_probe_duration_seconds_count{pod="%s",namespace="%s"}[5m])`, pod, ns, pod, ns),
		},
		// --- Storage (kubelet) ---
		{
			id:     "prom_log_fs_used",
			promql: fmt.Sprintf(`sum(kubelet_container_log_filesystem_used_bytes{pod="%s",namespace="%s"})`, pod, ns),
		},
	}

	for _, m := range metrics {
		if !wantMetric(m.id) {
			continue
		}
		resp, err := c.query(ctx, qctx.ConnectionID, qctx.Connection, m.promql, req.ResourceData)
		if err != nil {
			log.Printf("prometheus query %s failed: %v", m.id, err)
			continue
		}
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  m.id,
				Value:     extractScalarValue(resp),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// --- Batch Pod Prometheus Queries (all pods at once) ---

// queryAllPodPrometheus fetches CPU and memory usage for ALL pods in a namespace
// (or all namespaces) using two batch PromQL queries. This is used when
// resourceID is empty (batch mode).
func (c *prometheusClient) queryAllPodPrometheus(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	now := time.Now()

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)

	// Build namespace filter for PromQL
	nsFilter := ""
	if req.ResourceNamespace != "" {
		nsFilter = fmt.Sprintf(`,namespace="%s"`, req.ResourceNamespace)
	}

	type batchQuery struct {
		metricID string
		promql   string
	}

	queries := []batchQuery{
		{
			metricID: "prom_cpu_usage_rate",
			promql:   fmt.Sprintf(`sum by (pod, namespace) (rate(container_cpu_usage_seconds_total{container!="POD"%s}[5m]))`, nsFilter),
		},
		{
			metricID: "prom_memory_working_set",
			promql:   fmt.Sprintf(`sum by (pod, namespace) (container_memory_working_set_bytes{container!="POD"%s})`, nsFilter),
		},
	}

	for _, q := range queries {
		if !wantMetric(q.metricID) {
			continue
		}
		resp, err := c.query(ctx, qctx.ConnectionID, qctx.Connection, q.promql, req.ResourceData)
		if err != nil {
			log.Printf("prometheus batch query %s failed: %v", q.metricID, err)
			continue
		}
		// Each result in the vector has {pod, namespace} labels — one per pod.
		for _, r := range resp.Data.Result {
			pod := r.Metric["pod"]
			ns := r.Metric["namespace"]
			if pod == "" {
				continue
			}
			val := float64(0)
			if len(r.Value) >= 2 {
				if valStr, ok := r.Value[1].(string); ok && valStr != "NaN" && valStr != "+Inf" && valStr != "-Inf" {
					fmt.Sscanf(valStr, "%f", &val)
				}
			}
			// CPU is in cores from Prometheus — convert to millicores for consistency
			if q.metricID == "prom_cpu_usage_rate" {
				val = val * 1000
			}
			results = append(results, sdkmetric.MetricResult{
				CurrentValue: &sdkmetric.CurrentValue{
					MetricID:  q.metricID,
					Value:     val,
					Timestamp: now,
					Labels: map[string]string{
						"pod":       pod,
						"namespace": ns,
					},
				},
			})
		}
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// --- Pod Prometheus Time-Series Queries ---

func (c *prometheusClient) queryPodPrometheusTimeseries(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	pod := extractResourceName(req.ResourceData, req.ResourceID)
	ns := extractResourceNamespace(req.ResourceData, req.ResourceNamespace)

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)
	labels := map[string]string{"pod": pod, "namespace": ns}

	type promMetric struct {
		id     string
		promql string
	}

	metrics := []promMetric{
		// --- CPU ---
		{
			id:     "prom_cpu_usage_rate",
			promql: fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_cpu_throttle_rate",
			promql: fmt.Sprintf(`sum(rate(container_cpu_cfs_throttled_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m])) / sum(rate(container_cpu_usage_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m])) * 100`, pod, ns, pod, ns),
		},
		// --- Memory ---
		{
			id:     "prom_memory_working_set",
			promql: fmt.Sprintf(`sum(container_memory_working_set_bytes{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		{
			id:     "prom_memory_rss",
			promql: fmt.Sprintf(`sum(container_memory_rss{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		{
			id:     "prom_memory_cache",
			promql: fmt.Sprintf(`sum(container_memory_cache{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		// --- Network ---
		{
			id:     "prom_network_receive_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{pod="%s",namespace="%s"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_network_transmit_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{pod="%s",namespace="%s"}[5m]))`, pod, ns),
		},
		// --- Disk I/O ---
		{
			id:     "prom_disk_read_bytes",
			promql: fmt.Sprintf(`sum(rate(container_fs_reads_bytes_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_disk_write_bytes",
			promql: fmt.Sprintf(`sum(rate(container_fs_writes_bytes_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_disk_read_iops",
			promql: fmt.Sprintf(`sum(rate(container_fs_reads_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_disk_write_iops",
			promql: fmt.Sprintf(`sum(rate(container_fs_writes_total{pod="%s",namespace="%s",container!="POD"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_fs_usage",
			promql: fmt.Sprintf(`sum(container_fs_usage_bytes{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		// --- Process ---
		{
			id:     "prom_threads",
			promql: fmt.Sprintf(`sum(container_threads{pod="%s",namespace="%s",container!="POD"})`, pod, ns),
		},
		// --- Page faults ---
		{
			id:     "prom_page_faults",
			promql: fmt.Sprintf(`sum(rate(container_memory_failures_total{pod="%s",namespace="%s",container!="POD",failure_type="pgfault",scope="container"}[5m]))`, pod, ns),
		},
		{
			id:     "prom_major_page_faults",
			promql: fmt.Sprintf(`sum(rate(container_memory_failures_total{pod="%s",namespace="%s",container!="POD",failure_type="pgmajfault",scope="container"}[5m]))`, pod, ns),
		},
		// --- Resource requests & limits (time-series for chart overlays) ---
		{
			id:     "prom_cpu_request",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="cpu"})`, pod, ns),
		},
		{
			id:     "prom_cpu_limit",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_limits{pod="%s",namespace="%s",resource="cpu"})`, pod, ns),
		},
		{
			id:     "prom_memory_request",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="memory"})`, pod, ns),
		},
		{
			id:     "prom_memory_limit",
			promql: fmt.Sprintf(`sum(kube_pod_container_resource_limits{pod="%s",namespace="%s",resource="memory"})`, pod, ns),
		},
		// --- Resource efficiency (derived) ---
		{
			id:     "prom_cpu_pct_request",
			promql: fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{pod="%s",namespace="%s",container!="POD"}[5m])) / sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="cpu"}) * 100`, pod, ns, pod, ns),
		},
		{
			id:     "prom_memory_pct_request",
			promql: fmt.Sprintf(`sum(container_memory_working_set_bytes{pod="%s",namespace="%s",container!="POD"}) / sum(kube_pod_container_resource_requests{pod="%s",namespace="%s",resource="memory"}) * 100`, pod, ns, pod, ns),
		},
		// --- Restarts (time-series for trend) ---
		{
			id:     "prom_restart_count",
			promql: fmt.Sprintf(`sum(kube_pod_container_status_restarts_total{pod="%s",namespace="%s"})`, pod, ns),
		},
	}

	for _, m := range metrics {
		if !wantMetric(m.id) {
			continue
		}
		resp, err := c.queryRange(ctx, qctx.ConnectionID, qctx.Connection, m.promql,
			req.ResourceData, req.StartTime, req.EndTime, req.Step)
		if err != nil {
			log.Printf("prometheus range query %s failed: %v", m.id, err)
			continue
		}
		points := extractTimeSeries(resp)
		if len(points) == 0 {
			continue
		}
		results = append(results, sdkmetric.MetricResult{
			TimeSeries: &sdkmetric.TimeSeries{
				MetricID:   m.id,
				DataPoints: points,
				Labels:     labels,
			},
		})
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// resolveNodeInstance resolves a Kubernetes node name to a Prometheus
// instance label pattern. Node-exporter metrics use instance=<IP>:<port>
// rather than the node name, so we look up the internal IP via
// kube_node_info and return "<IP>.*" as a regex pattern. Falls back to
// "<nodeName>.*" if the lookup fails.
func (c *prometheusClient) resolveNodeInstance(
	ctx context.Context,
	connectionID string,
	conn *types.Connection,
	node string,
	resourceData map[string]interface{},
) string {
	q := fmt.Sprintf(`kube_node_info{node="%s"}`, node)
	resp, err := c.query(ctx, connectionID, conn, q, resourceData)
	if err == nil && len(resp.Data.Result) > 0 {
		if ip, ok := resp.Data.Result[0].Metric["internal_ip"]; ok && ip != "" {
			log.Printf("[DEBUG] resolveNodeInstance: node=%q -> internal_ip=%q", node, ip)
			return ip + ".*"
		}
	}
	log.Printf("[DEBUG] resolveNodeInstance: could not resolve node=%q, falling back to name match", node)
	return node + ".*"
}

// --- Node Prometheus Queries ---

func (c *prometheusClient) queryNodePrometheus(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	node := extractResourceName(req.ResourceData, req.ResourceID)
	now := time.Now()
	inst := c.resolveNodeInstance(ctx, qctx.ConnectionID, qctx.Connection, node, req.ResourceData)

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)
	labels := map[string]string{"node": node}

	type promMetric struct {
		id     string
		promql string
	}

	metrics := []promMetric{
		{
			id:     "prom_cpu_utilization",
			promql: fmt.Sprintf(`100 - avg(rate(node_cpu_seconds_total{mode="idle",instance=~"%s"}[5m])) * 100`, inst),
		},
		{
			id:     "prom_memory_utilization",
			promql: fmt.Sprintf(`(1 - node_memory_MemAvailable_bytes{instance=~"%s"} / node_memory_MemTotal_bytes{instance=~"%s"}) * 100`, inst, inst),
		},
		{
			id:     "prom_memory_total",
			promql: fmt.Sprintf(`node_memory_MemTotal_bytes{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_disk_utilization",
			promql: fmt.Sprintf(`(1 - node_filesystem_avail_bytes{instance=~"%s",mountpoint="/"} / node_filesystem_size_bytes{instance=~"%s",mountpoint="/"}) * 100`, inst, inst),
		},
		{
			id:     "prom_disk_total",
			promql: fmt.Sprintf(`node_filesystem_size_bytes{instance=~"%s",mountpoint="/"}`, inst),
		},
		{
			id:     "prom_network_receive_rate",
			promql: fmt.Sprintf(`sum(rate(node_network_receive_bytes_total{instance=~"%s",device!="lo"}[5m]))`, inst),
		},
		{
			id:     "prom_network_transmit_rate",
			promql: fmt.Sprintf(`sum(rate(node_network_transmit_bytes_total{instance=~"%s",device!="lo"}[5m]))`, inst),
		},
		{
			id:     "prom_load_avg_1m",
			promql: fmt.Sprintf(`node_load1{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_load_avg_5m",
			promql: fmt.Sprintf(`node_load5{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_load_avg_15m",
			promql: fmt.Sprintf(`node_load15{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_pod_count",
			promql: fmt.Sprintf(`kubelet_running_pods{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_disk_read_rate",
			promql: fmt.Sprintf(`sum(rate(node_disk_read_bytes_total{instance=~"%s"}[5m]))`, inst),
		},
		{
			id:     "prom_disk_write_rate",
			promql: fmt.Sprintf(`sum(rate(node_disk_written_bytes_total{instance=~"%s"}[5m]))`, inst),
		},
		{
			id:     "prom_network_errors",
			promql: fmt.Sprintf(`sum(rate(node_network_receive_errs_total{instance=~"%s",device!="lo"}[5m])) + sum(rate(node_network_transmit_errs_total{instance=~"%s",device!="lo"}[5m]))`, inst, inst),
		},
		{
			id:     "prom_context_switches",
			promql: fmt.Sprintf(`rate(node_context_switches_total{instance=~"%s"}[5m])`, inst),
		},
	}

	for _, m := range metrics {
		if !wantMetric(m.id) {
			continue
		}
		resp, err := c.query(ctx, qctx.ConnectionID, qctx.Connection, m.promql, req.ResourceData)
		if err != nil {
			log.Printf("prometheus query %s failed: %v", m.id, err)
			continue
		}
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  m.id,
				Value:     extractScalarValue(resp),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// --- Node Prometheus Time-Series Queries ---

func (c *prometheusClient) queryNodePrometheusTimeseries(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	node := extractResourceName(req.ResourceData, req.ResourceID)
	inst := c.resolveNodeInstance(ctx, qctx.ConnectionID, qctx.Connection, node, req.ResourceData)

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)
	labels := map[string]string{"node": node}

	type promMetric struct {
		id     string
		promql string
	}

	metrics := []promMetric{
		{
			id:     "prom_cpu_utilization",
			promql: fmt.Sprintf(`100 - avg(rate(node_cpu_seconds_total{mode="idle",instance=~"%s"}[5m])) * 100`, inst),
		},
		{
			id:     "prom_memory_utilization",
			promql: fmt.Sprintf(`(1 - node_memory_MemAvailable_bytes{instance=~"%s"} / node_memory_MemTotal_bytes{instance=~"%s"}) * 100`, inst, inst),
		},
		{
			id:     "prom_network_receive_rate",
			promql: fmt.Sprintf(`sum(rate(node_network_receive_bytes_total{instance=~"%s",device!="lo"}[5m]))`, inst),
		},
		{
			id:     "prom_network_transmit_rate",
			promql: fmt.Sprintf(`sum(rate(node_network_transmit_bytes_total{instance=~"%s",device!="lo"}[5m]))`, inst),
		},
		{
			id:     "prom_disk_utilization",
			promql: fmt.Sprintf(`(1 - node_filesystem_avail_bytes{instance=~"%s",mountpoint="/"} / node_filesystem_size_bytes{instance=~"%s",mountpoint="/"}) * 100`, inst, inst),
		},
		{
			id:     "prom_load_avg_1m",
			promql: fmt.Sprintf(`node_load1{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_load_avg_5m",
			promql: fmt.Sprintf(`node_load5{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_load_avg_15m",
			promql: fmt.Sprintf(`node_load15{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_pod_count",
			promql: fmt.Sprintf(`kubelet_running_pods{instance=~"%s"}`, inst),
		},
		{
			id:     "prom_disk_read_rate",
			promql: fmt.Sprintf(`sum(rate(node_disk_read_bytes_total{instance=~"%s"}[5m]))`, inst),
		},
		{
			id:     "prom_disk_write_rate",
			promql: fmt.Sprintf(`sum(rate(node_disk_written_bytes_total{instance=~"%s"}[5m]))`, inst),
		},
		{
			id:     "prom_network_errors",
			promql: fmt.Sprintf(`sum(rate(node_network_receive_errs_total{instance=~"%s",device!="lo"}[5m])) + sum(rate(node_network_transmit_errs_total{instance=~"%s",device!="lo"}[5m]))`, inst, inst),
		},
		{
			id:     "prom_context_switches",
			promql: fmt.Sprintf(`rate(node_context_switches_total{instance=~"%s"}[5m])`, inst),
		},
	}

	for _, m := range metrics {
		if !wantMetric(m.id) {
			continue
		}
		resp, err := c.queryRange(ctx, qctx.ConnectionID, qctx.Connection, m.promql,
			req.ResourceData, req.StartTime, req.EndTime, req.Step)
		if err != nil {
			log.Printf("prometheus range query %s failed: %v", m.id, err)
			continue
		}
		points := extractTimeSeries(resp)
		if len(points) == 0 {
			continue
		}
		results = append(results, sdkmetric.MetricResult{
			TimeSeries: &sdkmetric.TimeSeries{
				MetricID:   m.id,
				DataPoints: points,
				Labels:     labels,
			},
		})
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// nsFilter returns a PromQL namespace label filter clause.
// When namespace is non-empty it returns `,namespace="<ns>"`, otherwise "".
func nsFilter(namespace string) string {
	if namespace != "" {
		return fmt.Sprintf(`,namespace="%s"`, namespace)
	}
	return ""
}

// --- Cluster Prometheus Queries ---

func (c *prometheusClient) queryClusterPrometheus(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	now := time.Now()
	ns := nsFilter(req.ResourceNamespace)

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)
	labels := map[string]string{"scope": "cluster"}

	type promMetric struct {
		id     string
		promql string
	}

	metrics := []promMetric{
		{
			id:     "prom_cluster_cpu_utilization",
			promql: `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100`,
		},
		{
			id:     "prom_cluster_memory_utilization",
			promql: `(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100`,
		},
		{
			id:     "prom_cluster_pod_count",
			promql: `count(kube_pod_info)`,
		},
		{
			id:     "prom_cluster_node_count",
			promql: `count(kube_node_info)`,
		},
		{
			id:     "prom_cluster_pod_running",
			promql: `count(kube_pod_status_phase{phase="Running"})`,
		},
		{
			id:     "prom_cluster_pod_pending",
			promql: `count(kube_pod_status_phase{phase="Pending"})`,
		},
		{
			id:     "prom_cluster_pod_failed",
			promql: `count(kube_pod_status_phase{phase="Failed"})`,
		},
		// --- Network I/O (namespace-filterable) ---
		{
			id:     "prom_cluster_network_receive_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{container!="POD"%s}[5m]))`, ns),
		},
		{
			id:     "prom_cluster_network_transmit_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{container!="POD"%s}[5m]))`, ns),
		},
		// --- Namespace workload aggregates (namespace-filterable) ---
		{
			id:     "prom_namespace_cpu_usage",
			promql: fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{container!="POD"%s}[5m]))`, ns),
		},
		{
			id:     "prom_namespace_memory_usage",
			promql: fmt.Sprintf(`sum(container_memory_working_set_bytes{container!="POD"%s})`, ns),
		},
		// --- Capacity metrics ---
		{
			id:     "prom_cluster_cpu_cores",
			promql: `sum(machine_cpu_cores)`,
		},
		{
			id:     "prom_cluster_memory_total",
			promql: `sum(node_memory_MemTotal_bytes)`,
		},
		{
			id:     "prom_cluster_pod_capacity",
			promql: `sum(kube_node_status_allocatable{resource="pods"})`,
		},
		{
			id:     "prom_cluster_fs_total",
			promql: `sum(node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})`,
		},
		{
			id:     "prom_cluster_fs_usage_pct",
			promql: `(1 - sum(node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"}) / sum(node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100`,
		},
		// --- Resource requests vs allocatable ---
		{
			id:     "prom_cluster_cpu_requests_pct",
			promql: `sum(kube_pod_container_resource_requests{resource="cpu"}) / sum(kube_node_status_allocatable{resource="cpu"}) * 100`,
		},
		{
			id:     "prom_cluster_memory_requests_pct",
			promql: `sum(kube_pod_container_resource_requests{resource="memory"}) / sum(kube_node_status_allocatable{resource="memory"}) * 100`,
		},
	}

	for _, m := range metrics {
		if !wantMetric(m.id) {
			continue
		}
		resp, err := c.query(ctx, qctx.ConnectionID, qctx.Connection, m.promql, req.ResourceData)
		if err != nil {
			log.Printf("prometheus query %s failed: %v", m.id, err)
			continue
		}
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  m.id,
				Value:     extractScalarValue(resp),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// --- Cluster Prometheus Time-Series Queries ---

func (c *prometheusClient) queryClusterPrometheusTimeseries(
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	detection, err := c.detect(qctx.ConnectionID, qctx.Connection, req.ResourceData)
	if err != nil || !detection.Found {
		return &sdkmetric.QueryResponse{Success: true, Results: nil}, nil
	}

	ctx := context.Background()
	ns := nsFilter(req.ResourceNamespace)

	wantAll := len(req.MetricIDs) == 0
	wantMetric := makeWantFunc(req.MetricIDs, wantAll)

	results := make([]sdkmetric.MetricResult, 0)
	labels := map[string]string{"scope": "cluster"}

	type promMetric struct {
		id     string
		promql string
	}

	metrics := []promMetric{
		{
			id:     "prom_cluster_cpu_utilization",
			promql: `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100`,
		},
		{
			id:     "prom_cluster_memory_utilization",
			promql: `(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100`,
		},
		// --- Network I/O (namespace-filterable) ---
		{
			id:     "prom_cluster_network_receive_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{container!="POD"%s}[5m]))`, ns),
		},
		{
			id:     "prom_cluster_network_transmit_rate",
			promql: fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{container!="POD"%s}[5m]))`, ns),
		},
		// --- Namespace workload aggregates (namespace-filterable) ---
		{
			id:     "prom_namespace_cpu_usage",
			promql: fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{container!="POD"%s}[5m]))`, ns),
		},
		{
			id:     "prom_namespace_memory_usage",
			promql: fmt.Sprintf(`sum(container_memory_working_set_bytes{container!="POD"%s})`, ns),
		},
		// --- Capacity metrics (time-series) ---
		{
			id:     "prom_cluster_cpu_cores",
			promql: `sum(machine_cpu_cores)`,
		},
		{
			id:     "prom_cluster_cpu_usage_cores",
			promql: `sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]))`,
		},
		{
			id:     "prom_cluster_memory_total",
			promql: `sum(node_memory_MemTotal_bytes)`,
		},
		{
			id:     "prom_cluster_memory_usage",
			promql: `sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)`,
		},
		// --- Filesystem ---
		{
			id:     "prom_cluster_fs_usage_pct",
			promql: `(1 - sum(node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"}) / sum(node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100`,
		},
		// --- Disk I/O ---
		{
			id:     "prom_cluster_disk_read_rate",
			promql: `sum(rate(node_disk_read_bytes_total[5m]))`,
		},
		{
			id:     "prom_cluster_disk_write_rate",
			promql: `sum(rate(node_disk_written_bytes_total[5m]))`,
		},
		// --- Load averages ---
		{
			id:     "prom_cluster_load1",
			promql: `sum(node_load1)`,
		},
		{
			id:     "prom_cluster_load5",
			promql: `sum(node_load5)`,
		},
		{
			id:     "prom_cluster_load15",
			promql: `sum(node_load15)`,
		},
		// --- Resource requests vs allocatable ---
		{
			id:     "prom_cluster_cpu_requests_pct",
			promql: `sum(kube_pod_container_resource_requests{resource="cpu"}) / sum(kube_node_status_allocatable{resource="cpu"}) * 100`,
		},
		{
			id:     "prom_cluster_memory_requests_pct",
			promql: `sum(kube_pod_container_resource_requests{resource="memory"}) / sum(kube_node_status_allocatable{resource="memory"}) * 100`,
		},
		// --- Container health ---
		{
			id:     "prom_cluster_container_restarts",
			promql: `sum(rate(kube_pod_container_status_restarts_total[5m]))`,
		},
		{
			id:     "prom_cluster_oom_events",
			promql: `sum(rate(container_oom_events_total[5m]))`,
		},
		// --- Namespace-scoped container restarts ---
		{
			id:     "prom_namespace_container_restarts",
			promql: fmt.Sprintf(`sum(rate(kube_pod_container_status_restarts_total{%s}[5m]))`, strings.TrimPrefix(ns, ",")),
		},
	}

	for _, m := range metrics {
		if !wantMetric(m.id) {
			continue
		}
		resp, err := c.queryRange(ctx, qctx.ConnectionID, qctx.Connection, m.promql,
			req.ResourceData, req.StartTime, req.EndTime, req.Step)
		if err != nil {
			log.Printf("prometheus range query %s failed: %v", m.id, err)
			continue
		}
		points := extractTimeSeries(resp)
		if len(points) == 0 {
			continue
		}
		results = append(results, sdkmetric.MetricResult{
			TimeSeries: &sdkmetric.TimeSeries{
				MetricID:   m.id,
				DataPoints: points,
				Labels:     labels,
			},
		})
	}

	return &sdkmetric.QueryResponse{Success: true, Results: results}, nil
}

// makeWantFunc returns a function that checks whether a metric ID is requested.
func makeWantFunc(metricIDs []string, wantAll bool) func(string) bool {
	return func(id string) bool {
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
}

// mapKeys returns the keys of a map for debug logging.
func mapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// extractResourceName extracts metadata.name from resourceData (the full K8s object).
// Falls back to the provided fallback (typically req.ResourceID) if not found.
func extractResourceName(resourceData map[string]interface{}, fallback string) string {
	meta, ok := resourceData["metadata"].(map[string]interface{})
	if !ok {
		return fallback
	}
	name, ok := meta["name"].(string)
	if !ok || name == "" {
		return fallback
	}
	return name
}

// extractResourceNamespace extracts metadata.namespace from resourceData.
// Falls back to the provided fallback (typically req.ResourceNamespace) if not found.
func extractResourceNamespace(resourceData map[string]interface{}, fallback string) string {
	meta, ok := resourceData["metadata"].(map[string]interface{})
	if !ok {
		return fallback
	}
	ns, ok := meta["namespace"].(string)
	if !ok || ns == "" {
		return fallback
	}
	return ns
}
