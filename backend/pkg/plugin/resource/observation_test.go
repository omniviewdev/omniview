package resource

import (
	"context"
	"encoding/json"
	"math"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestRetainedAdvertisementRejectedWithinActualAdmission(t *testing.T) {
	for _, change := range []string{"catalog", "source", "route", "plugin"} {
		t.Run(change, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			catalog := bindingTestCatalog(t, bindingTestEpoch(t), "before", "backing")
			calls, admissions := 0, 0
			provider := &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }}
			provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
				calls++
				return canonicalTestRecord("native", request.Reference.Address.Authority, "objects", "real-id"), nil
			}
			registerMockPlugin(ctrl, "p1", provider)
			route := resourcev2.AccessRoute{Connection: "route-a"}
			_, observation, err := ctrl.ObserveCatalog(testInvocationContext(), "p1", route)
			require.NoError(t, err)
			resolved, err := ctrl.ResolveTarget(WithObservation(testInvocationContext(), observation), "p1", ResolveTargetRequest{Route: route, Type: "objects", Representation: "native"})
			require.NoError(t, err)
			ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(invocation.Principal, string, invocation.Target) error { admissions++; return nil }))
			switch change {
			case "catalog":
				catalog.Revision, err = resourcev2.BindCatalogRevision(mustBindingEpoch(t, catalog.Revision), "after")
				require.NoError(t, err)
			case "source":
				require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{route.Connection}))
			case "route":
				route.Connection = "route-b"
			case "plugin":
				registerMockPlugin(ctrl, "p1", provider)
			}
			reference := canonicalTestRecord("native", resolved.Target.Authority, "objects", "real-id").Reference
			_, err = ctrl.Get(WithObservation(testInvocationContext(), observation), "p1", HostGetRequest{TargetID: "advertisement", Request: resourcev2.GetRequest{Route: route, Reference: reference, Representation: "native"}})
			require.Error(t, err)
			require.Zero(t, calls)
			require.Positive(t, admissions)
		})
	}
}
func mustBindingEpoch(t *testing.T, revision string) string {
	t.Helper()
	epoch, err := resourcev2.CatalogBindingEpoch(revision)
	require.NoError(t, err)
	return epoch
}

func TestExpectedCatalogPinNotOverwrittenByActualHostAdmission(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "current", "backing")
	calls := 0
	provider := &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }}
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		calls++
		return resourcev2.Record{}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	resolved, err := ctrl.ResolveTarget(testInvocationContext(), "p1", ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: "route"}, Type: "objects", Representation: "native"})
	require.NoError(t, err)
	reference := canonicalTestRecord("native", resolved.Target.Authority, "objects", "id").Reference
	_, err = ctrl.Get(resourcev2.WithCatalogRevision(testInvocationContext(), "retained-old-pin"), "p1", HostGetRequest{TargetID: "ad", Request: resourcev2.GetRequest{Route: resolved.Target.Route, Reference: reference, Representation: "native"}})
	require.Error(t, err)
	require.Zero(t, calls)
}

func TestActualGetEnvelopePreservesCanonicalScalars(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		record := canonicalTestRecord("native", request.Reference.Address.Authority, "objects", "id")
		record.Body.Map = map[string]resourcev2.Value{"signed": {Kind: "int64", Int: "-9223372036854775808"}, "unsigned": {Kind: "uint64", Uint: "18446744073709551615"}, "timestamp": {Kind: "timestamp", Timestamp: "2026-10-30T12:34:56.123456789Z"}, "negativeZero": {Kind: "double", Double: math.Copysign(0, -1)}}
		return record, nil
	}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return canonicalTestCatalog("native", "objects"), nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	resolved := admittedReadTarget(t, ctrl, "p1", "route", "objects")
	reference := canonicalTestRecord("native", resolved.Target.Authority, "objects", "id").Reference
	record, err := ctrl.Get(testInvocationContext(), "p1", HostGetRequest{TargetID: "ad", Request: resourcev2.GetRequest{Route: resolved.Target.Route, Reference: reference, Representation: "native"}})
	require.NoError(t, err)
	encoded, err := json.Marshal(record)
	require.NoError(t, err)
	var decoded HostRecord
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.Equal(t, "-9223372036854775808", decoded.Record.Body.Map["signed"].Int)
	require.Equal(t, "18446744073709551615", decoded.Record.Body.Map["unsigned"].Uint)
	require.Equal(t, "2026-10-30T12:34:56.123456789Z", decoded.Record.Body.Map["timestamp"].Timestamp)
	require.True(t, math.Signbit(decoded.Record.Body.Map["negativeZero"].Double))
}

