package metric

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/metric"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1 "k8s.io/api/core/v1"
)

var errTest = fmt.Errorf("test error")

// --- extractScalarValue ---

func TestExtractScalarValue_ValidResult(t *testing.T) {
	resp := &promAPIResponse{
		Status: "success",
		Data: promDataBody{
			ResultType: "vector",
			Result: []promVectorResult{
				{
					Metric: map[string]string{"pod": "test"},
					Value:  [2]interface{}{1234567890.0, "42.5"},
				},
			},
		},
	}
	assert.InDelta(t, 42.5, extractScalarValue(resp), 0.001)
}

func TestExtractScalarValue_EmptyResults(t *testing.T) {
	resp := &promAPIResponse{
		Status: "success",
		Data:   promDataBody{Result: []promVectorResult{}},
	}
	assert.Equal(t, 0.0, extractScalarValue(resp))
}

func TestExtractScalarValue_NilResponse(t *testing.T) {
	assert.Equal(t, 0.0, extractScalarValue(nil))
}

func TestExtractScalarValue_NonStringValue(t *testing.T) {
	resp := &promAPIResponse{
		Data: promDataBody{
			Result: []promVectorResult{
				{Value: [2]interface{}{1234567890.0, 42.5}}, // float, not string
			},
		},
	}
	assert.Equal(t, 0.0, extractScalarValue(resp))
}

func TestExtractScalarValue_SpecialValues(t *testing.T) {
	for _, val := range []string{"NaN", "+Inf", "-Inf"} {
		t.Run(val, func(t *testing.T) {
			resp := &promAPIResponse{
				Data: promDataBody{
					Result: []promVectorResult{
						{Value: [2]interface{}{0.0, val}},
					},
				},
			}
			assert.Equal(t, 0.0, extractScalarValue(resp))
		})
	}
}

func TestExtractScalarValue_Zero(t *testing.T) {
	resp := &promAPIResponse{
		Data: promDataBody{
			Result: []promVectorResult{
				{Value: [2]interface{}{0.0, "0"}},
			},
		},
	}
	assert.Equal(t, 0.0, extractScalarValue(resp))
}

func TestExtractScalarValue_ScientificNotation(t *testing.T) {
	resp := &promAPIResponse{
		Data: promDataBody{
			Result: []promVectorResult{
				{Value: [2]interface{}{0.0, "1.5e+09"}},
			},
		},
	}
	assert.InDelta(t, 1.5e+09, extractScalarValue(resp), 1)
}

func TestExtractScalarValue_ShortValueSlice(t *testing.T) {
	resp := &promAPIResponse{
		Data: promDataBody{
			Result: []promVectorResult{
				{Value: [2]interface{}{0.0}},
			},
		},
	}
	// Value at index 1 is zero-value (nil), should return 0.
	assert.Equal(t, 0.0, extractScalarValue(resp))
}

// --- makeWantFunc ---

func TestMakeWantFunc_WantAll(t *testing.T) {
	fn := makeWantFunc(nil, true)
	assert.True(t, fn("anything"))
	assert.True(t, fn("prom_cpu_usage_rate"))
}

func TestMakeWantFunc_SpecificIDs(t *testing.T) {
	fn := makeWantFunc([]string{"cpu_usage", "prom_memory_rss"}, false)
	assert.True(t, fn("cpu_usage"))
	assert.True(t, fn("prom_memory_rss"))
	assert.False(t, fn("memory_usage"))
}

func TestMakeWantFunc_EmptyListNotWantAll(t *testing.T) {
	fn := makeWantFunc([]string{}, false)
	assert.False(t, fn("anything"), "empty list with wantAll=false should match nothing")
}

// --- mergeResponses ---

func TestMergeResponses_BothSuccessful(t *testing.T) {
	msResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "cpu_usage", Value: 100}},
		},
	}
	promResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "prom_cpu_usage_rate", Value: 0.5}},
		},
	}

	merged, err := mergeResponses(msResp, nil, promResp, nil)
	require.NoError(t, err)
	assert.True(t, merged.Success)
	assert.Len(t, merged.Results, 2)
}

