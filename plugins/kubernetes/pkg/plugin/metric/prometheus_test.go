package metric

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/metric"
)

// ---------------------------------------------------------------------------
// parsePromPair
// ---------------------------------------------------------------------------

func TestParsePromPair(t *testing.T) {
	tests := []struct {
		name     string
		pair     [2]interface{}
		wantTime time.Time
		wantVal  float64
	}{
		{
			name:     "valid float64 timestamp and string value",
			pair:     [2]interface{}{float64(1700000000), "123.456"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  123.456,
		},
		{
			name:     "integer-like float64 timestamp",
			pair:     [2]interface{}{float64(0), "99"},
			wantTime: time.Unix(0, 0),
			wantVal:  99,
		},
		{
			name:     "negative value",
			pair:     [2]interface{}{float64(1700000000), "-42.5"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  -42.5,
		},
		{
			name:     "scientific notation value",
			pair:     [2]interface{}{float64(1700000000), "1.5e3"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  1500,
		},
		{
			name:     "scientific notation negative exponent",
			pair:     [2]interface{}{float64(1700000000), "2.5e-2"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0.025,
		},
		{
			name:     "zero value string",
			pair:     [2]interface{}{float64(1700000000), "0"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "very large value",
			pair:     [2]interface{}{float64(1700000000), "999999999999.999"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  999999999999.999,
		},

		// --- NaN / Inf cases ---
		{
			name:     "NaN value returns 0",
			pair:     [2]interface{}{float64(1700000000), "NaN"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "+Inf value returns 0",
			pair:     [2]interface{}{float64(1700000000), "+Inf"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "-Inf value returns 0",
			pair:     [2]interface{}{float64(1700000000), "-Inf"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},

		// --- Non-float64 timestamp -> zero time ---
		{
			name:     "string timestamp returns zero time",
			pair:     [2]interface{}{"1700000000", "42"},
			wantTime: time.Time{},
			wantVal:  42,
		},
		{
			name:     "nil timestamp returns zero time",
			pair:     [2]interface{}{nil, "42"},
			wantTime: time.Time{},
			wantVal:  42,
		},
		{
			name:     "int timestamp returns zero time (not float64)",
			pair:     [2]interface{}{int(1700000000), "42"},
			wantTime: time.Time{},
			wantVal:  42,
		},
		{
			name:     "int64 timestamp returns zero time (not float64)",
			pair:     [2]interface{}{int64(1700000000), "42"},
			wantTime: time.Time{},
			wantVal:  42,
		},

		// --- Non-string value -> 0 ---
		{
			name:     "float64 value (not string) returns 0",
			pair:     [2]interface{}{float64(1700000000), float64(42)},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "nil value returns 0",
			pair:     [2]interface{}{float64(1700000000), nil},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "int value (not string) returns 0",
			pair:     [2]interface{}{float64(1700000000), 42},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "bool value (not string) returns 0",
			pair:     [2]interface{}{float64(1700000000), true},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},

		// --- Invalid string values -> 0 ---
		{
			name:     "non-numeric string returns 0",
			pair:     [2]interface{}{float64(1700000000), "abc"},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "empty string returns 0",
			pair:     [2]interface{}{float64(1700000000), ""},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},
		{
			name:     "whitespace-only string returns 0",
			pair:     [2]interface{}{float64(1700000000), "   "},
			wantTime: time.Unix(1700000000, 0),
			wantVal:  0,
		},

		// --- Both invalid ---
		{
			name:     "both non-float64 timestamp and non-string value",
			pair:     [2]interface{}{"bad", 99},
			wantTime: time.Time{},
			wantVal:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotTime, gotVal := parsePromPair(tt.pair)
			assert.Equal(t, tt.wantTime, gotTime, "timestamp mismatch")
			assert.InDelta(t, tt.wantVal, gotVal, 1e-9, "value mismatch")
		})
	}
}

// ---------------------------------------------------------------------------
// extractTimeSeries
// ---------------------------------------------------------------------------

func TestExtractTimeSeries(t *testing.T) {
	t.Run("nil response returns nil", func(t *testing.T) {
		result := extractTimeSeries(nil)
		assert.Nil(t, result)
	})

	t.Run("empty result array returns nil", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result:     []promMatrixResult{},
			},
		}
		result := extractTimeSeries(resp)
		assert.Nil(t, result)
	})

	t.Run("single series with multiple data points", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{"pod": "test"},
						Values: [][2]interface{}{
							{float64(1000), "10.5"},
							{float64(1060), "20.3"},
							{float64(1120), "30.1"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 3)

		assert.Equal(t, time.Unix(1000, 0), result[0].Timestamp)
		assert.InDelta(t, 10.5, result[0].Value, 1e-9)

		assert.Equal(t, time.Unix(1060, 0), result[1].Timestamp)
		assert.InDelta(t, 20.3, result[1].Value, 1e-9)

		assert.Equal(t, time.Unix(1120, 0), result[2].Timestamp)
		assert.InDelta(t, 30.1, result[2].Value, 1e-9)
	})

	t.Run("single series with one data point", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{},
						Values: [][2]interface{}{
							{float64(5000), "99.9"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 1)
		assert.Equal(t, time.Unix(5000, 0), result[0].Timestamp)
		assert.InDelta(t, 99.9, result[0].Value, 1e-9)
	})

	t.Run("multiple series summed at same timestamps", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{"container": "app"},
						Values: [][2]interface{}{
							{float64(1000), "10"},
							{float64(1060), "20"},
						},
					},
					{
						Metric: map[string]string{"container": "sidecar"},
						Values: [][2]interface{}{
							{float64(1000), "5"},
							{float64(1060), "15"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 2)

		// 10 + 5 = 15 at t=1000
		assert.Equal(t, time.Unix(1000, 0), result[0].Timestamp)
		assert.InDelta(t, 15.0, result[0].Value, 1e-9)

		// 20 + 15 = 35 at t=1060
		assert.Equal(t, time.Unix(1060, 0), result[1].Timestamp)
		assert.InDelta(t, 35.0, result[1].Value, 1e-9)
	})

	t.Run("multiple series with three containers", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{"container": "a"},
						Values: [][2]interface{}{
							{float64(2000), "100"},
						},
					},
					{
						Metric: map[string]string{"container": "b"},
						Values: [][2]interface{}{
							{float64(2000), "200"},
						},
					},
					{
						Metric: map[string]string{"container": "c"},
						Values: [][2]interface{}{
							{float64(2000), "300"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 1)
		assert.InDelta(t, 600.0, result[0].Value, 1e-9)
	})

	t.Run("multiple series with non-overlapping timestamps", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{"container": "a"},
						Values: [][2]interface{}{
							{float64(1000), "10"},
						},
					},
					{
						Metric: map[string]string{"container": "b"},
						Values: [][2]interface{}{
							{float64(2000), "20"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 2)

		assert.Equal(t, time.Unix(1000, 0), result[0].Timestamp)
		assert.InDelta(t, 10.0, result[0].Value, 1e-9)

		assert.Equal(t, time.Unix(2000, 0), result[1].Timestamp)
		assert.InDelta(t, 20.0, result[1].Value, 1e-9)
	})

	t.Run("pairs with zero-time (non-float64 timestamp) are skipped", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{},
						Values: [][2]interface{}{
							{"bad_timestamp", "10"},      // skipped: string timestamp
							{float64(1000), "20"},        // kept
							{nil, "30"},                  // skipped: nil timestamp
							{float64(1060), "40"},        // kept
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 2)

		assert.Equal(t, time.Unix(1000, 0), result[0].Timestamp)
		assert.InDelta(t, 20.0, result[0].Value, 1e-9)

		assert.Equal(t, time.Unix(1060, 0), result[1].Timestamp)
		assert.InDelta(t, 40.0, result[1].Value, 1e-9)
	})

	t.Run("single series with NaN values keeps point with 0 value", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{},
						Values: [][2]interface{}{
							{float64(1000), "NaN"},
							{float64(1060), "42"},
							{float64(1120), "+Inf"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 3)

		// NaN -> value 0, but timestamp is valid so point is kept
		assert.Equal(t, time.Unix(1000, 0), result[0].Timestamp)
		assert.InDelta(t, 0.0, result[0].Value, 1e-9)

		assert.Equal(t, time.Unix(1060, 0), result[1].Timestamp)
		assert.InDelta(t, 42.0, result[1].Value, 1e-9)

		// +Inf -> value 0, but timestamp is valid so point is kept
		assert.Equal(t, time.Unix(1120, 0), result[2].Timestamp)
		assert.InDelta(t, 0.0, result[2].Value, 1e-9)
	})

	t.Run("all pairs have zero-time returns empty slice", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{},
						Values: [][2]interface{}{
							{"bad", "10"},
							{nil, "20"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		assert.Empty(t, result)
	})

	t.Run("single series with empty values array", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{},
						Values: [][2]interface{}{},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		assert.Empty(t, result)
	})

	t.Run("multiple series with zero-time pairs skipped in aggregation", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{"container": "a"},
						Values: [][2]interface{}{
							{float64(1000), "10"},
							{"bad", "999"},            // skipped
						},
					},
					{
						Metric: map[string]string{"container": "b"},
						Values: [][2]interface{}{
							{float64(1000), "5"},
							{float64(1060), "25"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 2)

		// t=1000: 10 + 5 = 15
		assert.Equal(t, time.Unix(1000, 0), result[0].Timestamp)
		assert.InDelta(t, 15.0, result[0].Value, 1e-9)

		// t=1060: only series b contributes
		assert.Equal(t, time.Unix(1060, 0), result[1].Timestamp)
		assert.InDelta(t, 25.0, result[1].Value, 1e-9)
	})

	t.Run("verifies output type matches sdk DataPoint", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{},
						Values: [][2]interface{}{
							{float64(1000), "1.5"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 1)

		// Confirm the result type is sdkmetric.DataPoint.
		var dp sdkmetric.DataPoint = result[0]
		assert.Equal(t, time.Unix(1000, 0), dp.Timestamp)
		assert.InDelta(t, 1.5, dp.Value, 1e-9)
	})

	t.Run("order is preserved for multiple series aggregation", func(t *testing.T) {
		resp := &promMatrixAPIResponse{
			Status: "success",
			Data: promMatrixDataBody{
				ResultType: "matrix",
				Result: []promMatrixResult{
					{
						Metric: map[string]string{"container": "a"},
						Values: [][2]interface{}{
							{float64(3000), "1"},
							{float64(1000), "2"},
							{float64(2000), "3"},
						},
					},
					{
						Metric: map[string]string{"container": "b"},
						Values: [][2]interface{}{
							{float64(3000), "10"},
							{float64(1000), "20"},
							{float64(2000), "30"},
						},
					},
				},
			},
		}

		result := extractTimeSeries(resp)
		require.Len(t, result, 3)

		// Order follows first series' encounter order: 3000, 1000, 2000
		assert.Equal(t, time.Unix(3000, 0), result[0].Timestamp)
		assert.InDelta(t, 11.0, result[0].Value, 1e-9)

		assert.Equal(t, time.Unix(1000, 0), result[1].Timestamp)
		assert.InDelta(t, 22.0, result[1].Value, 1e-9)

		assert.Equal(t, time.Unix(2000, 0), result[2].Timestamp)
		assert.InDelta(t, 33.0, result[2].Value, 1e-9)
	})
}

// ---------------------------------------------------------------------------
// extractResourceName
// ---------------------------------------------------------------------------

func TestExtractResourceName(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		fallback string
		want     string
	}{
		{
			name: "extracts name from metadata",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"name": "my-pod"},
			},
			fallback: "fallback-id",
			want:     "my-pod",
		},
		{
			name:     "nil data returns fallback",
			data:     nil,
			fallback: "fallback-id",
			want:     "fallback-id",
		},
		{
			name:     "empty data returns fallback",
			data:     map[string]interface{}{},
			fallback: "fallback-id",
			want:     "fallback-id",
		},
		{
			name: "metadata not a map returns fallback",
			data: map[string]interface{}{
				"metadata": "not-a-map",
			},
			fallback: "fallback-id",
			want:     "fallback-id",
		},
		{
			name: "name missing from metadata returns fallback",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"namespace": "default"},
			},
			fallback: "fallback-id",
			want:     "fallback-id",
		},
		{
			name: "name is empty string returns fallback",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"name": ""},
			},
			fallback: "fallback-id",
			want:     "fallback-id",
		},
		{
			name: "name is non-string returns fallback",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"name": 42},
			},
			fallback: "fallback-id",
			want:     "fallback-id",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, extractResourceName(tt.data, tt.fallback))
		})
	}
}

