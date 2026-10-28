package resource

import (
	"context"
	"encoding/json"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCatalog_ResourceMetadataAndCapabilities(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expected := canonicalTestCatalog("native", "pods")
	expected.Types[0].IdentityDimensions = []resource.Dimension{{Name: "namespace"}}
	expected.Types[0].QueryDimensions = []resource.Dimension{{Name: "namespace"}}
	expected.Types[0].Capabilities = []resource.Capability{{Operation: resource.OperationGet, Scope: resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeAny}}}}
	var err error
	expected.Revision, err = resource.BindCatalogRevision(bindingTestEpoch(t), expected.Revision)
	require.NoError(t, err)
	registerMockPlugin(ctrl, "p1", &catalogOnlyProvider{CatalogFunc: func(_ context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
		assert.Equal(t, "conn-1", request.Route.Connection)
		return expected, nil
	}})
	catalog, err := ctrl.Catalog(testInvocationContext(), "p1", resource.CatalogRequest{Route: resource.AccessRoute{Connection: "conn-1"}})
	require.NoError(t, err)
	assert.Equal(t, expected.Provider, catalog.Provider)
	assert.Equal(t, expected.Types, catalog.Types)
	assert.Equal(t, expected.Coverage, catalog.Coverage)
	assert.Equal(t, resource.OperationGet, catalog.Types[0].Capabilities[0].Operation)
	assert.Equal(t, "namespace", catalog.Types[0].IdentityDimensions[0].Name)
	assert.Equal(t, "absent", catalog.Types[0].Representations[0].Schema.State)
}

func TestResolveTarget_RejectsUnknownTypeAndRepresentation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", finiteTestProvider("native"))
	for _, request := range []ResolveTargetRequest{{Route: resource.AccessRoute{Connection: "conn-1"}, Type: "absent", Representation: "native"}, {Route: resource.AccessRoute{Connection: "conn-1"}, Type: "pods", Representation: "absent"}} {
		_, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
		require.Error(t, err)
	}
}

func TestCatalog_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return resource.Catalog{}, resource.NewError("UNAVAILABLE", "native catalog unavailable")
	}})
	_, err := ctrl.Catalog(testInvocationContext(), "p1", resource.CatalogRequest{Route: resource.AccessRoute{Connection: "conn-1"}})
	assert.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
}

func TestPresentation_GroupsAndDefinition(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	route := resource.AccessRoute{Connection: "conn-1"}
	groups := []resource.ResourceGroup{{ID: "core", Name: "Core", Resources: []string{"pods"}}, {ID: "apps", Name: "Applications", Resources: []string{"deployments"}}}
	definition := resource.ResourceDefinition{ColumnDefs: []resource.ColumnDefinition{{ID: "name", Header: "Name", Accessors: "metadata.name"}}}
	provider := finiteTestProvider("native")
	provider.GetResourceGroupsFunc = func(_ context.Context, in resource.AccessRoute) ([]resource.ResourceGroup, error) {
		assert.Equal(t, route, in)
		return groups, nil
	}
	provider.GetResourceDefinitionFunc = func(_ context.Context, in resource.AccessRoute, typ string) (resource.ResourceDefinition, error) {
		assert.Equal(t, route, in)
		assert.Equal(t, "pods", typ)
		return definition, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	result, err := ctrl.GetResourceGroups(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	assert.Equal(t, groups, result)
	def, err := ctrl.GetResourceDefinition(testInvocationContext(), "p1", route, "pods")
	require.NoError(t, err)
	assert.Equal(t, definition, def)
}

func TestPresentation_SchemaDocument(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	route := resource.AccessRoute{Connection: "conn-1"}
	reference := resource.SchemaDocumentReference{ID: "native/schema", Revision: "schema:r1"}
	document := resource.SchemaDocument{Reference: reference, Dialect: "https://json-schema.org/draft/2020-12/schema", Document: json.RawMessage(`{"type":"object","properties":{"name":{"type":"string"}}}`)}
	provider := finiteTestProvider("native")
	provider.GetSchemaDocumentFunc = func(_ context.Context, in resource.AccessRoute, ref resource.SchemaDocumentReference) (resource.SchemaDocument, error) {
		assert.Equal(t, route, in)
		assert.Equal(t, reference, ref)
		return document, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	result, err := ctrl.GetSchemaDocument(testInvocationContext(), "p1", route, reference)
	require.NoError(t, err)
	assert.Equal(t, document, result)
}

func TestPresentation_ProviderErrors(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	route := resource.AccessRoute{Connection: "conn-1"}
	provider := finiteTestProvider("native")
	failure := resource.NewError("FORBIDDEN", "denied")
	provider.GetResourceGroupsFunc = func(context.Context, resource.AccessRoute) ([]resource.ResourceGroup, error) { return nil, failure }
	provider.GetResourceDefinitionFunc = func(context.Context, resource.AccessRoute, string) (resource.ResourceDefinition, error) {
		return resource.ResourceDefinition{}, failure
	}
	provider.GetSchemaDocumentFunc = func(context.Context, resource.AccessRoute, resource.SchemaDocumentReference) (resource.SchemaDocument, error) {
		return resource.SchemaDocument{}, failure
	}
	registerMockPlugin(ctrl, "p1", provider)
	_, err := ctrl.GetResourceGroups(testInvocationContext(), "p1", route)
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
	_, err = ctrl.GetResourceDefinition(testInvocationContext(), "p1", route, "pods")
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
	_, err = ctrl.GetSchemaDocument(testInvocationContext(), "p1", route, resource.SchemaDocumentReference{ID: "schema", Revision: "r1"})
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
}
