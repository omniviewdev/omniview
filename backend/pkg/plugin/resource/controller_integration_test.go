package resource

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Integration tests exercise canonical service requests, provider dispatch,
// generation ownership, and registry observations.

func integrationProvider(resourceTypes ...string) *mockProvider {
	return &mockProvider{
		CatalogFunc: lifecycleTestCatalog(resourceTypes...),
		GetFunc: func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			return canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID), nil
		},
		EnumerateFunc: func(_ context.Context, request resource.EnumerateRequest) (resource.SourcePage, error) {
			record := canonicalTestRecord(request.Target.Provider, request.Target.Authority, request.Target.Type, "enumerated")
			return resource.SourcePage{Records: []resource.Record{record}, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
		},
		NativeQueryFunc: func(_ context.Context, request resource.NativeQueryRequest) (resource.SourcePage, error) {
			record := canonicalTestRecord(request.Target.Provider, request.Target.Authority, request.Target.Type, "queried")
			return resource.SourcePage{Records: []resource.Record{record}, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
		},
		MutateFunc: func(_ context.Context, request resource.MutationRequest) (resource.Record, error) {
			record := canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID)
			record.Body.Map["operation"] = resource.Value{Kind: "string", String: request.Operation}
			return record, nil
		},
	}
}

// EI-001: Canonical dispensing retains the actual provider without an adapter.
func TestIntegration_DispenseProvider(t *testing.T) {
	mock := integrationProvider("pods")
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": mock})
	provider, version, err := dispenseProvider("p1", backend)
	require.NoError(t, err)
	require.Same(t, mock, provider)
	require.Equal(t, 1, version)
	catalog, err := provider.Catalog(context.Background(), resource.CatalogRequest{Route: resource.AccessRoute{Connection: "explicit"}})
	require.NoError(t, err)
	assert.Equal(t, "pods", catalog.Types[0].Type)
	getter, ok := provider.(resource.Getter)
	require.True(t, ok)
	request := resource.GetRequest{Route: resource.AccessRoute{Connection: "explicit"}, Reference: canonicalTestRecord("proof", "fixture-authority", "pods", "pod-1").Reference, Representation: "native"}
	result, err := getter.Get(context.Background(), request)
	require.NoError(t, err)
	assert.Equal(t, request.Reference, result.Reference)
}

// Actual startup loads connections and establishes the optional browser.
func TestIntegration_OnPluginStart_FullWiring(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	var loaded atomic.Bool
	browserReady := make(chan struct{})
	mock := integrationProvider("pods")
	mock.LoadConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		loaded.Store(true)
		return []types.Connection{{ID: "conn-1", Name: "Test Cluster"}}, nil
	}
	mock.WatchConnectionsFunc = func(ctx context.Context, _ chan<- []types.Connection) error {
		close(browserReady)
		<-ctx.Done()
		return ctx.Err()
	}
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": mock})
	require.NoError(t, ctrl.OnPluginStart("p1", defaultMeta(), backend))
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginStop("p1", defaultMeta())) })
	for _, ready := range []<-chan struct{}{browserReady} {
		select {
		case <-ready:
		case <-time.After(time.Second):
			t.Fatal("startup did not establish an optional listener")
		}
	}
	require.True(t, loaded.Load())
	present, err := ctrl.HasPlugin(testInvocationContext(), "p1")
	require.NoError(t, err)
	require.True(t, present)
	provider, err := ctrl.getProvider("p1")
	require.NoError(t, err)
	require.Same(t, mock, provider)
	connection, err := ctrl.GetConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, "Test Cluster", connection.Name)
	require.NotEmpty(t, emitter.EventsWithKey("p1/connection/sync"))
}