func TestMergeResponses_MetricsServerOnly(t *testing.T) {
	msResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "cpu_usage", Value: 100}},
		},
	}

	merged, err := mergeResponses(msResp, nil, nil, nil)
	require.NoError(t, err)
	assert.Len(t, merged.Results, 1)
}

func TestMergeResponses_PrometheusOnly(t *testing.T) {
	promResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "prom_cpu_usage_rate", Value: 0.5}},
		},
	}

	merged, err := mergeResponses(nil, nil, promResp, nil)
	require.NoError(t, err)
	assert.Len(t, merged.Results, 1)
}

func TestMergeResponses_BothFailed(t *testing.T) {
	_, err := mergeResponses(nil, errTest, nil, errTest)
	require.Error(t, err)
}

func TestMergeResponses_MetricsServerFailsPrometheusSucceeds(t *testing.T) {
	promResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "prom_cpu_usage_rate", Value: 0.5}},
		},
	}

	merged, err := mergeResponses(nil, errTest, promResp, nil)
	require.NoError(t, err)
	assert.True(t, merged.Success)
	assert.Len(t, merged.Results, 1)
}

func TestMergeResponses_EmptyResults(t *testing.T) {
	msResp := &sdkmetric.QueryResponse{Success: true, Results: nil}
	promResp := &sdkmetric.QueryResponse{Success: true, Results: nil}

	merged, err := mergeResponses(msResp, nil, promResp, nil)
	require.NoError(t, err)
	assert.True(t, merged.Success)
	assert.Empty(t, merged.Results)
}

func TestMergeResponses_GracefulDegradation(t *testing.T) {
	// MS fails, Prom returns success with no results (not installed).
	promResp := &sdkmetric.QueryResponse{Success: true, Results: nil}
	msErr := fmt.Errorf("metrics API not available")

	merged, err := mergeResponses(nil, msErr, promResp, nil)
	require.NoError(t, err)
	assert.True(t, merged.Success)
	assert.Empty(t, merged.Results)
}

func TestMergeResponses_MetricsServerComesOnline(t *testing.T) {
	// Round 1: both fail.
	_, err := mergeResponses(nil, errTest, nil, errTest)
	require.Error(t, err)

	// Round 2: metrics-server starts returning data.
	msResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "cpu_usage", Value: 250}},
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "memory_usage", Value: 1024 * 1024 * 512}},
		},
	}

	merged, err := mergeResponses(msResp, nil, nil, errTest)
	require.NoError(t, err)
	assert.True(t, merged.Success)
	assert.Len(t, merged.Results, 2)
}

func TestMergeResponses_PrometheusComesOnline(t *testing.T) {
	// Round 1: MS fails, Prom not detected.
	promEmpty := &sdkmetric.QueryResponse{Success: true, Results: nil}
	merged, err := mergeResponses(nil, errTest, promEmpty, nil)
	require.NoError(t, err)
	assert.Empty(t, merged.Results)

	// Round 2: Prom now detected.
	promResp := &sdkmetric.QueryResponse{
		Success: true,
		Results: []sdkmetric.MetricResult{
			{CurrentValue: &sdkmetric.CurrentValue{MetricID: "prom_cpu_usage_rate", Value: 0.35}},
		},
	}
	merged, err = mergeResponses(nil, errTest, promResp, nil)
	require.NoError(t, err)
	assert.Len(t, merged.Results, 1)
}

// --- parseQuantityString ---

func TestParseQuantityString(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		resource string
		expected float64
	}{
		{"cpu cores", "4", "cpu", 4000},
		{"cpu millicores", "250m", "cpu", 250},
		{"cpu fractional cores", "1.5", "cpu", 1500},
		{"memory Ki", "1024Ki", "memory", 1024 * 1024},
		{"memory Mi", "512Mi", "memory", 512 * 1024 * 1024},
		{"memory Gi", "16Gi", "memory", 16 * 1024 * 1024 * 1024},
		{"memory Ti", "1Ti", "memory", 1024 * 1024 * 1024 * 1024},
		{"memory bytes", "1073741824", "memory", 1073741824},
		{"zero cpu", "0", "cpu", 0},
		{"zero memory", "0", "memory", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseQuantityString(tt.input, tt.resource)
			assert.InDelta(t, tt.expected, result, 0.001)
		})
	}
}

// --- extractNodeCapacity ---

