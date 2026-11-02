package resource

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const editorTestDocument = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"properties":{"name":{"type":"string"},"spec":{"type":"object","properties":{"replicas":{"type":"integer"}}}}}`

func schemaTestType(resourceType string, binding resource.SchemaBinding, withDefault bool) resource.ResourceType {
	descriptor := canonicalTestCatalog("proof", resourceType).Types[0]
	descriptor.Representations = []resource.Representation{{ID: "native", Revision: "r1", Schema: binding}}
	if withDefault {
		descriptor.DefaultRepresentation = "native"
	}
	return descriptor
}

func inlineSchemaBinding(document string) resource.SchemaBinding {
	revision := "schema:r1"
	return resource.SchemaBinding{State: "available", Revision: &revision, Dialect: resource.DialectJSONSchema202012, Document: json.RawMessage(document)}
}

func unsupportedDialectBinding() resource.SchemaBinding {
	binding := inlineSchemaBinding(`{}`)
	binding.Dialect = "https://json-schema.org/draft/2019-09/schema"
	return binding
}

func draft07Binding(document string) resource.SchemaBinding {
	binding := inlineSchemaBinding(document)
	binding.Dialect = resource.DialectJSONSchemaDraft07
	return binding
}

// schemaTestCatalog declares one type per schema state plus a type without a
// default representation.
func schemaTestCatalog(document string) func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
	return func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		forbidden := "FORBIDDEN"
		catalog := canonicalTestCatalog("proof", "available")
		catalog.Types = []resource.ResourceType{
			schemaTestType("absent", resource.SchemaBinding{State: "absent"}, true),
			schemaTestType("available", inlineSchemaBinding(document), true),
			schemaTestType("nodefault", inlineSchemaBinding(document), false),
			schemaTestType("unavailable", resource.SchemaBinding{State: "unavailable", UnavailableReason: &forbidden}, true),
			schemaTestType("unsupported", unsupportedDialectBinding(), true),
		}
		return catalog, nil
	}
}

func associationsByType(associations []EditorSchemaAssociation) map[string]EditorSchemaAssociation {
	out := make(map[string]EditorSchemaAssociation, len(associations))
	for _, association := range associations {
		out[association.Type] = association
	}
	return out
}

func TestGetEditorSchemasDerivesAssociationsFromCatalog(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(editorTestDocument)})

	associations, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	byType := associationsByType(associations)
	require.Len(t, byType, 4, "types without a default representation are skipped")
	assert.NotContains(t, byType, "nodefault")
	assert.Equal(t, "absent", byType["absent"].Status)
	assert.Equal(t, "unavailable", byType["unavailable"].Status)
	assert.Equal(t, "FORBIDDEN", byType["unavailable"].Code)
	assert.Equal(t, "unsupported", byType["unsupported"].Status)
	available := byType["available"]
	assert.Equal(t, "available", available.Status)
	assert.Equal(t, "yaml", available.Language)
	assert.Equal(t, "native", available.Representation)
	assert.Len(t, available.DocumentID, 64)
	assert.Regexp(t, `^#/definitions/n[0-9]+$`, available.Root)
	assert.Regexp(t, `^file:///omniview-schema/[0-9a-f]{16}$`, available.ModelDirectory)
	assert.Equal(t, "**/omniview-schema/"+available.ModelDirectory[len("file:///omniview-schema/"):]+"/*", available.FileMatch)
	for _, association := range associations {
		if association.Status != "available" {
			assert.Empty(t, association.DocumentID)
			assert.Empty(t, association.Root)
		}
	}

	document, err := ctrl.GetEditorSchemaDocument(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, available.DocumentID)
	require.NoError(t, err)
	var rendered map[string]any
	require.NoError(t, json.Unmarshal(document.Schema, &rendered))
	assert.Equal(t, "http://json-schema.org/draft-07/schema#", rendered["$schema"])
	assert.Contains(t, rendered["definitions"], available.Root[len("#/definitions/"):])
}

func TestGetEditorSchemasIsolatesConnections(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	otherDocument := `{"type":"object","properties":{"other":{"type":"string"}}}`
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
		if request.Route.Connection == "conn-2" {
			return schemaTestCatalog(otherDocument)(ctx, request)
		}
		return schemaTestCatalog(editorTestDocument)(ctx, request)
	}})
	first, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	second, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-2"})
	require.NoError(t, err)
	firstAvailable, secondAvailable := associationsByType(first)["available"], associationsByType(second)["available"]
	assert.NotEqual(t, firstAvailable.ModelDirectory, secondAvailable.ModelDirectory)
	assert.NotEqual(t, firstAvailable.DocumentID, secondAvailable.DocumentID)

	_, err = ctrl.GetEditorSchemaDocument(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-2"}, firstAvailable.DocumentID)
	assert.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
	assert.Equal(t, 2, ctrl.schemas.Stats().Connections)

	ctrl.pluginsMu.Lock()
	require.NoError(t, ctrl.invalidateSourceRoutesLocked("p1", []string{"conn-1"}, false))
	ctrl.pluginsMu.Unlock()
	stats := ctrl.schemas.Stats()
	assert.Equal(t, 1, stats.Connections, "route invalidation drops the connection snapshot")
	assert.Equal(t, 1, stats.Documents)
}

