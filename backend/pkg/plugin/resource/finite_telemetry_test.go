package resource

import (
	"context"
	"fmt"
	"testing"

	"github.com/omniviewdev/omniview/internal/telemetry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestFiniteOperationTelemetryRecordsReturnedWorkAndErrors(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })
	_, err := telemetry.NewMetrics(mp)
	require.NoError(t, err)

	ctrl, _ := newTestControllerWithEmitter(t)
	provider := finiteTestProvider("native")
	registerMockPlugin(ctrl, "private-plugin", provider)
	get := admittedGetRequest(t, ctrl, "private-plugin", "private-connection", "pods", "private-record")
	target := admittedReadTarget(t, ctrl, "private-plugin", "private-connection", "pods")
	enumerate := HostEnumerateRequest{TargetID: target.TargetID, Request: resourcev2.EnumerateRequest{Target: target.Target}}
	query := HostNativeQueryRequest{TargetID: target.TargetID, Request: resourcev2.NativeQueryRequest{Target: target.Target, Language: "native", Query: resourcev2.Value{Kind: "null"}}}
	mutation := resourcev2.MutationRequest{Route: get.Request.Route, Reference: get.Request.Reference, Operation: "update", Input: resourcev2.Value{Kind: "null"}}
	calls := []func() error{
		func() error { _, err := ctrl.Get(testInvocationContext(), "private-plugin", get); return err },
		func() error {
			_, err := ctrl.Enumerate(testInvocationContext(), "private-plugin", enumerate)
			return err
		},
		func() error { _, err := ctrl.NativeQuery(testInvocationContext(), "private-plugin", query); return err },
		func() error { _, err := ctrl.Mutate(testInvocationContext(), "private-plugin", mutation); return err },
	}
	for _, call := range calls {
		require.NoError(t, call())
	}
	failure := resourcev2.NewError("UNAVAILABLE", "private provider detail")
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		return resourcev2.Record{}, failure
	}
	provider.EnumerateFunc = func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		return resourcev2.SourcePage{}, failure
	}
	provider.NativeQueryFunc = func(context.Context, resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error) {
		return resourcev2.SourcePage{}, failure
	}
	provider.MutateFunc = func(context.Context, resourcev2.MutationRequest) (resourcev2.Record, error) {
		return resourcev2.Record{}, failure
	}
	for _, call := range calls {
		require.Error(t, call())
	}
	// Admission failures must also end their operation with the returned error.
	_, err = ctrl.Get(testInvocationContext(), "private-plugin", HostGetRequest{})
	require.Error(t, err)

	var collected metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &collected))
	var durations uint64
	var failures int64
	var records, callsCount, active int64
	for _, scope := range collected.ScopeMetrics {
		for _, measurement := range scope.Metrics {
			switch measurement.Name {
			case "omniview.resource.op_duration":
				data, ok := measurement.Data.(metricdata.Histogram[float64])
				require.True(t, ok)
				for _, point := range data.DataPoints {
					durations += point.Count
					require.NotContains(t, fmt.Sprint(point.Attributes.ToSlice()), "private-")
				}
			case "omniview.resource.op_errors":
				data, ok := measurement.Data.(metricdata.Sum[int64])
				require.True(t, ok)
				for _, point := range data.DataPoints {
					failures += point.Value
				}
			case "omniview.resource.records", "omniview.operation.calls", "omniview.operation.active":
				data, ok := measurement.Data.(metricdata.Sum[int64])
				require.True(t, ok)
				for _, point := range data.DataPoints {
					require.NotContains(t, fmt.Sprint(point.Attributes.ToSlice()), "private-")
					switch measurement.Name {
					case "omniview.resource.records":
						records += point.Value
					case "omniview.operation.calls":
						callsCount += point.Value
					case "omniview.operation.active":
						active += point.Value
					}
				}
			}
		}
	}
	require.Equal(t, uint64(9), durations)
	require.Equal(t, int64(5), failures)
	require.Equal(t, int64(2), records, "Count only returned records, not failed requests or provider count estimates")
	require.Equal(t, int64(9), callsCount)
	require.Zero(t, active, "Every success and error must end its operation")
}
