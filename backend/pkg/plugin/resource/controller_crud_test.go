package resource

import (
	"context"
	"errors"
	"sync"
	"testing"

	"time"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func finiteTestProvider(provider string) *mockProvider {
	p := &mockProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return canonicalTestCatalog(provider, "pods"), nil
	}}
	p.GetFunc = func(_ context.Context, r resource.GetRequest) (resource.Record, error) {
		return canonicalTestRecord(r.Reference.Address.Provider, r.Reference.Address.Authority, r.Reference.Address.Type, r.Reference.Address.ID), nil
	}
	page := func(target resource.ReadTarget) resource.SourcePage {
		return resource.SourcePage{Records: []resource.Record{canonicalTestRecord(target.Provider, target.Authority, target.Type, "pod-1")}, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}
	}
	p.EnumerateFunc = func(_ context.Context, r resource.EnumerateRequest) (resource.SourcePage, error) {
		return page(r.Target), nil
	}
	p.NativeQueryFunc = func(_ context.Context, r resource.NativeQueryRequest) (resource.SourcePage, error) {
		return page(r.Target), nil
	}
	p.MutateFunc = func(_ context.Context, r resource.MutationRequest) (resource.Record, error) {
		return canonicalTestRecord(r.Reference.Address.Provider, r.Reference.Address.Authority, r.Reference.Address.Type, r.Reference.Address.ID), nil
	}
	p.ActionFunc = func(context.Context, resource.ActionRequest) (resource.Value, error) {
		return resource.Value{Kind: "bool", Bool: true}, nil
	}
	return p
}

func TestFiniteOperations_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", finiteTestProvider("native"))
	get := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	record, err := ctrl.Get(testInvocationContext(), "p1", get)
	require.NoError(t, err)
	assert.Equal(t, get.Request.Reference, record.Record.Reference)
	assert.NotEmpty(t, record.Key)
	assert.NotEmpty(t, record.AddressKey)
	assert.Equal(t, get.TargetID, record.TargetID)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "pods")
	page, err := ctrl.Enumerate(testInvocationContext(), "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target}})
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	assert.Equal(t, "unknown", page.SourcePage.Count.Kind)
	assert.Equal(t, "bestEffort", page.SourcePage.Consistency)
	query, err := ctrl.NativeQuery(testInvocationContext(), "p1", HostNativeQueryRequest{TargetID: target.TargetID, Request: resource.NativeQueryRequest{Target: target.Target, Language: "native", Query: resource.Value{Kind: "null"}}})
	require.NoError(t, err)
	require.Len(t, query.Records, 1)
	for _, operation := range []string{"create", "update", "delete"} {
		t.Run(operation, func(t *testing.T) {
			result, err := ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: get.Request.Route, Reference: get.Request.Reference, Operation: operation, Input: resource.Value{Kind: "null"}})
			require.NoError(t, err)
			assert.Equal(t, get.Request.Reference, result.Reference)
		})
	}
	value, err := ctrl.Action(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "inspect"))
	require.NoError(t, err)
	assert.True(t, value.Bool)
}

func TestFiniteOperations_CreateOnlyRejectsUnsupportedWrites(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	p := finiteTestProvider("native")
	p.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("native", "pods")
		catalog.Types[0].Capabilities = []resource.Capability{{Operation: resource.OperationGet}, {Operation: resource.OperationCreate}}
		return catalog, nil
	}
	calls := 0
	p.MutateFunc = func(_ context.Context, request resource.MutationRequest) (resource.Record, error) {
		calls++
		return canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID), nil
	}
	registerMockPlugin(ctrl, "p1", p)
	get := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	for _, verb := range []string{"update", "delete"} {
		_, err := ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: get.Request.Route, Reference: get.Request.Reference, Operation: verb, Input: resource.Value{Kind: "null"}})
		require.Error(t, err)
		assert.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
	}
	assert.Zero(t, calls)
	_, err := ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: get.Request.Route, Reference: get.Request.Reference, Operation: "create", Input: resource.Value{Kind: "null"}})
	require.NoError(t, err)
	assert.Equal(t, 1, calls)
}