func TestSchemaSnapshotRejectsRetiredEpochWithoutReplacingCurrent(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(editorTestDocument)})
	route := resource.AccessRoute{Connection: "conn-1"}
	ctrl.pluginsMu.Lock()
	generation := ctrl.plugins["p1"]
	epoch := generation.sourceEpoch[route.Connection]
	require.NoError(t, ctrl.invalidateSourceRoutesLocked("p1", []string{route.Connection}, false))
	ctrl.pluginsMu.Unlock()

	associations, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	documentID := associationsByType(associations)["available"].DocumentID
	require.NotEmpty(t, documentID)
	catalog, err := schemaTestCatalog(editorTestDocument)(context.Background(), resource.CatalogRequest{Route: route})
	require.NoError(t, err)
	stale := context.WithValue(testInvocationContext(), sourceEpochKey{}, sourceEpochSnapshot{Connection: route.Connection, Epoch: epoch})
	_, _, err = ctrl.observeSchemaSnapshot(stale, "p1", generation, route, catalog)
	assert.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err))
	document, err := ctrl.GetEditorSchemaDocument(testInvocationContext(), "p1", route, documentID)
	require.NoError(t, err)
	assert.Equal(t, documentID, document.DocumentID)
	assert.Equal(t, 1, ctrl.schemas.Stats().Connections)
}

func TestGetEditorSchemasAuxiliarySchemas(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: schemaTestCatalog(editorTestDocument),
		GetEditorSchemasFunc: func(_ context.Context, route resource.AccessRoute) ([]resource.EditorSchema, error) {
			assert.Equal(t, "conn-1", route.Connection)
			return []resource.EditorSchema{
				{Type: "helm:releases", Key: "default/web", Language: "json", Binding: draft07Binding(`{"type":"object"}`)},
				{Type: "helm:releases", Key: "default/api", Language: "yaml", Binding: resource.SchemaBinding{State: "absent"}},
			}, nil
		},
	})
	associations, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	require.Len(t, associations, 6)
	web, api := associations[4], associations[5]
	assert.Equal(t, EditorSchemaAssociation{Type: "helm:releases", Key: "default/web", Language: "json", ModelDirectory: web.ModelDirectory, FileMatch: web.FileMatch, DocumentID: web.DocumentID, Root: web.Root, Status: "available"}, web)
	assert.NotEmpty(t, web.DocumentID)
	assert.Equal(t, "absent", api.Status)
	assert.NotEqual(t, web.ModelDirectory, api.ModelDirectory)

	_, err = ctrl.GetEditorSchemaDocument(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, web.DocumentID)
	require.NoError(t, err)
}

func TestGetEditorSchemasAuxiliaryFailureKeepsCatalogAssociations(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: schemaTestCatalog(editorTestDocument),
		GetEditorSchemasFunc: func(context.Context, resource.AccessRoute) ([]resource.EditorSchema, error) {
			return nil, resource.NewError("FORBIDDEN", "denied")
		},
	})
	associations, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	require.Len(t, associations, 5)
	failure := associations[4]
	assert.Equal(t, "unavailable", failure.Status)
	assert.Equal(t, "FORBIDDEN", failure.Code)
	assert.Equal(t, "yaml", failure.Language)
	assert.Empty(t, failure.Type)
	assert.Empty(t, failure.Key)
}

func TestGetEditorSchemasAuxiliaryCancellationAborts(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(editorTestDocument), GetEditorSchemasFunc: func(context.Context, resource.AccessRoute) ([]resource.EditorSchema, error) {
		cancel()
		return nil, context.Canceled
	}})
	_, err := ctrl.GetEditorSchemas(ctx, "p1", resource.AccessRoute{Connection: "conn-1"})
	assert.Equal(t, "CANCELLED", requireAppError(t, err).Code)
}

func TestGetEditorSchemasReferenceFetchCancellationAborts(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	reference := resource.SchemaDocumentReference{ID: "doc", Revision: "r1"}
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
			catalog, err := withReferencedSchema(lifecycleTestCatalog("pods"), reference)(ctx, request)
			catalog.Types[0].DefaultRepresentation = catalog.Types[0].Representations[0].ID
			return catalog, err
		},
		GetSchemaDocumentFunc: func(context.Context, resource.AccessRoute, resource.SchemaDocumentReference) (resource.SchemaDocument, error) {
			cancel()
			return resource.SchemaDocument{}, resource.NewError("CANCELLED", "cancelled")
		},
	})
	_, err := ctrl.GetEditorSchemas(ctx, "p1", resource.AccessRoute{Connection: "conn-1"})
	assert.Equal(t, "CANCELLED", requireAppError(t, err).Code)
}