// EI-003: Get, enumeration, native query, and all mutation verbs preserve session context.
func TestIntegration_FiniteOperations_ThroughController(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := integrationProvider("pods")
	var gets, enumerations, queries atomic.Int32
	mutations := make(map[string]int)
	mock.GetFunc = func(ctx context.Context, request resource.GetRequest) (resource.Record, error) {
		session, ok := resource.SessionFromContext(ctx)
		require.True(t, ok)
		require.NotNil(t, session.Connection)
		assert.Equal(t, "conn-1", session.Connection.ID)
		assert.NotEmpty(t, session.RequestID)
		gets.Add(1)
		return canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID), nil
	}
	enumerate, query, mutate := mock.EnumerateFunc, mock.NativeQueryFunc, mock.MutateFunc
	mock.EnumerateFunc = func(ctx context.Context, request resource.EnumerateRequest) (resource.SourcePage, error) {
		enumerations.Add(1)
		return enumerate(ctx, request)
	}
	mock.NativeQueryFunc = func(ctx context.Context, request resource.NativeQueryRequest) (resource.SourcePage, error) {
		queries.Add(1)
		return query(ctx, request)
	}
	mock.MutateFunc = func(ctx context.Context, request resource.MutationRequest) (resource.Record, error) {
		mutations[request.Operation]++
		return mutate(ctx, request)
	}
	registerMockPlugin(ctrl, "p1", mock)
	get := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "my-pod")
	result, err := ctrl.Get(testInvocationContext(), "p1", get)
	require.NoError(t, err)
	assert.Equal(t, "my-pod", result.Record.Reference.Address.ID)
	assert.Equal(t, "my-pod", result.Record.Body.Map["name"].String)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "pods")
	page, err := ctrl.Enumerate(testInvocationContext(), "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target, PageSize: 10}})
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	assert.Equal(t, "enumerated", page.Records[0].Record.Reference.Address.ID)
	found, err := ctrl.NativeQuery(testInvocationContext(), "p1", HostNativeQueryRequest{TargetID: target.TargetID, Request: resource.NativeQueryRequest{Target: target.Target, Language: "fixture", Query: resource.Value{Kind: "string", String: "find"}, PageSize: 10}})
	require.NoError(t, err)
	require.Len(t, found.Records, 1)
	assert.Equal(t, "queried", found.Records[0].Record.Reference.Address.ID)
	for _, operation := range []string{"create", "update", "delete"} {
		record, err := ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: get.Request.Route, Reference: get.Request.Reference, Operation: operation, Input: resource.Value{Kind: "null"}})
		require.NoError(t, err)
		assert.Equal(t, operation, record.Body.Map["operation"].String)
		assert.Equal(t, 1, mutations[operation])
	}
	assert.EqualValues(t, 1, gets.Load())
	assert.EqualValues(t, 1, enumerations.Load())
	assert.EqualValues(t, 1, queries.Load())
}

// EI-008: StopConnection updates state and emits DISCONNECTED.
func TestIntegration_ConnectionDisconnect(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := integrationProvider("pods")
	mock.StopConnectionFunc = func(_ context.Context, id string) (types.Connection, error) {
		return types.Connection{ID: id, Name: "Test"}, nil
	}
	registerMockPlugin(ctrl, "p1", mock)
	requireSavedConnectionProfile(t, ctrl, "p1", types.Connection{ID: "conn-1", Name: "Test"})
	connection, err := ctrl.StopConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", connection.ID)
	event := emitter.WaitForEvent(t, "connection/status", time.Second)
	payload, ok := event.Data[0].(ConnectionStatusPayload)
	require.True(t, ok)
	assert.Equal(t, "DISCONNECTED", payload.Status)
	assert.Equal(t, "conn-1", payload.ConnectionID)
}

// Plugin stop retires provider and connections.
func TestIntegration_PluginStop_CleansAll(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", integrationProvider("pods"))
	requireSavedConnectionProfile(t, ctrl, "p1", types.Connection{ID: "conn-1", Name: "Test"})
	require.NoError(t, ctrl.OnPluginStop("p1", defaultMeta()))
	present, err := ctrl.HasPlugin(testInvocationContext(), "p1")
	require.NoError(t, err)
	assert.False(t, present)
	ctrl.connsMu.RLock()
	_, hasConnections := ctrl.connections["p1"]
	ctrl.connsMu.RUnlock()
	assert.False(t, hasConnections)
}