// ---------------------------------------------------------------------------
// extractResourceNamespace
// ---------------------------------------------------------------------------

func TestExtractResourceNamespace(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		fallback string
		want     string
	}{
		{
			name: "extracts namespace from metadata",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"namespace": "kube-system"},
			},
			fallback: "default",
			want:     "kube-system",
		},
		{
			name:     "nil data returns fallback",
			data:     nil,
			fallback: "default",
			want:     "default",
		},
		{
			name:     "empty data returns fallback",
			data:     map[string]interface{}{},
			fallback: "default",
			want:     "default",
		},
		{
			name: "metadata not a map returns fallback",
			data: map[string]interface{}{
				"metadata": 123,
			},
			fallback: "default",
			want:     "default",
		},
		{
			name: "namespace missing from metadata returns fallback",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"name": "my-pod"},
			},
			fallback: "default",
			want:     "default",
		},
		{
			name: "namespace is empty string returns fallback",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{"namespace": ""},
			},
			fallback: "default",
			want:     "default",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, extractResourceNamespace(tt.data, tt.fallback))
		})
	}
}

// ---------------------------------------------------------------------------
// mapKeys
// ---------------------------------------------------------------------------

func TestMapKeys(t *testing.T) {
	t.Run("returns keys of map", func(t *testing.T) {
		m := map[string]interface{}{
			"cpu":    100,
			"memory": 200,
			"disk":   300,
		}
		keys := mapKeys(m)
		assert.Len(t, keys, 3)
		assert.ElementsMatch(t, []string{"cpu", "memory", "disk"}, keys)
	})

	t.Run("empty map returns empty slice", func(t *testing.T) {
		keys := mapKeys(map[string]interface{}{})
		assert.Empty(t, keys)
	})

	t.Run("nil map returns empty slice", func(t *testing.T) {
		keys := mapKeys(nil)
		assert.Empty(t, keys)
	})
}
