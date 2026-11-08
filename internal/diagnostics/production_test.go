package diagnostics_test

import (
	"context"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/diagnostics"
	"github.com/omniviewdev/omniview/internal/telemetry"
	otelgrpc "go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	otelruntime "go.opentelemetry.io/contrib/instrumentation/runtime"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
)

// Exercise the same real runtime/application/otelgrpc instruments installed by
// telemetry.Init and plugin-sdk's gRPC client, not hand-authored metric rows.
func TestProductionInstrumentsNormalizeRPCMethodsBeforeSeriesBounds(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	service, err := diagnostics.New(diagnostics.Options{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithCardinalityLimit(128))
	defer provider.Shutdown(context.Background())
	if _, err = telemetry.NewMetrics(provider); err != nil {
		t.Fatal(err)
	}
	if err = otelruntime.Start(otelruntime.WithMeterProvider(provider)); err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	healthpb.RegisterHealthServer(server, health.NewServer())
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	defer listener.Close()
	conn, err := grpc.NewClient("passthrough:///private-peer.example:1234",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler(otelgrpc.WithMeterProvider(provider))),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := healthpb.NewHealthClient(conn)
	produce := func() {
		t.Helper()
		if _, err = client.Check(ctx, &healthpb.HealthCheckRequest{}); err != nil {
			t.Fatal(err)
		}
		if _, err = client.List(ctx, &healthpb.HealthListRequest{}); err != nil {
			t.Fatal(err)
		}
		for i := range 20 {
			err := conn.Invoke(ctx, fmt.Sprintf("/private.Service/PrivateMethod%d", i), &emptypb.Empty{}, &emptypb.Empty{})
			if status.Code(err) != codes.Unimplemented {
				t.Fatal(err)
			}
		}
		operation := telemetry.BeginOperation(ctx, "plugin", "load")
		operation.End(nil)
	}
	collect := func() {
		t.Helper()
		var raw metricdata.ResourceMetrics
		if err := reader.Collect(ctx, &raw); err != nil {
			t.Fatal(err)
		}
		rawRPCPoints := 0
		for _, scope := range raw.ScopeMetrics {
			for _, metric := range scope.Metrics {
				if metric.Name == "rpc.client.call.duration" {
					rawRPCPoints = len(metric.Data.(metricdata.Histogram[float64]).DataPoints)
				}
			}
		}
		if rawRPCPoints < 22 {
			t.Fatalf("real gRPC producer did not exercise method split: %d", rawRPCPoints)
		}
		if err := service.Export(ctx, &raw); err != nil {
			t.Fatal(err)
		}
		snapshot := service.GetSnapshot()
		if !snapshot.Health.Complete || snapshot.Health.Dropped != 0 {
			t.Fatalf("production metrics rejected: %+v", snapshot.Health)
		}
		found := false
		for _, metric := range snapshot.Metrics {
			if metric.Name != "rpc.client.call.duration" {
				continue
			}
			found = true
			if len(metric.Points) != 2 {
				t.Fatalf("RPC methods not aggregated by finite status: %+v", metric)
			}
			for _, point := range metric.Points {
				if _, ok := point.Attributes["rpc.method"]; ok {
					t.Fatal("RPC method leaked")
				}
				if _, ok := point.Attributes["server.address"]; ok {
					t.Fatal("peer address leaked")
				}
				var buckets uint64
				for _, count := range point.BucketCounts {
					buckets += count
				}
				if buckets != point.Count {
					t.Fatalf("histogram bucket totals changed: %+v", point)
				}
			}
		}
		if !found {
			t.Fatal("production RPC metric disappeared")
		}
		if text := service.Prometheus(); strings.Contains(text, "private-peer") || strings.Contains(text, "PrivateMethod") {
			t.Fatal("private RPC dimensions exposed")
		}
	}
	capture, err := service.StartCapture(diagnostics.CaptureRequest{Name: "production", DurationSeconds: 1})
	if err != nil {
		t.Fatal(err)
	}
	produce()
	collect()
	time.Sleep(1100 * time.Millisecond)
	produce()
	collect()
	captured, err := service.GetCapture(capture.ID)
	if err != nil || captured.Status != "complete" || !captured.Coverage.Complete {
		t.Fatalf("production capture stayed partial: %+v %v", captured, err)
	}
}
