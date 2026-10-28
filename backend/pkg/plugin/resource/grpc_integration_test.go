package resource

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	grpcplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

const grpcTestBufSize = 1024 * 1024

// setupGRPCProvider uses the production raw-validating codec and service handlers.
func setupGRPCProvider(t *testing.T, provider resource.Provider) *grpcplugin.Client {
	t.Helper()
	listener := bufconn.Listen(grpcTestBufSize)
	server := grpc.NewServer(grpcplugin.ServerOptions()...)
	grpcplugin.RegisterServer(server, provider)
	go func() { _ = server.Serve(listener) }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := grpc.DialContext(ctx, "passthrough:///resource-test", grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(); server.Stop(); _ = listener.Close() })
	return grpcplugin.NewClient(conn)
}

func grpcFiniteFixture() *mockProvider {
	return &mockProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return canonicalTestCatalog("p1", "native::Pod"), nil
	}}
}

func grpcGetRequest() resource.GetRequest {
	return resource.GetRequest{Route: resource.AccessRoute{Connection: "conn-1"}, Reference: canonicalTestRecord("p1", "authority", "native::Pod", "pod-1").Reference, Representation: "native"}
}

func TestL3_01_EnumerateRoundTrip(t *testing.T) {
	provider := grpcFiniteFixture()
	record := canonicalTestRecord("p1", "authority", "native::Pod", "pod-1")
	provider.EnumerateFunc = func(ctx context.Context, request resource.EnumerateRequest) (resource.SourcePage, error) {
		assert.Equal(t, "conn-1", request.Target.Route.Connection)
		return resource.SourcePage{Records: []resource.Record{record}, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
	}
	client := setupGRPCProvider(t, provider)
	catalog, err := client.Catalog(context.Background(), resource.CatalogRequest{Route: grpcGetRequest().Route})
	require.NoError(t, err)
	ctx := resource.WithCatalogRevision(context.Background(), catalog.Revision)
	result, err := client.Enumerate(ctx, resource.EnumerateRequest{Target: resource.ReadTarget{Route: grpcGetRequest().Route, Provider: "p1", Authority: "authority", Type: "native::Pod", Representation: "native"}})
	require.NoError(t, err)
	require.Len(t, result.Records, 1)
	assert.Equal(t, record, result.Records[0])
	assert.Equal(t, "unknown", result.Count.Kind)
}

func TestL3_02_GetRoundTrip(t *testing.T) {
	provider := grpcFiniteFixture()
	record := canonicalTestRecord("p1", "authority", "native::Pod", "pod-1")
	record.Body.Map["exact"] = resource.Value{Kind: "uint64", Uint: "18446744073709551615"}
	provider.GetFunc = func(ctx context.Context, request resource.GetRequest) (resource.Record, error) {
		assert.Equal(t, grpcGetRequest(), request)
		return record, nil
	}
	client := setupGRPCProvider(t, provider)
	catalog, err := client.Catalog(context.Background(), resource.CatalogRequest{Route: grpcGetRequest().Route})
	require.NoError(t, err)
	ctx := resource.WithCatalogRevision(context.Background(), catalog.Revision)
	result, err := client.Get(ctx, grpcGetRequest())
	require.NoError(t, err)
	assert.Equal(t, record, result)
}

type grpcRecordingSink struct{ events chan any }

func (s *grpcRecordingSink) OnAdd(p resource.WatchAddPayload)         { s.events <- p }
func (s *grpcRecordingSink) OnUpdate(p resource.WatchUpdatePayload)   { s.events <- p }
func (s *grpcRecordingSink) OnDelete(p resource.WatchDeletePayload)   { s.events <- p }
func (s *grpcRecordingSink) OnStateChange(p resource.WatchStateEvent) { s.events <- p }

func TestL3_03_WatchEventsFlowThroughGRPC(t *testing.T) {
	provider := grpcFiniteFixture()
	native := make(chan resource.WatchEventSink, 1)
	provider.ListenForEventsFunc = func(ctx context.Context, sink resource.WatchEventSink, ready func() error) error {
		if err := ready(); err != nil {
			return err
		}
		native <- sink
		<-ctx.Done()
		return nil
	}
	client := setupGRPCProvider(t, provider)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sink := &grpcRecordingSink{events: make(chan any, 4)}
	ready := make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- client.ListenForEvents(ctx, sink, func() error { close(ready); return nil }) }()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("watch readiness timed out")
	}
	var source resource.WatchEventSink
	select {
	case source = <-native:
	case <-time.After(5 * time.Second):
		t.Fatal("native sink timed out")
	}
	route := resource.AccessRoute{Connection: "conn-1"}
	record := canonicalTestRecord("p1", "authority", "native::Pod", "pod-1")
	payloads := []any{resource.WatchAddPayload{Route: route, Record: record, Guarantee: resource.BestEffortGuarantee}, resource.WatchUpdatePayload{Route: route, Record: record, Guarantee: resource.BestEffortGuarantee}, resource.WatchDeletePayload{Route: route, Reference: record.Reference, LastKnown: &record, Guarantee: resource.BestEffortGuarantee}, resource.WatchStateEvent{Route: route, Type: "native::Pod", State: resource.WatchStateSynced, Count: resource.Count{Kind: "unknown"}, Guarantee: resource.BestEffortGuarantee}}
	source.OnAdd(payloads[0].(resource.WatchAddPayload))
	source.OnUpdate(payloads[1].(resource.WatchUpdatePayload))
	source.OnDelete(payloads[2].(resource.WatchDeletePayload))
	source.OnStateChange(payloads[3].(resource.WatchStateEvent))
	for _, want := range payloads {
		select {
		case got := <-sink.events:
			switch expected := want.(type) {
			case resource.WatchAddPayload:
				actual, ok := got.(resource.WatchAddPayload)
				require.True(t, ok)
				assert.Equal(t, expected.Route, actual.Route)
				assert.Equal(t, expected.Guarantee, actual.Guarantee)
				assert.Equal(t, expected.Record, actual.Record)
				assert.Empty(t, actual.Metadata.Labels)
				assert.Equal(t, expected.Metadata.CreatedAt, actual.Metadata.CreatedAt)
			case resource.WatchUpdatePayload:
				actual, ok := got.(resource.WatchUpdatePayload)
				require.True(t, ok)
				assert.Equal(t, expected.Route, actual.Route)
				assert.Equal(t, expected.Guarantee, actual.Guarantee)
				assert.Equal(t, expected.Record, actual.Record)
				assert.Empty(t, actual.Metadata.Labels)
				assert.Equal(t, expected.Metadata.CreatedAt, actual.Metadata.CreatedAt)
			case resource.WatchDeletePayload:
				actual, ok := got.(resource.WatchDeletePayload)
				require.True(t, ok)
				assert.Equal(t, expected.Route, actual.Route)
				assert.Equal(t, expected.Guarantee, actual.Guarantee)
				assert.Equal(t, expected.Reference, actual.Reference)
				require.NotNil(t, actual.LastKnown)
				assert.Equal(t, expected.LastKnown, actual.LastKnown)
			default:
				assert.Equal(t, want, got)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("watch payload timed out")
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("watch teardown timed out")
	}
}

func TestL3_04_ConnectionLifecycleViaGRPC(t *testing.T) {
	provider := grpcFiniteFixture()
	provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		assert.Equal(t, "conn-1", id)
		return types.ConnectionStatus{Connection: &types.Connection{ID: id}, Status: types.ConnectionStatusConnected}, nil
	}
	result, err := setupGRPCProvider(t, provider).StartConnection(context.Background(), "conn-1")
	require.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusConnected, result.Status)
}