func TestFiniteOperations_ProviderErrors(t *testing.T) {
	for _, code := range []string{"NOT_FOUND", "FORBIDDEN", "UNAVAILABLE", "CANCELLED", "TIMEOUT", "INTERNAL"} {
		t.Run(code, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			p := finiteTestProvider("native")
			registerMockPlugin(ctrl, "p1", p)
			get := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
			target := admittedReadTarget(t, ctrl, "p1", "conn-1", "pods")
			failure := resource.NewError(code, "provider detail")
			p.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) { return resource.Record{}, failure }
			p.EnumerateFunc = func(context.Context, resource.EnumerateRequest) (resource.SourcePage, error) {
				return resource.SourcePage{}, failure
			}
			p.NativeQueryFunc = func(context.Context, resource.NativeQueryRequest) (resource.SourcePage, error) {
				return resource.SourcePage{}, failure
			}
			p.MutateFunc = func(context.Context, resource.MutationRequest) (resource.Record, error) {
				return resource.Record{}, failure
			}
			p.ActionFunc = func(context.Context, resource.ActionRequest) (resource.Value, error) {
				return resource.Value{}, failure
			}
			operations := []func() error{func() error { _, e := ctrl.Get(testInvocationContext(), "p1", get); return e }, func() error {
				_, e := ctrl.Enumerate(testInvocationContext(), "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target}})
				return e
			}, func() error {
				_, e := ctrl.NativeQuery(testInvocationContext(), "p1", HostNativeQueryRequest{TargetID: target.TargetID, Request: resource.NativeQueryRequest{Target: target.Target, Language: "native", Query: resource.Value{Kind: "null"}}})
				return e
			}, func() error {
				_, e := ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: get.Request.Route, Reference: get.Request.Reference, Operation: "update", Input: resource.Value{Kind: "null"}})
				return e
			}, func() error {
				_, e := ctrl.Action(testInvocationContext(), "p1", resource.ActionRequest{Route: get.Request.Route, Reference: get.Request.Reference, Action: "inspect", Input: resource.Value{Kind: "null"}})
				return e
			}}
			for _, operation := range operations {
				assert.Equal(t, code, requireAppError(t, operation()).Code)
			}
		})
	}
}

func TestGet_UntypedProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	p := finiteTestProvider("native")
	registerMockPlugin(ctrl, "p1", p)
	request := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	p.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
		return resource.Record{}, errors.New("private")
	}
	_, err := ctrl.Get(testInvocationContext(), "p1", request)
	app := requireAppError(t, err)
	assert.Equal(t, "PROVIDER_ERROR", app.Code)
	assert.NotContains(t, app.Error(), "private")
}

func TestGet_ContextHasSession(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	p := finiteTestProvider("native")
	registerMockPlugin(ctrl, "p1", p)
	request := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	original := p.GetFunc
	p.GetFunc = func(ctx context.Context, r resource.GetRequest) (resource.Record, error) {
		session, ok := resource.SessionFromContext(ctx)
		require.True(t, ok)
		require.NotNil(t, session.Connection)
		assert.Equal(t, "conn-1", session.Connection.ID)
		return original(ctx, r)
	}
	_, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.NoError(t, err)
}

func TestFiniteGet_RejectsEmptyRequest(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	p := finiteTestProvider("native")
	called := false
	p.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
		called = true
		return resource.Record{}, nil
	}
	registerMockPlugin(ctrl, "p1", p)
	_, err := ctrl.Get(testInvocationContext(), "p1", HostGetRequest{})
	require.Error(t, err)
	assert.False(t, called)
}