// Equal type and object IDs from distinct plugins retain separate identities.
func TestIntegration_SameKeyTwoPlugins(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	targets := make(map[string]ResolvedTarget)
	for _, pluginID := range []string{"p1", "p2"} {
		pluginID := pluginID
		mock := integrationProvider("pods")
		mock.GetFunc = func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			record := canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID)
			record.Body.Map["source"] = resource.Value{Kind: "string", String: pluginID}
			return record, nil
		}
		registerMockPlugin(ctrl, pluginID, mock)
		targets[pluginID] = admittedReadTarget(t, ctrl, pluginID, "conn-1", "pods")
		result, err := ctrl.Get(testInvocationContext(), pluginID, admittedGetRequest(t, ctrl, pluginID, "conn-1", "pods", "same-id"))
		require.NoError(t, err)
		assert.Equal(t, pluginID, result.Record.Body.Map["source"].String)
	}
	assert.NotEqual(t, targets["p1"].Target.Authority, targets["p2"].Target.Authority)
}

// EI-018: Actual double startup cancels the old generation and publishes the new provider.
func TestIntegration_DoubleStart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	for _, version := range []string{"v1", "v2"} {
		version := version
		mock := integrationProvider("pods")
		mock.GetFunc = func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			record := canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID)
			record.Body.Map["version"] = resource.Value{Kind: "string", String: version}
			return record, nil
		}
		var previous context.Context
		ctrl.pluginsMu.RLock()
		if state := ctrl.plugins["p1"]; state != nil {
			previous = state.ctx
		}
		ctrl.pluginsMu.RUnlock()
		backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": mock})
		require.NoError(t, ctrl.OnPluginStart("p1", defaultMeta(), backend))
		if previous != nil {
			require.ErrorIs(t, previous.Err(), context.Canceled)
		}
	}
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginStop("p1", defaultMeta())) })
	result, err := ctrl.Get(testInvocationContext(), "p1", admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "opaque"))
	require.NoError(t, err)
	assert.Equal(t, "v2", result.Record.Body.Map["version"].String)
}

// EI-019: Twenty concurrent callers retain independent targets across all finite operations.
func TestIntegration_ConcurrentFiniteOperations(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	resourceTypes := make([]string, 20)
	for i := range resourceTypes {
		resourceTypes[i] = fmt.Sprintf("native-type-%d", i)
	}
	registerMockPlugin(ctrl, "p1", integrationProvider(resourceTypes...))
	requests := make([]HostGetRequest, 20)
	targets := make([]ResolvedTarget, 20)
	for i := range requests {
		connection := fmt.Sprintf("conn-%d", i%3)
		requests[i] = admittedGetRequest(t, ctrl, "p1", connection, resourceTypes[i], fmt.Sprintf("pod-%d", i))
		targets[i] = admittedReadTarget(t, ctrl, "p1", connection, resourceTypes[i])
	}
	var wg sync.WaitGroup
	errs := make(chan error, 120)
	for i := range requests {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			request, target := requests[index], targets[index]
			if result, err := ctrl.Get(testInvocationContext(), "p1", request); err != nil {
				errs <- fmt.Errorf("Get[%d]: %w", index, err)
			} else if result.Record.Reference.Address.ID != request.Request.Reference.Address.ID {
				errs <- fmt.Errorf("Get[%d]: mixed identity", index)
			}
			if _, err := ctrl.Enumerate(testInvocationContext(), "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target, PageSize: 10}}); err != nil {
				errs <- fmt.Errorf("Enumerate[%d]: %w", index, err)
			}
			if _, err := ctrl.NativeQuery(testInvocationContext(), "p1", HostNativeQueryRequest{TargetID: target.TargetID, Request: resource.NativeQueryRequest{Target: target.Target, Language: "fixture", Query: resource.Value{Kind: "null"}, PageSize: 10}}); err != nil {
				errs <- fmt.Errorf("NativeQuery[%d]: %w", index, err)
			}
			for _, operation := range []string{"create", "update", "delete"} {
				if _, err := ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: request.Request.Route, Reference: request.Request.Reference, Operation: operation, Input: resource.Value{Kind: "null"}}); err != nil {
					errs <- fmt.Errorf("Mutate/%s[%d]: %w", operation, index, err)
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	present, err := ctrl.HasPlugin(testInvocationContext(), "p1")
	require.NoError(t, err)
	require.True(t, present)
	_, err = ctrl.Get(testInvocationContext(), "p1", requests[0])
	require.NoError(t, err, "provider remains available after concurrent finite operations")
}