func TestL3_05_CatalogOnlyProviderViaGRPC(t *testing.T) {
	provider := &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return canonicalTestCatalog("p1", "native::Pod"), nil
	}}
	client := setupGRPCProvider(t, provider)
	catalog, err := client.Catalog(context.Background(), resource.CatalogRequest{Route: grpcGetRequest().Route})
	require.NoError(t, err)
	assert.Equal(t, "p1", catalog.Provider)
	ctx := resource.WithCatalogRevision(context.Background(), catalog.Revision)
	_, err = client.Get(ctx, grpcGetRequest())
	assert.Equal(t, "UNSUPPORTED", resource.ErrorCode(err))
}

func TestL3_06_ErrorPropagationViaGRPC(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code string
	}{{"typed", resource.NewError("FORBIDDEN", "secret"), "FORBIDDEN"}, {"untyped", errors.New("secret"), "PROVIDER_ERROR"}} {
		t.Run(test.name, func(t *testing.T) {
			provider := grpcFiniteFixture()
			provider.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
				return resource.Record{}, test.err
			}
			client := setupGRPCProvider(t, provider)
			catalog, err := client.Catalog(context.Background(), resource.CatalogRequest{Route: grpcGetRequest().Route})
			require.NoError(t, err)
			ctx := resource.WithCatalogRevision(context.Background(), catalog.Revision)
			_, err = client.Get(ctx, grpcGetRequest())
			require.Error(t, err)
			assert.Equal(t, test.code, resource.ErrorCode(err))
			assert.NotContains(t, err.Error(), "secret")
		})
	}
}

func TestL3_07_InvalidRequestDoesNotDispatch(t *testing.T) {
	provider := grpcFiniteFixture()
	called := false
	provider.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
		called = true
		return resource.Record{}, nil
	}
	client := setupGRPCProvider(t, provider)
	catalog, err := client.Catalog(context.Background(), resource.CatalogRequest{Route: grpcGetRequest().Route})
	require.NoError(t, err)
	ctx := resource.WithCatalogRevision(context.Background(), catalog.Revision)
	_, err = client.Get(ctx, resource.GetRequest{})
	assert.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
	assert.False(t, called)
}

func TestGRPCGetRequiresAcceptedCatalogPin(t *testing.T) {
	provider := grpcFiniteFixture()
	calls := 0
	record := canonicalTestRecord("p1", "authority", "native::Pod", "pod-1")
	provider.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
		calls++
		return record, nil
	}
	client := setupGRPCProvider(t, provider)
	catalog, err := client.Catalog(context.Background(), resource.CatalogRequest{Route: grpcGetRequest().Route})
	require.NoError(t, err)
	for _, ctx := range []context.Context{
		context.Background(),
		resource.WithCatalogRevision(context.Background(), "wrong-catalog"),
	} {
		_, err := client.Get(ctx, grpcGetRequest())
		require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err))
	}
	require.Zero(t, calls)
	ctx := resource.WithCatalogRevision(context.Background(), catalog.Revision)
	_, err = client.Get(ctx, grpcGetRequest())
	require.NoError(t, err)
	require.Equal(t, 1, calls)
	_, err = client.Get(ctx, grpcGetRequest())
	require.NoError(t, err)
	require.Equal(t, 2, calls)
}
