package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ============================================================================
// GetRelationships
// ============================================================================

func TestGetRelationships_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("k8s:/pods", "k8s:apps/replicasets", "k8s:/configmaps"),
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
		CatalogFunc: lifecycleTestCatalog("k8s:/pods"),
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
		GetRelationshipsFunc: func(context.Context, resource.AccessRoute, string) ([]resource.RelationshipDescriptor, error) {
			return []resource.RelationshipDescriptor{{Type: resource.RelOwns, TargetType: "k8s:apps/replicasets", Label: "owned by"}}, nil
		},
		ResolveRelationshipsFunc: func(ctx context.Context, resolution resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
			request := resolution.Source
			require.Len(t, resolution.Targets, 1)
			target := resolution.Targets[0]
			sourceRevision, present := resource.CatalogRevisionFromContext(ctx)
			require.True(t, present)
			targetRevision, qualified := resource.QualifiedCatalogRevisionFromContext(ctx, target.Provider, target.Route)
			require.True(t, qualified, "target binding must carry its explicit admitted route observation")
			require.Equal(t, sourceRevision, targetRevision, "same-route targets share the one admitted complete catalog")
			assert.Equal(t, "k8s:apps/replicasets", target.Type)
			assert.NotEqual(t, request.Reference.Address.Authority, target.Authority)
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
							Provider: target.Provider, Authority: target.Authority,
							Type: target.Type, ID: "my-rs", Scope: request.Reference.Address.Scope,
						}},
					}},
				},
			}, nil
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock, "k8s:apps/replicasets")
	resolved, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Len(t, resolved, 1)
	assert.Equal(t, resource.RelOwns, resolved[0].Descriptor.Type)
	assert.Equal(t, "k8s:apps/replicasets", resolved[0].Descriptor.TargetType)
	require.Len(t, resolved[0].Targets, 1)
	assert.Equal(t, "my-rs", resolved[0].Targets[0].Reference.Address.ID)
	assert.Equal(t, request.Reference.Address.Scope, resolved[0].Targets[0].Reference.Address.Scope)
	assert.NotEqual(t, request.Reference.Address.Authority, resolved[0].Targets[0].Reference.Address.Authority)
	assert.Equal(t, request.Route, resolved[0].Targets[0].Route)
}

func TestResolveRelationships_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ResolveRelationshipsFunc: func(_ context.Context, _ resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
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
				ResolveRelationshipsFunc: func(context.Context, resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
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

func TestResolveRelationshipsDeniesCandidateBeforeProviderExtraction(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	invoked := false
	mock := relationshipBindingTestProvider(func(resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
		invoked = true
		return nil, nil
	})
	request := ancillaryPodRequest(t, ctrl, mock, "k8s:apps/replicasets")
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, _ string, target invocation.Target) error {
		if target.ResourceType == "k8s:apps/replicasets" {
			return errors.New("target denied")
		}
		return nil
	}))
	result, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
	assert.Nil(t, result)
	assert.False(t, invoked)
}

func TestResolveRelationshipsRejectsAnyDeniedOrForgedTargetWithoutPartialResults(t *testing.T) {
	for _, scenario := range []string{"exact target denied", "source authority copied", "foreign route"} {
		t.Run(scenario, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			mock := relationshipBindingTestProvider(func(request resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
				require.Len(t, request.Targets, 1)
				binding := request.Targets[0]
				valid := resource.RelationshipTarget{Route: binding.Route, Reference: resource.ResourceReference{Address: resource.ResourceAddress{
					Provider: binding.Provider, Authority: binding.Authority, Type: binding.Type,
					ID: "allowed", Scope: request.Source.Reference.Address.Scope,
				}}}
				invalid := valid
				invalid.Reference.Address.ID = "denied"
				switch scenario {
				case "source authority copied":
					invalid.Reference.Address.Authority = request.Source.Reference.Address.Authority
				case "foreign route":
					invalid.Route.Connection = "foreign/route"
				}
				return []resource.ResolvedRelationship{{Descriptor: resource.RelationshipDescriptor{Type: resource.RelOwns, TargetType: binding.Type}, Targets: []resource.RelationshipTarget{valid, invalid}}}, nil
			})
			request := ancillaryPodRequest(t, ctrl, mock, "k8s:apps/replicasets")
			ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, _ string, target invocation.Target) error {
				if target.Object == "denied" {
					return errors.New("exact object denied")
				}
				return nil
			}))
			result, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
			require.Error(t, err)
			assert.Nil(t, result)
			if scenario == "exact target denied" {
				assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
			}
		})
	}
}

func TestResolveRelationshipsRequiresDeclaredTargetDefaultRepresentation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	invoked := false
	mock := relationshipBindingTestProvider(func(resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
		invoked = true
		return nil, nil
	})
	request := ancillaryPodRequest(t, ctrl, mock, "k8s:apps/replicasets")
	catalogFunc := mock.CatalogFunc
	mock.CatalogFunc = func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
		catalog, err := catalogFunc(ctx, request)
		catalog.Types[1].DefaultRepresentation = ""
		return catalog, err
	}
	result, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", request)
	assert.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
	assert.Nil(t, result)
	assert.False(t, invoked)
}

func relationshipBindingTestProvider(resolve func(resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error)) *mockProvider {
	return &mockProvider{
		GetRelationshipsFunc: func(context.Context, resource.AccessRoute, string) ([]resource.RelationshipDescriptor, error) {
			return []resource.RelationshipDescriptor{{Type: resource.RelOwns, TargetType: "k8s:apps/replicasets"}}, nil
		},
		ResolveRelationshipsFunc: func(_ context.Context, request resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
			return resolve(request)
		},
	}
}