func TestExtractNodeCapacity(t *testing.T) {
	t.Run("cpu from string", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{
				"capacity": map[string]interface{}{
					"cpu": "8",
				},
			},
		}
		assert.InDelta(t, 8000.0, extractNodeCapacity(data, "cpu"), 0.001)
	})

	t.Run("cpu from float64", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{
				"capacity": map[string]interface{}{
					"cpu": float64(4),
				},
			},
		}
		assert.InDelta(t, 4000.0, extractNodeCapacity(data, "cpu"), 0.001)
	})

	t.Run("memory from string Gi", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{
				"capacity": map[string]interface{}{
					"memory": "32Gi",
				},
			},
		}
		assert.InDelta(t, 32*1024*1024*1024, extractNodeCapacity(data, "memory"), 0.001)
	})

	t.Run("memory from float64", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{
				"capacity": map[string]interface{}{
					"memory": float64(1073741824),
				},
			},
		}
		assert.InDelta(t, 1073741824.0, extractNodeCapacity(data, "memory"), 0.001)
	})

	t.Run("missing status", func(t *testing.T) {
		assert.Equal(t, 0.0, extractNodeCapacity(map[string]interface{}{}, "cpu"))
	})

	t.Run("missing capacity", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{},
		}
		assert.Equal(t, 0.0, extractNodeCapacity(data, "cpu"))
	})

	t.Run("missing resource key", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{
				"capacity": map[string]interface{}{},
			},
		}
		assert.Equal(t, 0.0, extractNodeCapacity(data, "cpu"))
	})

	t.Run("wrong type for status", func(t *testing.T) {
		data := map[string]interface{}{
			"status": "not a map",
		}
		assert.Equal(t, 0.0, extractNodeCapacity(data, "cpu"))
	})

	t.Run("wrong type for value", func(t *testing.T) {
		data := map[string]interface{}{
			"status": map[string]interface{}{
				"capacity": map[string]interface{}{
					"cpu": 42, // int, not float64 or string
				},
			},
		}
		assert.Equal(t, 0.0, extractNodeCapacity(data, "cpu"))
	})
}

// --- buildPodMetricResponse ---

func TestBuildPodMetricResponse_AllMetrics(t *testing.T) {
	pm := &metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
		},
		Containers: []metricsv1beta1.ContainerMetrics{
			{
				Name: "app",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("100m"),
					corev1.ResourceMemory: resource.MustParse("256Mi"),
				},
			},
			{
				Name: "sidecar",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("50m"),
					corev1.ResourceMemory: resource.MustParse("64Mi"),
				},
			},
		},
	}

	resp := buildPodMetricResponse(pm, nil) // nil = want all
	require.True(t, resp.Success)
	require.Len(t, resp.Results, 2)

	// Find CPU and memory results.
	var cpuResult, memResult *sdkmetric.MetricResult
	for i := range resp.Results {
		switch resp.Results[i].CurrentValue.MetricID {
		case "cpu_usage":
			cpuResult = &resp.Results[i]
		case "memory_usage":
			memResult = &resp.Results[i]
		}
	}

	require.NotNil(t, cpuResult)
	require.NotNil(t, memResult)

	// 100m + 50m = 150 millicores
	assert.InDelta(t, 150.0, cpuResult.CurrentValue.Value, 0.001)
	// 256Mi + 64Mi = 320Mi
	assert.InDelta(t, float64(320*1024*1024), memResult.CurrentValue.Value, 0.001)

	// Labels should identify the pod.
	assert.Equal(t, "my-pod", cpuResult.CurrentValue.Labels["pod"])
	assert.Equal(t, "default", cpuResult.CurrentValue.Labels["namespace"])
}

func TestBuildPodMetricResponse_FilteredMetricIDs(t *testing.T) {
	pm := &metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "ns"},
		Containers: []metricsv1beta1.ContainerMetrics{
			{
				Name: "c",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("100m"),
					corev1.ResourceMemory: resource.MustParse("256Mi"),
				},
			},
		},
	}

	// Only request CPU.
	resp := buildPodMetricResponse(pm, []string{"cpu_usage"})
	require.True(t, resp.Success)
	require.Len(t, resp.Results, 1)
	assert.Equal(t, "cpu_usage", resp.Results[0].CurrentValue.MetricID)
}