func TestActualTypeActionAdmissionNeverFabricatesObjectIdentity(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	calls := 0
	streaming := false
	provider := &mockProvider{}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return canonicalTestCatalog("native", "objects"), nil
	}
	provider.GetActionsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.ActionDescriptor, error) {
		return []resourcev2.ActionDescriptor{{ID: "refresh", Label: "Refresh", Scope: resourcev2.ActionScopeType, Streaming: streaming}}, nil
	}
	provider.ActionFunc = func(_ context.Context, request resourcev2.ActionRequest) (resourcev2.Value, error) {
		calls++
		require.NotNil(t, request.TypeTarget)
		require.Empty(t, request.Reference.Address.ID)
		require.Equal(t, &resourcev2.ActionDescriptor{ID: "refresh", Label: "Refresh", Scope: resourcev2.ActionScopeType}, request.ExpectedDescriptor)
		return resourcev2.Value{Kind: "null"}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	target, err := ctrl.ResolveToolTarget(testInvocationContext(), "p1", resourcev2.AccessRoute{Connection: "route"}, "objects")
	require.NoError(t, err)
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		if operation == "resource.Action" {
			require.Empty(t, target.Object)
			require.Equal(t, "objects", target.ResourceType)
			require.Equal(t, "refresh", target.Action)
		}
		return nil
	}))
	request := resourcev2.ActionRequest{Route: target.Route, TypeTarget: &resourcev2.TypeActionTarget{Provider: target.Provider, Authority: target.Authority, Type: target.Type, Scope: target.Scope}, Action: "refresh", Input: resourcev2.Value{Kind: "null"}}
	_, err = ctrl.Action(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Equal(t, 1, calls)
	streaming = true
	_, err = ctrl.Action(testInvocationContext(), "p1", request)
	require.Error(t, err)
	require.Equal(t, 1, calls)
}

func TestActionMetadataRetirementCannotReachUnaryOrStreamNativeWrite(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		name := "unary"
		if streaming {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			calls := 0
			provider := &mockProvider{}
			provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				return canonicalTestCatalog("native", "objects"), nil
			}
			provider.GetActionsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.ActionDescriptor, error) {
				require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{"route"}))
				return []resourcev2.ActionDescriptor{{ID: "write", Label: "Write", Scope: resourcev2.ActionScopeType, Streaming: streaming}}, nil
			}
			provider.ActionFunc = func(context.Context, resourcev2.ActionRequest) (resourcev2.Value, error) {
				calls++
				return resourcev2.Value{Kind: "null"}, nil
			}
			provider.StreamActionFunc = func(context.Context, resourcev2.ActionRequest, chan<- resourcev2.ActionEvent) error {
				calls++
				return nil
			}
			registerMockPlugin(ctrl, "p1", provider)
			target, err := ctrl.ResolveToolTarget(testInvocationContext(), "p1", resourcev2.AccessRoute{Connection: "route"}, "objects")
			require.NoError(t, err)
			request := resourcev2.ActionRequest{Route: target.Route, TypeTarget: &resourcev2.TypeActionTarget{Provider: target.Provider, Authority: target.Authority, Type: target.Type, Scope: target.Scope}, Action: "write", Input: resourcev2.Value{Kind: "null"}}
			if streaming {
				_, err = ctrl.StreamAction(testInvocationContext(), "p1", request)
			} else {
				_, err = ctrl.Action(testInvocationContext(), "p1", request)
			}
			require.Error(t, err)
			require.Zero(t, calls)
		})
	}
}

