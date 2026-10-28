package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestGetEditorSchemas_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	revision := "schema-r1"
	documentRef := &resource.SchemaDocumentReference{ID: "kubernetes-openapi", Revision: revision}
	mock := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("k8s:/pods", "k8s:apps/deployments"),
		GetEditorSchemasFunc: func(_ context.Context, route resource.AccessRoute) ([]resource.EditorSchema, error) {
			assert.Equal(t, "conn-1", route.Connection)
			return []resource.EditorSchema{
				{Type: "k8s:/pods", Language: "yaml", URI: "k8s://pod.yaml", Binding: resource.SchemaBinding{State: "available", Revision: &revision, Dialect: "https://json-schema.org/draft/2020-12/schema", Root: "#/$defs/Pod", DocumentRef: documentRef, Validation: "none"}},
				{Type: "k8s:apps/deployments", Language: "yaml", URI: "k8s://deployment.yaml", Binding: resource.SchemaBinding{State: "available", Revision: &revision, Dialect: "https://json-schema.org/draft/2020-12/schema", Root: "#/$defs/Deployment", DocumentRef: documentRef, Validation: "none"}},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	schemas, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	require.Len(t, schemas, 2)
	assert.Equal(t, "k8s:/pods", schemas[0].Type)
	assert.Equal(t, "yaml", schemas[0].Language)
	assert.Equal(t, "k8s:apps/deployments", schemas[1].Type)
	assert.Equal(t, documentRef, schemas[0].Binding.DocumentRef)
	assert.Equal(t, schemas[0].Binding.DocumentRef, schemas[1].Binding.DocumentRef)
	assert.NotEqual(t, schemas[0].Binding.Root, schemas[1].Binding.Root)
}

func TestGetEditorSchemas_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("k8s:/pods"),
		GetEditorSchemasFunc: func(_ context.Context, _ resource.AccessRoute) ([]resource.EditorSchema, error) {
			return nil, errors.New("schemas unavailable")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestGetEditorSchemas_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetEditorSchemas(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn-1"})
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetEditorSchemas_EmptyResult(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("k8s:/pods"),
		GetEditorSchemasFunc: func(_ context.Context, _ resource.AccessRoute) ([]resource.EditorSchema, error) {
			return []resource.EditorSchema{}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	schemas, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	assert.Empty(t, schemas)
}

func TestGetEditorSchemas_RequestCancellationIsTyped(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("k8s:/pods"), GetEditorSchemasFunc: func(context.Context, resource.AccessRoute) ([]resource.EditorSchema, error) {
		// Cancel only after valid catalog admission reaches the provider.
		cancel()
		return nil, context.Canceled
	}})
	_, err := ctrl.GetEditorSchemas(ctx, "p1", resource.AccessRoute{Connection: "conn-1"})
	assert.Equal(t, "CANCELLED", requireAppError(t, err).Code)
}

func TestGetEditorSchemasRejectsRetiredGenerationResult(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("k8s:/pods"), GetEditorSchemasFunc: func(context.Context, resource.AccessRoute) ([]resource.EditorSchema, error) {
		registerMockPlugin(ctrl, "p1", &mockProvider{})
		return []resource.EditorSchema{{Type: "retired-generation"}}, nil
	}})
	schemas, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.Error(t, err)
	assert.Nil(t, schemas)
	assert.Contains(t, []string{"CANCELLED", "RESET_REQUIRED"}, requireAppError(t, err).Code)
}
