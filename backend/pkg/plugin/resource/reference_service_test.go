package resource

import (
	"context"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveReferencePreservesOpaqueExactIdentity(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := canonicalTestCatalog("provider/雪", "objects/opaque")
	catalog.Types[0].IdentityDimensions = []resource.Dimension{{Name: "region"}, {Name: "account"}}
	catalog.Types[0].QueryDimensions = []resource.Dimension{{Name: "region"}, {Name: "account"}}
	for i := range catalog.Types[0].Capabilities {
		catalog.Types[0].Capabilities[i].Scope = resource.QueryScope{{Dimension: "region", Match: resource.ScopeAny}, {Dimension: "account", Match: resource.ScopeAny}}
	}
	var err error
	catalog.Revision, err = resource.BindCatalogRevision(bindingTestEpoch(t), catalog.Revision)
	require.NoError(t, err)
	registerMockPlugin(ctrl, "p1", &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) { return catalog, nil }})
	input := ResolveReferenceRequest{
		Route: resource.AccessRoute{Connection: "route/雪"}, Type: "objects/opaque", ID: "opaque/a::b/雪%2F",
		Scope: []resource.ScopeEntry{{Dimension: "region", Value: "west/a::雪"}, {Dimension: "account", Value: "account/1"}}, Representation: "native",
	}
	resolved, err := ctrl.ResolveReference(testInvocationContext(), "p1", input)
	require.NoError(t, err)
	assert.Equal(t, input.ID, resolved.Reference.Address.ID)
	assert.ElementsMatch(t, input.Scope, resolved.Reference.Address.Scope)
	assert.Equal(t, catalog.Provider, resolved.Reference.Address.Provider)
	assert.Equal(t, input.Type, resolved.Reference.Address.Type)
	assert.Equal(t, input.Route, resolved.Route)
	assert.Nil(t, resolved.Reference.Incarnation, "absence must not become an inferred incarnation")
	assert.NotEmpty(t, resolved.Reference.Address.Authority)
	assert.NotEmpty(t, resolved.AddressKey)
	assert.NotEmpty(t, resolved.Key)
	incarnation := "created/雪::1"
	input.Incarnation = &incarnation
	recreated, err := ctrl.ResolveReference(testInvocationContext(), "p1", input)
	require.NoError(t, err)
	require.NotNil(t, recreated.Reference.Incarnation)
	assert.Equal(t, incarnation, *recreated.Reference.Incarnation)
	assert.Equal(t, resolved.AddressKey, recreated.AddressKey, "incarnation is not address identity")
	input.Scope = append(input.Scope, resource.ScopeEntry{Dimension: "region", Value: "other"})
	_, err = ctrl.ResolveReference(testInvocationContext(), "p1", input)
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code)
}

func TestResolveReferenceRequiresExplicitOrDeclaredDefaultRepresentation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := canonicalTestCatalog("native", "objects")
	var err error
	epoch := bindingTestEpoch(t)
	catalog.Revision, err = resource.BindCatalogRevision(epoch, catalog.Revision)
	require.NoError(t, err)
	registerMockPlugin(ctrl, "p1", &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) { return catalog, nil }})
	input := ResolveReferenceRequest{Route: resource.AccessRoute{Connection: "conn-1"}, Type: "objects", ID: "opaque", Scope: []resource.ScopeEntry{}}
	_, err = ctrl.ResolveReference(testInvocationContext(), "p1", input)
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code, "singleton representation must not imply default")
	input.Representation = "native"
	explicit, err := ctrl.ResolveReference(testInvocationContext(), "p1", input)
	require.NoError(t, err)
	assert.Equal(t, "native", explicit.Representation)
	second := canonicalTestRepresentation()
	second.ID = "alternate"
	catalog.Types[0].Representations = append(catalog.Types[0].Representations, second)
	catalog.Types[0].DefaultRepresentation = "alternate"
	catalog.Revision, err = resource.BindCatalogRevision(epoch, "default-representation-changed")
	require.NoError(t, err)
	input.Representation = ""
	defaulted, err := ctrl.ResolveReference(testInvocationContext(), "p1", input)
	require.NoError(t, err)
	assert.Equal(t, "alternate", defaulted.Representation)
	input.Representation = "absent"
	_, err = ctrl.ResolveReference(testInvocationContext(), "p1", input)
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code)
}

func TestHostRowIdentitySeparatesLabelsRoutesAndGenerations(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := finiteTestProvider("native")
	calls := 0
	original := provider.GetFunc
	provider.GetFunc = func(ctx context.Context, request resource.GetRequest) (resource.Record, error) {
		calls++
		return original(ctx, request)
	}
	registerMockPlugin(ctrl, "p1", provider)
	first := admittedReadTarget(t, ctrl, "p1", "route-a", "pods")
	second := admittedReadTarget(t, ctrl, "p1", "route-a", "pods")
	assert.NotEqual(t, first.TargetID, second.TargetID)
	request := HostGetRequest{TargetID: first.TargetID, Request: resource.GetRequest{
		Route: first.Target.Route, Representation: first.Target.Representation,
		Reference: canonicalTestRecord(first.Target.Provider, first.Target.Authority, first.Target.Type, "opaque/雪").Reference,
	}}
	one, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	request.TargetID = second.TargetID
	two, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	assert.Equal(t, one.AddressKey, two.AddressKey)
	assert.NotEqual(t, one.Key, two.Key)
	assert.Equal(t, 2, calls, "independent request labels must not deduplicate acquisition")
	request.TargetID = "caller-local-label"
	three, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.NoError(t, err, "request label is not a retained grant")
	invalid := request
	invalid.Request.Reference.Address.Authority = "different-authority"
	_, err = ctrl.Get(testInvocationContext(), "p1", invalid)
	assert.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	assert.Equal(t, 3, calls, "matching label must not admit a different actual authority")
	otherRoute := admittedReadTarget(t, ctrl, "p1", "route-b", "pods")
	otherRequest := request
	otherRequest.Request.Route = otherRoute.Target.Route
	otherRequest.Request.Reference.Address.Authority = otherRoute.Target.Authority
	other, err := ctrl.Get(testInvocationContext(), "p1", otherRequest)
	require.NoError(t, err)
	assert.Equal(t, 4, calls, "matching labels on distinct routes must still acquire independently")
	assert.NotEqual(t, three.Key, other.Key)
	registerMockPlugin(ctrl, "p1", provider)
	_, err = ctrl.Get(testInvocationContext(), "p1", request)
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	assert.Equal(t, 4, calls, "stale source identity must not reach native Get")
	fresh := admittedReadTarget(t, ctrl, "p1", "route-a", "pods")
	request.TargetID = fresh.TargetID
	request.Request.Route = fresh.Target.Route
	request.Request.Reference.Address.Authority = fresh.Target.Authority
	restarted, err := ctrl.Get(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	assert.NotEqual(t, three.AddressKey, restarted.AddressKey, "replacement requires a newly resolved authority")
	assert.NotEqual(t, three.Key, restarted.Key, "generation must change opaque row identity")
	assert.Equal(t, 5, calls)
}