func TestHostNativeOptionalActionMetadataThroughRealSDKControllerGRPC(t *testing.T) {
	for _, metadata := range []string{"unknown", "authoritative-empty", "declared"} {
		authoritativeEmpty := metadata == "authoritative-empty"
		name := metadata
		t.Run(name, func(t *testing.T) {
			calls := 0
			registration := resourcev2.Registration[struct{}]{Type: "objects", Action: func(_ context.Context, _ *struct{}, request resourcev2.ActionRequest) (resourcev2.Value, error) {
				calls++
				require.Equal(t, "native-target", request.Reference.Address.ID)
				if metadata == "declared" {
					require.Equal(t, &resourcev2.ActionDescriptor{ID: "native-action", Label: "Native action", Scope: resourcev2.ActionScopeInstance}, request.ExpectedDescriptor)
				} else {
					require.Nil(t, request.ExpectedDescriptor)
				}
				return resourcev2.Value{Kind: "string", String: "native-result"}, nil
			}}
			if authoritativeEmpty {
				registration.Actions = []resourcev2.ActionDescriptor{}
			}
			if metadata == "declared" {
				registration.Actions = []resourcev2.ActionDescriptor{{ID: "native-action", Label: "Native action", Scope: resourcev2.ActionScopeInstance}}
			}
			sdk, err := resourcev2.NewController(resourcev2.Config[struct{}]{
				Catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
					catalog := canonicalTestCatalog("native", "objects")
					catalog.Types[0].Capabilities = []resourcev2.Capability{{Operation: resourcev2.OperationAction, Scope: resourcev2.QueryScope{}}}
					return catalog, nil
				},
				Registrations: []resourcev2.Registration[struct{}]{registration},
			})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sdk.Close()) })
			wire := setupGRPCProvider(t, sdk)
			ctrl, _ := newTestControllerWithEmitter(t)
			registerMockPlugin(ctrl, "p1", wire)
			target, err := ctrl.ResolveToolTarget(testInvocationContext(), "p1", resourcev2.AccessRoute{Connection: "route"}, "objects")
			require.NoError(t, err)
			reference := canonicalTestRecord("native", target.Authority, "objects", "native-target").Reference
			request := resourcev2.ActionRequest{Route: target.Route, Reference: reference, Action: "native-action", Input: resourcev2.Value{Kind: "null"}}
			value, err := ctrl.Action(testInvocationContext(), "p1", request)
			if authoritativeEmpty {
				require.Error(t, err)
				require.Zero(t, calls)
			} else {
				require.NoError(t, err)
				require.Equal(t, "native-result", value.String)
				require.Equal(t, 1, calls)
			}
			before := calls
			request.ExpectedDescriptor = &resourcev2.ActionDescriptor{ID: "native-action", Label: "Retained advertisement", Scope: resourcev2.ActionScopeInstance}
			_, err = ctrl.Action(testInvocationContext(), "p1", request)
			require.Error(t, err)
			require.Equal(t, before, calls)
		})
	}
}

func TestHostNativeQueryMetadataRejectsBeforeNativeWork(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	calls := 0
	provider := &mockProvider{}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("native", "objects")
		catalog.Types[0].ModelRepresentation = "native"
		catalog.Types[0].NativeQueries = []resourcev2.NativeQueryDescriptor{{
			Language:    "selector.v1",
			InputSchema: resourcev2.Schema{Properties: map[string]resourcev2.SchemaProperty{"selector": {Type: resourcev2.SchemaString}}, Required: []string{"selector"}},
		}}
		return catalog, nil
	}
	provider.NativeQueryFunc = func(context.Context, resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error) {
		calls++
		return resourcev2.SourcePage{}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "route", "objects")
	catalog, err := ctrl.Catalog(testInvocationContext(), "p1", resourcev2.CatalogRequest{Route: target.Target.Route})
	require.NoError(t, err)
	require.Equal(t, "native", catalog.Types[0].ModelRepresentation)
	require.Empty(t, catalog.Types[0].DefaultRepresentation, "model metadata must not invent an undeclared UI default")
	require.Equal(t, "native", target.Target.Representation, "explicit native read selection must remain unchanged")
	for _, language := range []string{"unknown", "selector.v1"} {
		_, err := ctrl.NativeQuery(testInvocationContext(), "p1", HostNativeQueryRequest{
			TargetID: target.TargetID,
			Request:  resourcev2.NativeQueryRequest{Target: target.Target, Language: language, Query: resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"selector": {Kind: "int64", Int: "9007199254740993"}}}},
		})
		require.Error(t, err)
	}
	require.Zero(t, calls)
}