func TestOperationGeneration_RouteSessionAndCancellationOwnership(t *testing.T) {
	for _, source := range []string{"invocation", "generation", "cleanup"} {
		t.Run(source, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			expected := &mockProvider{}
			registerMockPlugin(ctrl, "p1", expected)
			route := resource.AccessRoute{Connection: "conn/opaque"}
			caller, cancelCaller := context.WithCancel(testInvocationContext())
			defer cancelCaller()
			admitted, err := ctrl.admit(caller, "resource.Get", referenceTarget("p1", route, canonicalTestRecord("native", "authority", "pods", "pod-1").Reference))
			require.NoError(t, err)
			defer finishResource(admitted, &err)
			provider, generation, operation, cleanup, err := ctrl.operationGeneration(admitted, "p1", route)
			require.NoError(t, err)
			defer cleanup()
			assert.Same(t, expected, provider)
			require.NotNil(t, generation)
			assert.NotEmpty(t, generation.generationID)
			session, ok := resource.SessionFromContext(operation)
			require.True(t, ok)
			require.NotNil(t, session.Connection)
			assert.Equal(t, route.Connection, session.Connection.ID)
			assert.Equal(t, "p1", session.PluginID)
			assert.NotEmpty(t, session.RequestID)
			assert.NoError(t, operation.Err())
			switch source {
			case "invocation":
				cancelCaller()
			case "generation":
				generation.watchCancel()
			case "cleanup":
				cleanup()
			}
			select {
			case <-operation.Done():
				assert.ErrorIs(t, operation.Err(), context.Canceled)
			case <-time.After(time.Second):
				t.Fatal("native operation outlived its owner")
			}
		})
	}
}

func TestOperationGeneration_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, _, _, _, err := ctrl.operationGeneration(testInvocationContext(), "absent", resource.AccessRoute{Connection: "conn-1"})
	require.Error(t, err)
}
func TestGetProvider_ReturnsCorrectProvider(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expected := &mockProvider{}
	registerMockPlugin(ctrl, "p1", expected)
	provider, err := ctrl.getProvider("p1")
	require.NoError(t, err)
	assert.Same(t, expected, provider)
}
func TestGetProvider_Concurrency(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			provider, err := ctrl.getProvider("p1")
			assert.NoError(t, err)
			assert.NotNil(t, provider)
		}()
	}
	wg.Wait()
}
func TestFiniteGet_MultiplePluginsIsolation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	for _, id := range []string{"p1", "p2"} {
		registerMockPlugin(ctrl, id, finiteTestProvider(id))
	}
	one := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	two := admittedGetRequest(t, ctrl, "p2", "conn-1", "pods", "pod-1")
	r1, err := ctrl.Get(testInvocationContext(), "p1", one)
	require.NoError(t, err)
	r2, err := ctrl.Get(testInvocationContext(), "p2", two)
	require.NoError(t, err)
	assert.NotEqual(t, r1.AddressKey, r2.AddressKey)
	assert.NotEqual(t, r1.Key, r2.Key)
}
func TestFiniteGet_AfterPluginStopFails(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", finiteTestProvider("native"))
	request := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	require.NoError(t, ctrl.OnPluginStop("p1", defaultMeta()))
	_, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.Error(t, err)
}

func TestFiniteGet_RequestLabelIsNotAuthority(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := finiteTestProvider("native")
	registerMockPlugin(ctrl, "p1", provider)
	request := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	request.TargetID = "request-local-label"
	_, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.NoError(t, err, "request-local labels need no target registry")
	called := false
	provider.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
		called = true
		return resource.Record{}, nil
	}
	request.Request.Reference.Address.Authority = "unissued"
	_, err = ctrl.Get(testInvocationContext(), "p1", request)
	require.Error(t, err, "known labels must not grant authority")
	assert.False(t, called)
}

func TestFiniteGet_RevalidatesCurrentCatalog(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := finiteTestProvider("native")
	registerMockPlugin(ctrl, "p1", provider)
	request := admittedGetRequest(t, ctrl, "p1", "conn-1", "pods", "pod-1")
	provider.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("native", "pods")
		catalog.Types[0].Capabilities = []resource.Capability{}
		return catalog, nil
	}
	called := false
	provider.GetFunc = func(context.Context, resource.GetRequest) (resource.Record, error) {
		called = true
		return resource.Record{}, nil
	}
	_, err := ctrl.Get(testInvocationContext(), "p1", request)
	assert.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
	assert.False(t, called, "old labels must not retain removed support")
}
