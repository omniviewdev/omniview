package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func TestGetEditorSchemas_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetEditorSchemasFunc: func(_ context.Context, connID string) ([]resource.EditorSchema, error) {
			assert.Equal(t, "conn-1", connID)
			return []resource.EditorSchema{
				{ResourceKey: "core::v1::Pod", Language: "yaml", URI: "k8s://pod.yaml"},
				{ResourceKey: "apps::v1::Deployment", Language: "yaml", URI: "k8s://deployment.yaml"},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	schemas, err := ctrl.GetEditorSchemas("p1", "conn-1")
	require.NoError(t, err)
	require.Len(t, schemas, 2)
	assert.Equal(t, "core::v1::Pod", schemas[0].ResourceKey)
	assert.Equal(t, "yaml", schemas[0].Language)
	assert.Equal(t, "apps::v1::Deployment", schemas[1].ResourceKey)
}

func TestGetEditorSchemas_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetEditorSchemasFunc: func(_ context.Context, _ string) ([]resource.EditorSchema, error) {
			return nil, errors.New("schemas unavailable")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetEditorSchemas("p1", "conn-1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "schemas unavailable")
}

func TestGetEditorSchemas_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetEditorSchemas("nonexistent", "conn-1")
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetEditorSchemas_EmptyResult(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetEditorSchemasFunc: func(_ context.Context, _ string) ([]resource.EditorSchema, error) {
			return []resource.EditorSchema{}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	schemas, err := ctrl.GetEditorSchemas("p1", "conn-1")
	require.NoError(t, err)
	assert.Empty(t, schemas)
}
