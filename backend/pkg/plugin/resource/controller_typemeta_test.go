package resource

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ============================================================================
// GetResourceGroups
// ============================================================================

func TestGetResourceGroups_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expected := map[string]resource.ResourceGroup{
		"core": {ID: "core", Name: "Core"},
		"apps": {ID: "apps", Name: "Applications"},
	}
	mock := &mockProvider{
		GetResourceGroupsFunc: func(_ context.Context, connID string) (map[string]resource.ResourceGroup, error) {
			assert.Equal(t, "conn-1", connID)
			return expected, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	groups, err := ctrl.GetResourceGroups(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	assert.Len(t, groups, 2)
	assert.Equal(t, "Core", groups["core"].Name)
	assert.Equal(t, "Applications", groups["apps"].Name)
}

func TestGetResourceGroups_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	groups, err := ctrl.GetResourceGroups(testInvocationContext(), "nonexistent", "conn-1")
	require.Error(t, err)
	assert.Nil(t, groups)
}

// ============================================================================
// GetResourceGroup
// ============================================================================

func TestGetResourceGroup_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceGroupFunc: func(_ context.Context, id string) (resource.ResourceGroup, error) {
			assert.Equal(t, "core", id)
			return resource.ResourceGroup{ID: "core", Name: "Core"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	group, err := ctrl.GetResourceGroup(testInvocationContext(), "p1", "core")
	require.NoError(t, err)
	assert.Equal(t, "core", group.ID)
	assert.Equal(t, "Core", group.Name)
}

func TestGetResourceGroup_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceGroupFunc: func(_ context.Context, _ string) (resource.ResourceGroup, error) {
			return resource.ResourceGroup{}, errors.New("group not found")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetResourceGroup(testInvocationContext(), "p1", "nonexistent")
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

// ============================================================================
// GetResourceTypes
// ============================================================================

func TestGetResourceTypes_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expected := map[string]resource.ResourceMeta{
		"core::v1::Pod": {Group: "core", Version: "v1", Kind: "Pod"},
	}
	mock := &mockProvider{
		GetResourceTypesFunc: func(_ context.Context, connID string) (map[string]resource.ResourceMeta, error) {
			assert.Equal(t, "conn-1", connID)
			return expected, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	types, err := ctrl.GetResourceTypes(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	assert.Len(t, types, 1)
	assert.Equal(t, "Pod", types["core::v1::Pod"].Kind)
}

func TestGetResourceTypes_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	types, err := ctrl.GetResourceTypes(testInvocationContext(), "nonexistent", "conn-1")
	require.Error(t, err)
	assert.Nil(t, types)
}

// ============================================================================
// GetResourceType
// ============================================================================

func TestGetResourceType_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceTypeFunc: func(_ context.Context, id string) (*resource.ResourceMeta, error) {
			assert.Equal(t, "core::v1::Pod", id)
			return &resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	meta, err := ctrl.GetResourceType(testInvocationContext(), "p1", "core::v1::Pod")
	require.NoError(t, err)
	require.NotNil(t, meta)
	assert.Equal(t, "Pod", meta.Kind)
	assert.Equal(t, "core", meta.Group)
}

func TestGetResourceType_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceTypeFunc: func(_ context.Context, _ string) (*resource.ResourceMeta, error) {
			return nil, errors.New("type not found")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	meta, err := ctrl.GetResourceType(testInvocationContext(), "p1", "nonexistent")
	require.Error(t, err)
	assert.Nil(t, meta)
}

// ============================================================================
// HasResourceType
// ============================================================================

func TestHasResourceType_True(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		HasResourceTypeFunc: func(_ context.Context, id string) (bool, error) {
			return id == "core::v1::Pod", nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	present, err := ctrl.HasResourceType(testInvocationContext(), "p1", "core::v1::Pod")
	require.NoError(t, err)
	assert.True(t, present)
}

func TestHasResourceType_False(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		HasResourceTypeFunc: func(_ context.Context, _ string) (bool, error) {
			return false, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	present, err := ctrl.HasResourceType(testInvocationContext(), "p1", "nonexistent")
	require.NoError(t, err)
	assert.False(t, present)
}

func TestHasResourceType_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	present, err := ctrl.HasResourceType(testInvocationContext(), "nonexistent", "core::v1::Pod")
	require.Error(t, err)
	assert.False(t, present)
}

// ============================================================================
// GetResourceDefinition
// ============================================================================

func TestGetResourceDefinition_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceDefinitionFunc: func(_ context.Context, _ string) (resource.ResourceDefinition, error) {
			return resource.ResourceDefinition{
				IDAccessor: "metadata.name",
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	def, err := ctrl.GetResourceDefinition(testInvocationContext(), "p1", "core::v1::Pod")
	require.NoError(t, err)
	assert.Equal(t, "metadata.name", def.IDAccessor)
}

func TestGetResourceDefinition_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceDefinitionFunc: func(_ context.Context, _ string) (resource.ResourceDefinition, error) {
			return resource.ResourceDefinition{}, errors.New("def not found")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetResourceDefinition(testInvocationContext(), "p1", "x")
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

// ============================================================================
// GetResourceCapabilities
// ============================================================================

func TestGetResourceCapabilities_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceCapabilitiesFunc: func(_ context.Context, key string) (*resource.ResourceCapabilities, error) {
			return &resource.ResourceCapabilities{
				CanGet:    true,
				CanList:   true,
				CanCreate: key == "core::v1::Pod",
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	caps, err := ctrl.GetResourceCapabilities(testInvocationContext(), "p1", "core::v1::Pod")
	require.NoError(t, err)
	assert.True(t, caps.CanGet)
	assert.True(t, caps.CanList)
	assert.True(t, caps.CanCreate)
}

func TestGetResourceCapabilities_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceCapabilitiesFunc: func(_ context.Context, _ string) (*resource.ResourceCapabilities, error) {
			return nil, errors.New("caps error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	caps, err := ctrl.GetResourceCapabilities(testInvocationContext(), "p1", "pods")
	require.Error(t, err)
	assert.Nil(t, caps)
}

// ============================================================================
// GetResourceSchema
// ============================================================================

func TestGetResourceSchema_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expectedSchema := json.RawMessage(`{"type":"object","properties":{"name":{"type":"string"}}}`)
	mock := &mockProvider{
		GetResourceSchemaFunc: func(_ context.Context, connID, key string) (json.RawMessage, error) {
			assert.Equal(t, "conn-1", connID)
			assert.Equal(t, "pods", key)
			return expectedSchema, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	schema, err := ctrl.GetResourceSchema(testInvocationContext(), "p1", "conn-1", "pods")
	require.NoError(t, err)
	assert.JSONEq(t, string(expectedSchema), string(schema))
}

func TestGetResourceSchema_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceSchemaFunc: func(_ context.Context, _, _ string) (json.RawMessage, error) {
			return nil, errors.New("schema error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetResourceSchema(testInvocationContext(), "p1", "conn-1", "pods")
	assert.Error(t, err)
}

// ============================================================================
// GetFilterFields
// ============================================================================

func TestGetFilterFields_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFilterFieldsFunc: func(_ context.Context, connID, key string) ([]resource.FilterField, error) {
			assert.Equal(t, "conn-1", connID)
			assert.Equal(t, "pods", key)
			return []resource.FilterField{
				{Path: "metadata.namespace", DisplayName: "Namespace"},
				{Path: "status.phase", DisplayName: "Status"},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	fields, err := ctrl.GetFilterFields(testInvocationContext(), "p1", "conn-1", "pods")
	require.NoError(t, err)
	require.Len(t, fields, 2)
	assert.Equal(t, "metadata.namespace", fields[0].Path)
	assert.Equal(t, "Status", fields[1].DisplayName)
}

// ============================================================================
// PluginNotFound tests for type metadata
// ============================================================================

func TestGetResourceGroup_PluginNotFound_TypeMeta(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetResourceGroup(testInvocationContext(), "nonexistent", "core")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetResourceType_PluginNotFound_TypeMeta(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	meta, err := ctrl.GetResourceType(testInvocationContext(), "nonexistent", "x")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Nil(t, meta)
}

func TestGetResourceDefinition_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetResourceDefinition(testInvocationContext(), "nonexistent", "x")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetResourceCapabilities_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	caps, err := ctrl.GetResourceCapabilities(testInvocationContext(), "nonexistent", "pods")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Nil(t, caps)
}

func TestGetResourceSchema_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetResourceSchema(testInvocationContext(), "nonexistent", "conn-1", "pods")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestGetFilterFields_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetFilterFields(testInvocationContext(), "nonexistent", "conn-1", "pods")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}
