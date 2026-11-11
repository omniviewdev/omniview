package resource

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const editorTestDocument = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"properties":{"name":{"type":"string"},"spec":{"type":"object","properties":{"replicas":{"type":"integer"}}}}}`

func schemaTestType(resourceType string, withDefault bool) resource.ResourceType {
	descriptor := canonicalTestCatalog("proof", resourceType).Types[0]
	descriptor.Representations = []resource.Representation{{ID: "native", Revision: "r1"}}
	if withDefault {
		descriptor.DefaultRepresentation = "native"
	} else {
		descriptor.DefaultRepresentation = ""
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

func schemaTestCatalog() func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
	return func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("proof", "available")
		catalog.Types = []resource.ResourceType{schemaTestType("absent", true), schemaTestType("available", true), schemaTestType("nodefault", false), schemaTestType("unavailable", true), schemaTestType("unsupported", true)}
		return catalog, nil
	}
}

func schemaTestResolver(document string) func(context.Context, resource.SchemaRequest) (resource.SchemaBinding, error) {
	return func(_ context.Context, request resource.SchemaRequest) (resource.SchemaBinding, error) {
		switch request.Type {
		case "available", "nodefault":
			return inlineSchemaBinding(document), nil
		case "unavailable":
			return resource.SchemaBinding{State: "unavailable", UnavailableReason: new("FORBIDDEN")}, nil
		case "unsupported":
			return unsupportedDialectBinding(), nil
		default:
			return resource.SchemaBinding{State: "absent"}, nil
		}
	}
}

func targetedSchemaRequest(connection, typ string) resource.SchemaRequest {
	return resource.SchemaRequest{Route: resource.AccessRoute{Connection: connection}, Type: typ, Target: resource.SchemaTarget{Representation: &resource.Representation{ID: "native", Revision: "r1"}}}
}

func TestResolveEditorSchemaReturnsOnlyDemandedCoherentBundle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	requests := []resource.SchemaRequest{}
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: func(ctx context.Context, request resource.SchemaRequest) (resource.SchemaBinding, error) {
		requests = append(requests, request)
		return schemaTestResolver(editorTestDocument)(ctx, request)
	}})
	request := targetedSchemaRequest("conn-1", "available")
	out, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Equal(t, []resource.SchemaRequest{request}, requests, "one editor cannot enumerate schemas for unrelated types")
	assert.Equal(t, request.Target, out.Target)
	assert.Equal(t, "available", out.Status)
	assert.NotEmpty(t, out.Observation)
	require.NotNil(t, out.Document)
	assert.Len(t, out.Document.DocumentID, 64)
	assert.Regexp(t, `^#/definitions/n[0-9]+$`, out.Root)
	var rendered map[string]any
	require.NoError(t, json.Unmarshal(out.Document.Schema, &rendered))
	assert.Equal(t, "http://json-schema.org/draft-07/schema#", rendered["$schema"])
	assert.Contains(t, rendered["definitions"], out.Root[len("#/definitions/"):])
	encoded, err := json.Marshal(out)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "modelDirectory")
	assert.NotContains(t, string(encoded), "fileMatch")
	again, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	assert.Equal(t, out, again, "fresh repeated demand reuses the entire coherent observation")
	assert.Len(t, requests, 1)
}

func TestResolveEditorSchemaReportsOptionalStates(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: schemaTestResolver(editorTestDocument)})
	for _, tc := range []struct{ typ, status, code string }{{"absent", "absent", ""}, {"unavailable", "unavailable", "FORBIDDEN"}, {"unsupported", "unsupported", "UNSUPPORTED"}} {
		t.Run(tc.typ, func(t *testing.T) {
			out, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", targetedSchemaRequest("conn-1", tc.typ))
			require.NoError(t, err)
			assert.Equal(t, tc.status, out.Status)
			assert.Equal(t, tc.code, out.Code)
			assert.Nil(t, out.Document)
			assert.Empty(t, out.Root)
		})
	}
}

func TestResolveEditorSchemaIsolatesConnections(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: func(ctx context.Context, request resource.SchemaRequest) (resource.SchemaBinding, error) {
		document := editorTestDocument
		if request.Route.Connection == "conn-2" {
			document = `{"type":"object","properties":{"other":{"type":"string"}}}`
		}
		return schemaTestResolver(document)(ctx, request)
	}})
	first, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", targetedSchemaRequest("conn-1", "available"))
	require.NoError(t, err)
	second, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", targetedSchemaRequest("conn-2", "available"))
	require.NoError(t, err)
	require.NotNil(t, first.Document)
	require.NotNil(t, second.Document)
	assert.NotEqual(t, first.Document.DocumentID, second.Document.DocumentID)
	assert.NotEqual(t, first.Observation, second.Observation)
	ctrl.pluginsMu.Lock()
	err = ctrl.invalidateSourceRoutesLocked("p1", []string{"conn-1"}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	assert.Equal(t, 1, ctrl.schemas.Stats().Connections)
	assert.Equal(t, 1, ctrl.schemas.Stats().Documents)
}

func TestSchemaSnapshotRejectsRetiredEpochWithoutReplacingCurrent(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: schemaTestResolver(editorTestDocument)})
	route := resource.AccessRoute{Connection: "conn-1"}
	ctrl.pluginsMu.Lock()
	generation := ctrl.plugins["p1"]
	epoch := generation.sourceEpoch[route.Connection]
	err := ctrl.invalidateSourceRoutesLocked("p1", []string{route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	request := targetedSchemaRequest(route.Connection, "available")
	current, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	catalog, err := schemaTestCatalog()(context.Background(), resource.CatalogRequest{Route: route})
	require.NoError(t, err)
	stale := context.WithValue(testInvocationContext(), sourceEpochKey{}, sourceEpochSnapshot{Connection: route.Connection, Epoch: epoch})
	_, _, err = ctrl.observeSchemaSnapshot(stale, "p1", generation, route, catalog)
	assert.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err))
	again, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	assert.Equal(t, current, again)
}

