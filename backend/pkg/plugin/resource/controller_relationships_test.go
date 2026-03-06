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

// ============================================================================
// GetRelationships
// ============================================================================

func TestGetRelationships_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetRelationshipsFunc: func(_ context.Context, key string) ([]resource.RelationshipDescriptor, error) {
			assert.Equal(t, "core::v1::Pod", key)
			return []resource.RelationshipDescriptor{
				{
					Type:              resource.RelOwns,
					TargetResourceKey: "apps::v1::ReplicaSet",
					Label:             "owned by",
				},
				{
					Type:              resource.RelUses,
					TargetResourceKey: "core::v1::ConfigMap",
					Label:             "uses",
				},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	rels, err := ctrl.GetRelationships("p1", "core::v1::Pod")
	require.NoError(t, err)
	require.Len(t, rels, 2)
	assert.Equal(t, resource.RelOwns, rels[0].Type)
	assert.Equal(t, "apps::v1::ReplicaSet", rels[0].TargetResourceKey)
	assert.Equal(t, "owned by", rels[0].Label)
	assert.Equal(t, resource.RelUses, rels[1].Type)
	assert.Equal(t, "core::v1::ConfigMap", rels[1].TargetResourceKey)
}

func TestGetRelationships_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetRelationshipsFunc: func(_ context.Context, _ string) ([]resource.RelationshipDescriptor, error) {
			return nil, errors.New("relationships unavailable")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetRelationships("p1", "core::v1::Pod")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "relationships unavailable")
}

func TestGetRelationships_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetRelationships("nonexistent", "pods")
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// ResolveRelationships
// ============================================================================

func TestResolveRelationships_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ResolveRelationshipsFunc: func(_ context.Context, connID, key, id, ns string) ([]resource.ResolvedRelationship, error) {
			assert.Equal(t, "conn-1", connID)
			assert.Equal(t, "core::v1::Pod", key)
			assert.Equal(t, "my-pod", id)
			assert.Equal(t, "default", ns)
			return []resource.ResolvedRelationship{
				{
					Descriptor: resource.RelationshipDescriptor{
						Type:              resource.RelOwns,
						TargetResourceKey: "apps::v1::ReplicaSet",
						Label:             "owned by",
					},
					Targets: []resource.ResourceRef{
						{ID: "my-rs", Namespace: "default"},
					},
				},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	resolved, err := ctrl.ResolveRelationships("p1", "conn-1", "core::v1::Pod", "my-pod", "default")
	require.NoError(t, err)
	require.Len(t, resolved, 1)
	assert.Equal(t, resource.RelOwns, resolved[0].Descriptor.Type)
	assert.Equal(t, "apps::v1::ReplicaSet", resolved[0].Descriptor.TargetResourceKey)
	require.Len(t, resolved[0].Targets, 1)
	assert.Equal(t, "my-rs", resolved[0].Targets[0].ID)
	assert.Equal(t, "default", resolved[0].Targets[0].Namespace)
}

func TestResolveRelationships_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ResolveRelationshipsFunc: func(_ context.Context, _, _, _, _ string) ([]resource.ResolvedRelationship, error) {
			return nil, errors.New("resolve failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.ResolveRelationships("p1", "conn-1", "pods", "pod-1", "default")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "resolve failed")
}

func TestResolveRelationships_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.ResolveRelationships("nonexistent", "conn-1", "pods", "pod-1", "default")
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}
