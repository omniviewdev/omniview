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

// ============================================================================
// GetRelationships
// ============================================================================

func TestGetRelationships_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetRelationshipsFunc: func(_ context.Context, route resource.AccessRoute, key string) ([]resource.RelationshipDescriptor, error) {
			assert.Equal(t, "conn-1", route.Connection)
			assert.Equal(t, "k8s:/pods", key)
			return []resource.RelationshipDescriptor{
				{
					Type:       resource.RelOwns,
					TargetType: "k8s:apps/replicasets",
					Label:      "owned by",
				},
				{
					Type:       resource.RelUses,
					TargetType: "k8s:/configmaps",
					Label:      "uses",
				},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	rels, err := ctrl.GetRelationships(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "k8s:/pods")
	require.NoError(t, err)
	require.Len(t, rels, 2)
	assert.Equal(t, resource.RelOwns, rels[0].Type)
	assert.Equal(t, "k8s:apps/replicasets", rels[0].TargetType)
	assert.Equal(t, "owned by", rels[0].Label)
	assert.Equal(t, resource.RelUses, rels[1].Type)
	assert.Equal(t, "k8s:/configmaps", rels[1].TargetType)
}

func TestGetRelationships_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetRelationshipsFunc: func(_ context.Context, _ resource.AccessRoute, _ string) ([]resource.RelationshipDescriptor, error) {
			return nil, errors.New("relationships unavailable")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetRelationships(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "k8s:/pods")
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestGetRelationships_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetRelationships(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn-1"}, "pods")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// ResolveRelationships
// ============================================================================

func TestResolveRelationships_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ResolveRelationshipsFunc: func(_ context.Context, request resource.GetRequest) ([]resource.ResolvedRelationship, error) {
			assert.Equal(t, "conn-1", request.Route.Connection)
			assert.Equal(t, "k8s:/pods", request.Reference.Address.Type)
			assert.Equal(t, "my-pod", request.Reference.Address.ID)
			assert.Equal(t, []resource.ScopeEntry{{Dimension: "namespace", Value: "default"}}, request.Reference.Address.Scope)
			return []resource.ResolvedRelationship{
				{
					Descriptor: resource.RelationshipDescriptor{
						Type:       resource.RelOwns,
						TargetType: "k8s:apps/replicasets",
						Label:      "owned by",
					},
					Targets: []resource.RelationshipTarget{{
						Route: request.Route,
						Reference: resource.ResourceReference{Address: resource.ResourceAddress{
							Provider: request.Reference.Address.Provider, Authority: request.Reference.Address.Authority,
							Type: "k8s:apps/replicasets", ID: "my-rs", Scope: request.Reference.Address.Scope,
						}},
					}},
				},
			}, nil
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock)
	resolved, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Len(t, resolved, 1)
	assert.Equal(t, resource.RelOwns, resolved[0].Descriptor.Type)
	assert.Equal(t, "k8s:apps/replicasets", resolved[0].Descriptor.TargetType)
	require.Len(t, resolved[0].Targets, 1)
	assert.Equal(t, "my-rs", resolved[0].Targets[0].Reference.Address.ID)
	assert.Equal(t, request.Reference.Address.Scope, resolved[0].Targets[0].Reference.Address.Scope)
	assert.Equal(t, request.Reference.Address.Authority, resolved[0].Targets[0].Reference.Address.Authority)
	assert.Equal(t, request.Route, resolved[0].Targets[0].Route)
}

func TestResolveRelationships_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ResolveRelationshipsFunc: func(_ context.Context, _ resource.GetRequest) ([]resource.ResolvedRelationship, error) {
			return nil, errors.New("resolve failed")
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock)
	_, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestResolveRelationships_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.ResolveRelationships(testInvocationContext(), "nonexistent", resource.GetRequest{Route: resource.AccessRoute{Connection: "conn-1"}, Reference: actionTestRequest("nonexistent", "pods", "").Reference, Representation: "native"})
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestRelationshipAncillaryPreservesTypedUnsupportedAndCancellation(t *testing.T) {
	for _, failure := range []struct {
		name string
		err  error
		code string
	}{
		{"unsupported", resource.NewError("UNSUPPORTED", "Relationships are unavailable."), "UNSUPPORTED"},
		{"canceled", context.Canceled, "CANCELLED"},
	} {
		t.Run(failure.name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			mock := &mockProvider{
				GetRelationshipsFunc: func(context.Context, resource.AccessRoute, string) ([]resource.RelationshipDescriptor, error) {
					return nil, failure.err
				},
				ResolveRelationshipsFunc: func(context.Context, resource.GetRequest) ([]resource.ResolvedRelationship, error) {
					return nil, failure.err
				},
			}
			request := ancillaryPodRequest(t, ctrl, mock)
			descriptors, err := ctrl.GetRelationships(testInvocationContext(), "p1", request.Route, request.Reference.Address.Type)
			assert.Nil(t, descriptors)
			assert.Equal(t, failure.code, requireAppError(t, err).Code)
			resolved, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
			assert.Nil(t, resolved)
			assert.Equal(t, failure.code, requireAppError(t, err).Code)
		})
	}
}