func TestResolveEditorSchemaAdmitsOneExactAuxiliaryTarget(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	var received resource.SchemaRequest
	provider := &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: func(_ context.Context, request resource.SchemaRequest) (resource.SchemaBinding, error) {
		received = request
		return inlineSchemaBinding(`{"type":"object","properties":{"image":{"type":"string"}}}`), nil
	}}
	registerMockPlugin(ctrl, "p1", provider)
	target, err := ctrl.ResolveToolTarget(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "available")
	require.NoError(t, err)
	request := resource.SchemaRequest{Route: target.Route, Type: target.Type, Target: resource.SchemaTarget{Auxiliary: &resource.AuxiliarySchemaTarget{
		Key: "values", Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: "web", Scope: []resource.ScopeEntry{}}}, SourceRevision: new("7"),
	}}}
	out, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	assert.Equal(t, request, received)
	assert.Equal(t, request.Target, out.Target)
	assert.Equal(t, "available", out.Status)
	require.NotNil(t, out.Document)
}

func TestResolveEditorSchemaCancellationAndRetirementRejectResults(t *testing.T) {
	for _, retire := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "generation"}[retire], func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			ctx, cancel := context.WithCancel(testInvocationContext())
			defer cancel()
			registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: func(context.Context, resource.SchemaRequest) (resource.SchemaBinding, error) {
				if retire {
					registerMockPlugin(ctrl, "p1", &mockProvider{})
				} else {
					cancel()
				}
				return inlineSchemaBinding(editorTestDocument), nil
			}})
			out, err := ctrl.ResolveEditorSchema(ctx, "p1", targetedSchemaRequest("conn-1", "available"))
			require.Error(t, err)
			assert.Nil(t, out.Document)
			assert.Contains(t, []string{"CANCELLED", "RESET_REQUIRED"}, requireAppError(t, err).Code)
		})
	}
}

func TestResolveEditorSchemaRevalidatesPrincipalBeforeDelivery(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	denied := false
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(invocation.Principal, string, invocation.Target) error {
		if denied {
			return resource.NewError("FORBIDDEN", "Revoked.")
		}
		return nil
	}))
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: func(context.Context, resource.SchemaRequest) (resource.SchemaBinding, error) {
		denied = true
		return inlineSchemaBinding(editorTestDocument), nil
	}})
	out, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", targetedSchemaRequest("conn-1", "available"))
	require.Error(t, err)
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
	assert.Nil(t, out.Document)
}

func TestResolveEditorSchemaPluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.ResolveEditorSchema(testInvocationContext(), "nonexistent", targetedSchemaRequest("conn-1", "available"))
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetSchemaFieldsNavigatesSameTargetObservation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: schemaTestResolver(editorTestDocument)})
	request := targetedSchemaRequest("conn-1", "available")
	root, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: request})
	require.NoError(t, err)
	assert.Equal(t, request.Target, root.Target)
	assert.Equal(t, "available", root.SchemaState)
	assert.Equal(t, "schema:r1", root.SchemaRevision)
	assert.Equal(t, resourcecatalog.HostEvaluationSchemaChecked, root.Overlay.HostEvaluation)
	require.Len(t, root.Fields, 2)
	assert.Equal(t, "name", root.Fields[0].Segment.Name)
	assert.Equal(t, "spec", root.Fields[1].Segment.Name)
	spec, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: request, Path: []resourcecatalog.PathSegment{{Kind: "field", Name: "spec"}}})
	require.NoError(t, err)
	assert.Equal(t, root.Observation, spec.Observation)
	require.Len(t, spec.Fields, 1)
	assert.Equal(t, "replicas", spec.Fields[0].Segment.Name)
	assert.Equal(t, []string{"integer"}, spec.Fields[0].Types)
	editor, err := ctrl.ResolveEditorSchema(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	assert.Equal(t, root.Observation, editor.Observation)
	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: request, Path: []resourcecatalog.PathSegment{{Kind: "field", Name: "missing"}}})
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code)
}

func TestGetSchemaFieldsRequiresCurrentExplicitTarget(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: schemaTestCatalog(), ResolveSchemaFunc: schemaTestResolver(editorTestDocument)})
	absent, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: targetedSchemaRequest("conn-1", "absent")})
	require.NoError(t, err)
	assert.Equal(t, resourcecatalog.HostEvaluationDynamic, absent.Overlay.HostEvaluation)
	assert.Empty(t, absent.Fields)
	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: targetedSchemaRequest("conn-1", "unavailable")})
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
	unsupported, err := ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: targetedSchemaRequest("conn-1", "unsupported")})
	require.NoError(t, err)
	assert.Equal(t, resourcecatalog.HostEvaluationUnsupported, unsupported.Overlay.HostEvaluation)
	invalid := targetedSchemaRequest("conn-1", "available")
	invalid.Target.Representation.Revision = "old"
	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: invalid})
	assert.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	_, err = ctrl.GetSchemaFields(testInvocationContext(), "p1", SchemaFieldsRequest{Request: targetedSchemaRequest("conn-1", "missing")})
	assert.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
}
