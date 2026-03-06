package resource

// Level 3 integration tests: Engine Controller → gRPC → SDK Provider.
//
// These tests wire a real gRPC server (via bufconn) backed by an SDK
// TestProvider, register the resulting gRPC client as the engine
// controller's provider, and exercise the full data flow.

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	grpcplugin "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/v1/resource"
)

const grpcTestBufSize = 1024 * 1024

// setupGRPCProvider creates an in-process gRPC server backed by the given
// SDK Provider, and returns a ResourceProvider (gRPC client) that the engine
// controller can use directly.
func setupGRPCProvider(t *testing.T, sdkProvider resource.Provider) ResourceProvider {
	t.Helper()
	lis := bufconn.Listen(grpcTestBufSize)

	s := grpc.NewServer()
	resourcepb.RegisterResourcePluginServer(s, grpcplugin.NewServer(sdkProvider, nil))
	go func() { _ = s.Serve(lis) }()

	dialer := func(ctx context.Context, addr string) (net.Conn, error) {
		return lis.DialContext(ctx)
	}
	//nolint:staticcheck // grpc.DialContext needed for grpc v1.61
	conn, err := grpc.DialContext(context.Background(), "bufnet",
		grpc.WithContextDialer(dialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)

	t.Cleanup(func() {
		conn.Close()
		s.Stop()
		lis.Close()
	})

	return grpcplugin.NewClient(resourcepb.NewResourcePluginClient(conn))
}

// ============================================================================
// L3-01: List round-trip via gRPC
// ============================================================================

func TestL3_01_ListRoundTrip(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListFunc(func(_ context.Context, key string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{
				Success: true,
				Result:  []json.RawMessage{json.RawMessage(`{"name":"pod-1"}`)},
			}, nil
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	result, err := ctrl.List("p1", "conn-1", "core::v1::Pod", resource.ListInput{})
	require.NoError(t, err)
	require.True(t, result.Success)
	require.Len(t, result.Result, 1)
	assert.JSONEq(t, `{"name":"pod-1"}`, string(result.Result[0]))
}

// ============================================================================
// L3-02: Get round-trip via gRPC
// ============================================================================

func TestL3_02_GetRoundTrip(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithGetFunc(func(_ context.Context, key string, input resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{
				Success: true,
				Result:  json.RawMessage(`{"name":"` + input.ID + `"}`),
			}, nil
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	result, err := ctrl.Get("p1", "conn-1", "core::v1::Pod", resource.GetInput{ID: "my-pod"})
	require.NoError(t, err)
	require.True(t, result.Success)
	assert.JSONEq(t, `{"name":"my-pod"}`, string(result.Result))
}

// ============================================================================
// L3-03: Watch events flow through gRPC and reach engine emitter
// ============================================================================

func TestL3_03_WatchEventsFlowThroughGRPC(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	// ready channel signals when ListenForEvents has delivered the sink.
	ready := make(chan resource.WatchEventSink, 1)

	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, sink resource.WatchEventSink) error {
			ready <- sink
			<-ctx.Done()
			return nil
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	// Subscribe so ADD events pass the gate.
	ctrl.subs.Subscribe("p1", "conn-1", "core::v1::Pod")

	// Start the watch listener (same as OnPluginStart does).
	watchCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	watchReady := make(chan struct{})
	go ctrl.listenForWatchEvents("p1", grpcProvider, watchCtx, sink, watchReady)

	// Wait for the SDK provider to receive the sink.
	select {
	case sdkSink := <-ready:
		// Send an ADD event from the "plugin side".
		sdkSink.OnAdd(resource.WatchAddPayload{
			Connection: "conn-1",
			Key:        "core::v1::Pod",
			ID:         "pod-1",
			Data:       json.RawMessage(`{"name":"pod-1"}`),
		})
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for ListenForEvents to start")
	}

	// Verify the event arrived at the engine emitter.
	ev := emitter.WaitForEvent(t, "ADD", 5*time.Second)
	assert.Equal(t, "p1/conn-1/core::v1::Pod/ADD", ev.Key)

	payload, ok := ev.Data.(resource.WatchAddPayload)
	require.True(t, ok)
	assert.Equal(t, "p1", payload.PluginID)
	assert.Equal(t, "conn-1", payload.Connection)
	assert.Equal(t, "pod-1", payload.ID)
}

// ============================================================================
// L3-04: Subscription gating works across gRPC boundary
// ============================================================================

func TestL3_04_SubscriptionGatingViaGRPC(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	ready := make(chan resource.WatchEventSink, 1)
	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, sink resource.WatchEventSink) error {
			ready <- sink
			<-ctx.Done()
			return nil
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	// Do NOT subscribe — events should be suppressed.

	watchCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	watchReady := make(chan struct{})
	go ctrl.listenForWatchEvents("p1", grpcProvider, watchCtx, sink, watchReady)

	select {
	case sdkSink := <-ready:
		sdkSink.OnAdd(resource.WatchAddPayload{
			Connection: "conn-1",
			Key:        "core::v1::Pod",
			ID:         "pod-1",
		})
		// Also send a STATE event — those always flow.
		sdkSink.OnStateChange(resource.WatchStateEvent{
			Connection:  "conn-1",
			ResourceKey: "core::v1::Pod",
			State:       resource.WatchStateSynced,
		})
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for ListenForEvents to start")
	}

	// STATE should arrive.
	emitter.WaitForEvent(t, "watch/STATE", 5*time.Second)

	// ADD should NOT arrive (not subscribed).
	adds := emitter.EventsWithKey("ADD")
	assert.Empty(t, adds, "ADD should be suppressed without subscription")
}

// ============================================================================
// L3-05: STATE events carry correct key format via gRPC
// ============================================================================

func TestL3_05_StateEventKeyFormatViaGRPC(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	ready := make(chan resource.WatchEventSink, 1)
	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, sink resource.WatchEventSink) error {
			ready <- sink
			<-ctx.Done()
			return nil
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	watchCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	watchReady := make(chan struct{})
	go ctrl.listenForWatchEvents("p1", grpcProvider, watchCtx, sink, watchReady)

	select {
	case sdkSink := <-ready:
		sdkSink.OnStateChange(resource.WatchStateEvent{
			Connection:    "my-cluster",
			ResourceKey:   "core::v1::Pod",
			State:         resource.WatchStateSyncing,
			ResourceCount: 42,
		})
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for ListenForEvents to start")
	}

	// Should emit 2 events: per-connection + global.
	events := emitter.WaitForNEvents(t, "STATE", 2, 5*time.Second)

	// Per-connection key: ${pluginID}/${connectionID}/watch/STATE
	assert.Equal(t, "p1/my-cluster/watch/STATE", events[0].Key)
	// Global key
	assert.Equal(t, "watch/STATE", events[1].Key)

	// Verify payload enrichment.
	payload, ok := events[0].Data.(resource.WatchStateEvent)
	require.True(t, ok)
	assert.Equal(t, "p1", payload.PluginID)
	assert.Equal(t, "my-cluster", payload.Connection)
	assert.Equal(t, "core::v1::Pod", payload.ResourceKey)
	assert.Equal(t, resource.WatchStateSyncing, payload.State)
	assert.Equal(t, 42, payload.ResourceCount)
}

// ============================================================================
// L3-06: Error from SDK provider propagates through gRPC
// ============================================================================

func TestL3_06_ErrorPropagationViaGRPC(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListFunc(func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return nil, errors.New("connection refused")
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	_, err := ctrl.List("p1", "conn-1", "core::v1::Pod", resource.ListInput{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "connection refused")
}

// ============================================================================
// L3-07: Multiple event types flow concurrently via gRPC
// ============================================================================

func TestL3_07_MixedEventsViaGRPC(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	ready := make(chan resource.WatchEventSink, 1)
	sdkProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, sink resource.WatchEventSink) error {
			ready <- sink
			<-ctx.Done()
			return nil
		}),
	)

	grpcProvider := setupGRPCProvider(t, sdkProvider)
	registerMockPlugin(ctrl, "p1", grpcProvider)

	// Subscribe to pods.
	ctrl.subs.Subscribe("p1", "conn-1", "core::v1::Pod")

	watchCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	watchReady := make(chan struct{})
	go ctrl.listenForWatchEvents("p1", grpcProvider, watchCtx, sink, watchReady)

	select {
	case sdkSink := <-ready:
		// Send ADD, UPDATE, DELETE in sequence.
		sdkSink.OnAdd(resource.WatchAddPayload{
			Connection: "conn-1", Key: "core::v1::Pod", ID: "pod-1",
			Data: json.RawMessage(`{"name":"pod-1"}`),
		})
		sdkSink.OnUpdate(resource.WatchUpdatePayload{
			Connection: "conn-1", Key: "core::v1::Pod", ID: "pod-1",
			Data: json.RawMessage(`{"name":"pod-1","status":"Running"}`),
		})
		sdkSink.OnDelete(resource.WatchDeletePayload{
			Connection: "conn-1", Key: "core::v1::Pod", ID: "pod-1",
			Data: json.RawMessage(`{"name":"pod-1"}`),
		})
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for ListenForEvents to start")
	}

	// Wait for all 3 events.
	emitter.WaitForEvent(t, "ADD", 5*time.Second)
	emitter.WaitForEvent(t, "UPDATE", 5*time.Second)
	emitter.WaitForEvent(t, "DELETE", 5*time.Second)

	adds := emitter.EventsWithKey("ADD")
	updates := emitter.EventsWithKey("UPDATE")
	deletes := emitter.EventsWithKey("DELETE")

	require.Len(t, adds, 1)
	require.Len(t, updates, 1)
	require.Len(t, deletes, 1)

	assert.Equal(t, "p1/conn-1/core::v1::Pod/ADD", adds[0].Key)
	assert.Equal(t, "p1/conn-1/core::v1::Pod/UPDATE", updates[0].Key)
	assert.Equal(t, "p1/conn-1/core::v1::Pod/DELETE", deletes[0].Key)
}