func TestGetEditorSchemas_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetEditorSchemas(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn-1"})
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetEditorSchemasRejectsRetiredGenerationResult(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("k8s:/pods"), GetEditorSchemasFunc: func(context.Context, resource.AccessRoute) ([]resource.EditorSchema, error) {
		registerMockPlugin(ctrl, "p1", &mockProvider{})
		return []resource.EditorSchema{}, nil
	}})
	schemas, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.Error(t, err)
	assert.Nil(t, schemas)
	assert.Contains(t, []string{"CANCELLED", "RESET_REQUIRED"}, requireAppError(t, err).Code)
}

func TestGetSchemaFieldsNavigatesCatalogSchema(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(editorTestDocument)})
	route := resource.AccessRoute{Connection: "conn-1"}

	root, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "available"})
	require.NoError(t, err)
	assert.Equal(t, "native", root.Representation, "empty representation selects the default")
	assert.Equal(t, "available", root.SchemaState)
	assert.Equal(t, "schema:r1", root.SchemaRevision)
	assert.Equal(t, resourcecatalog.HostEvaluationSchemaChecked, root.Overlay.HostEvaluation)
	assert.Equal(t, "full", root.Overlay.Validation)
	assert.NotEmpty(t, root.CatalogRevision)
	names := make([]string, 0, len(root.Fields))
	for _, field := range root.Fields {
		names = append(names, field.Segment.Name)
		assert.Equal(t, "unsupported", field.NativeFilter)
	}
	assert.Equal(t, []string{"name", "spec"}, names)

	spec, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "available", Representation: "native", Path: []resourcecatalog.PathSegment{{Kind: "field", Name: "spec"}}})
	require.NoError(t, err)
	require.Len(t, spec.Fields, 1)
	assert.Equal(t, "replicas", spec.Fields[0].Segment.Name)
	assert.Equal(t, []string{"integer"}, spec.Fields[0].Types)

	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "available", Path: []resourcecatalog.PathSegment{{Kind: "field", Name: "missing"}}})
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code)
}

func TestGetSchemaFieldsReportsSchemaStates(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(editorTestDocument)})
	route := resource.AccessRoute{Connection: "conn-1"}

	absent, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "absent"})
	require.NoError(t, err)
	assert.Equal(t, resourcecatalog.HostEvaluationDynamic, absent.Overlay.HostEvaluation)
	assert.Equal(t, "none", absent.Overlay.Validation)
	assert.NotNil(t, absent.Fields)
	assert.Empty(t, absent.Fields)

	unavailable, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "unavailable"})
	require.NoError(t, err)
	assert.Equal(t, resourcecatalog.HostEvaluationUnavailable, unavailable.Overlay.HostEvaluation)
	assert.Equal(t, "FORBIDDEN", unavailable.Overlay.HostEvaluationCode)
	assert.Empty(t, unavailable.Fields)

	unsupported, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "unsupported"})
	require.NoError(t, err)
	assert.Equal(t, resourcecatalog.HostEvaluationUnsupported, unsupported.Overlay.HostEvaluation)
	assert.Equal(t, "UNSUPPORTED", unsupported.Overlay.HostEvaluationCode)

	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "nodefault"})
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code)
	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Route: route, Type: "missing", Representation: "native"})
	assert.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
}

func TestGetSchemaFieldsReturnsTransientFetchErrors(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	reference := resource.SchemaDocumentReference{ID: "doc", Revision: "r1"}
	fetches := 0
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: withReferencedSchema(lifecycleTestCatalog("pods"), reference),
		GetSchemaDocumentFunc: func(_ context.Context, _ resource.AccessRoute, ref resource.SchemaDocumentReference) (resource.SchemaDocument, error) {
			fetches++
			if fetches == 1 {
				return resource.SchemaDocument{}, resource.NewError("UNAVAILABLE", "backend down")
			}
			return resource.SchemaDocument{Reference: ref, Dialect: resource.DialectJSONSchema202012, Document: json.RawMessage(editorTestDocument)}, nil
		},
	})
	request := SchemaFieldsRequest{Route: resource.AccessRoute{Connection: "conn-1"}, Type: "pods", Representation: "native"}
	_, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", request)
	assert.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
	result, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", request)
	require.NoError(t, err, "fetch errors are never cached")
	assert.Equal(t, resourcecatalog.HostEvaluationSchemaChecked, result.Overlay.HostEvaluation)
	assert.Len(t, result.Fields, 2)
}