func TestBuildPodMetricResponse_NoContainers(t *testing.T) {
	pm := &metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "empty-pod"},
		Containers: nil,
	}

	resp := buildPodMetricResponse(pm, nil)
	assert.True(t, resp.Success)
	// CPU and memory should be 0.
	for _, r := range resp.Results {
		assert.Equal(t, 0.0, r.CurrentValue.Value)
	}
}

func TestBuildPodMetricResponse_TimestampIsRecent(t *testing.T) {
	pm := &metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "pod"},
		Containers: []metricsv1beta1.ContainerMetrics{
			{
				Name: "c",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU: resource.MustParse("100m"),
				},
			},
		},
	}

	before := time.Now()
	resp := buildPodMetricResponse(pm, []string{"cpu_usage"})
	after := time.Now()

	require.Len(t, resp.Results, 1)
	ts := resp.Results[0].CurrentValue.Timestamp
	assert.True(t, !ts.Before(before) && !ts.After(after),
		"timestamp should be between before and after call")
}

// --- buildNodeMetricResponse ---

func TestBuildNodeMetricResponse_AllMetrics(t *testing.T) {
	nm := &metricsv1beta1.NodeMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Usage: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("2000m"),
			corev1.ResourceMemory: resource.MustParse("8Gi"),
		},
	}
	resourceData := map[string]interface{}{
		"status": map[string]interface{}{
			"capacity": map[string]interface{}{
				"cpu":    "8",
				"memory": "32Gi",
			},
		},
	}

	resp := buildNodeMetricResponse(nm, nil, resourceData) // nil = want all
	require.True(t, resp.Success)

	byID := make(map[string]*sdkmetric.MetricResult)
	for i := range resp.Results {
		byID[resp.Results[i].CurrentValue.MetricID] = &resp.Results[i]
	}

	require.Contains(t, byID, "cpu_usage")
	require.Contains(t, byID, "memory_usage")
	require.Contains(t, byID, "cpu_capacity")
	require.Contains(t, byID, "memory_capacity")

	assert.InDelta(t, 2000.0, byID["cpu_usage"].CurrentValue.Value, 0.001)
	assert.InDelta(t, float64(8*1024*1024*1024), byID["memory_usage"].CurrentValue.Value, 0.001)
	assert.InDelta(t, 8000.0, byID["cpu_capacity"].CurrentValue.Value, 0.001)
	assert.InDelta(t, float64(32*1024*1024*1024), byID["memory_capacity"].CurrentValue.Value, 0.001)

	assert.Equal(t, "node-1", byID["cpu_usage"].CurrentValue.Labels["node"])
}

func TestBuildNodeMetricResponse_NilResourceData(t *testing.T) {
	nm := &metricsv1beta1.NodeMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Usage: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("1000m"),
			corev1.ResourceMemory: resource.MustParse("4Gi"),
		},
	}

	// nil resourceData means no capacity metrics.
	resp := buildNodeMetricResponse(nm, nil, nil)
	require.True(t, resp.Success)

	// Should only have usage metrics, no capacity.
	for _, r := range resp.Results {
		assert.NotContains(t, r.CurrentValue.MetricID, "capacity")
	}
}

func TestBuildNodeMetricResponse_FilteredMetricIDs(t *testing.T) {
	nm := &metricsv1beta1.NodeMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Usage: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("1000m"),
			corev1.ResourceMemory: resource.MustParse("4Gi"),
		},
	}

	resp := buildNodeMetricResponse(nm, []string{"memory_usage"}, nil)
	require.True(t, resp.Success)
	require.Len(t, resp.Results, 1)
	assert.Equal(t, "memory_usage", resp.Results[0].CurrentValue.MetricID)
}

// --- queryMetricsServer routing ---

func TestQueryMetricsServer_UnsupportedResourceKey(t *testing.T) {
	qctx := &sdkmetric.QueryContext{}
	req := sdkmetric.QueryRequest{ResourceKey: "batch::v1::Job"}

	resp, err := queryMetricsServer(qctx, req)
	require.NoError(t, err)
	assert.False(t, resp.Success)
	assert.Contains(t, resp.Error, "unsupported resource key")
}
