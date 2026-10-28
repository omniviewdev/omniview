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
// GetHealth
// ============================================================================

func TestGetHealth_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetHealthFunc: func(_ context.Context, request resource.GetRequest, data resource.Value) (*resource.ResourceHealth, error) {
			assert.Equal(t, "conn-1", request.Route.Connection)
			assert.Equal(t, "k8s:/pods", request.Reference.Address.Type)
			assert.Equal(t, "my-pod", data.Map["name"].String)
			return &resource.ResourceHealth{
				Status:  resource.HealthHealthy,
				Reason:  "AllConditionsMet",
				Message: "Pod is running and healthy",
			}, nil
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock)
	data := resource.Value{Kind: "map", Map: map[string]resource.Value{"name": {Kind: "string", String: "my-pod"}}}
	health, err := ctrl.GetHealth(testInvocationContext(), "p1", request, data)
	require.NoError(t, err)
	require.NotNil(t, health)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "AllConditionsMet", health.Reason)
	assert.Equal(t, "Pod is running and healthy", health.Message)
}

func TestGetHealth_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetHealthFunc: func(_ context.Context, _ resource.GetRequest, _ resource.Value) (*resource.ResourceHealth, error) {
			return nil, errors.New("health check failed")
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock)
	health, err := ctrl.GetHealth(testInvocationContext(), "p1", request, resource.Value{Kind: "null"})
	require.Error(t, err)
	assert.Nil(t, health)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestGetHealth_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	health, err := ctrl.GetHealth(testInvocationContext(), "nonexistent", resource.GetRequest{Route: resource.AccessRoute{Connection: "conn-1"}, Reference: actionTestRequest("nonexistent", "pods", "").Reference, Representation: "native"}, resource.Value{Kind: "null"})
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Nil(t, health)
}

// ============================================================================
// GetResourceEvents
// ============================================================================

func TestGetResourceEvents_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceEventsFunc: func(_ context.Context, request resource.GetRequest, limit uint32) ([]resource.ResourceEvent, error) {
			assert.Equal(t, "conn-1", request.Route.Connection)
			assert.Equal(t, "k8s:/pods", request.Reference.Address.Type)
			assert.Equal(t, "my-pod", request.Reference.Address.ID)
			assert.Equal(t, []resource.ScopeEntry{{Dimension: "namespace", Value: "default"}}, request.Reference.Address.Scope)
			assert.Equal(t, uint32(10), limit)
			return []resource.ResourceEvent{
				{
					Type:    resource.SeverityNormal,
					Reason:  "Scheduled",
					Message: "Successfully assigned default/my-pod to node-1",
					Source:  "default-scheduler",
				},
				{
					Type:    resource.SeverityWarning,
					Reason:  "Unhealthy",
					Message: "Readiness probe failed",
					Source:  "kubelet",
					Count:   3,
				},
			}, nil
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock)
	events, err := ctrl.GetResourceEvents(testInvocationContext(), "p1", request, 10)
	require.NoError(t, err)
	require.Len(t, events, 2)

	assert.Equal(t, resource.SeverityNormal, events[0].Type)
	assert.Equal(t, "Scheduled", events[0].Reason)
	assert.Equal(t, "Successfully assigned default/my-pod to node-1", events[0].Message)
	assert.Equal(t, "default-scheduler", events[0].Source)

	assert.Equal(t, resource.SeverityWarning, events[1].Type)
	assert.Equal(t, "Unhealthy", events[1].Reason)
	assert.Equal(t, int32(3), events[1].Count)
}

func TestGetResourceEvents_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceEventsFunc: func(_ context.Context, _ resource.GetRequest, _ uint32) ([]resource.ResourceEvent, error) {
			return nil, errors.New("events unavailable")
		},
	}
	request := ancillaryPodRequest(t, ctrl, mock)
	_, err := ctrl.GetResourceEvents(testInvocationContext(), "p1", request, 10)
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestGetResourceEvents_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetResourceEvents(testInvocationContext(), "nonexistent", resource.GetRequest{Route: resource.AccessRoute{Connection: "conn-1"}, Reference: actionTestRequest("nonexistent", "pods", "").Reference, Representation: "native"}, 10)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func ancillaryPodRequest(t *testing.T, ctrl *controller, mock *mockProvider, targetTypes ...string) resource.GetRequest {
	t.Helper()
	mock.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "k8s:/pods")
		catalog.Types[0].IdentityDimensions = []resource.Dimension{{Name: "namespace"}}
		catalog.Types[0].QueryDimensions = []resource.Dimension{{Name: "namespace"}}
		for i := range catalog.Types[0].Capabilities {
			catalog.Types[0].Capabilities[i].Scope = resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeAny}}
		}
		for _, targetType := range targetTypes {
			target := canonicalTestCatalog("p1", targetType).Types[0]
			target.IdentityDimensions = []resource.Dimension{{Name: "namespace"}}
			target.QueryDimensions = []resource.Dimension{{Name: "namespace"}}
			for i := range target.Capabilities {
				target.Capabilities[i].Scope = resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeAny}}
			}
			target.DefaultRepresentation = canonicalTestRepresentation().ID
			catalog.Types = append(catalog.Types, target)
		}
		return catalog, nil
	}
	registerMockPlugin(ctrl, "p1", mock)
	resolved, err := ctrl.ResolveTarget(testInvocationContext(), "p1", ResolveTargetRequest{
		Route: resource.AccessRoute{Connection: "conn-1"}, Type: "k8s:/pods", Representation: "native",
		Scope: resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeAny}},
	})
	require.NoError(t, err)
	request := resource.GetRequest{Route: resolved.Target.Route, Representation: resolved.Target.Representation,
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{
			Provider: resolved.Target.Provider, Authority: resolved.Target.Authority, Type: resolved.Target.Type, ID: "my-pod",
			Scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "default"}},
		}},
	}
	return request
}

func TestHealthAncillaryPreservesTypedUnsupportedAndCancellation(t *testing.T) {
	for _, failure := range []struct {
		name string
		err  error
		code string
	}{
		{"unsupported", resource.NewError("UNSUPPORTED", "Health is unavailable."), "UNSUPPORTED"},
		{"canceled", context.Canceled, "CANCELLED"},
	} {
		t.Run(failure.name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			mock := &mockProvider{
				GetHealthFunc: func(context.Context, resource.GetRequest, resource.Value) (*resource.ResourceHealth, error) {
					return nil, failure.err
				},
				GetResourceEventsFunc: func(context.Context, resource.GetRequest, uint32) ([]resource.ResourceEvent, error) {
					return nil, failure.err
				},
			}
			request := ancillaryPodRequest(t, ctrl, mock)
			health, err := ctrl.GetHealth(testInvocationContext(), "p1", request, resource.Value{Kind: "null"})
			assert.Nil(t, health)
			assert.Equal(t, failure.code, requireAppError(t, err).Code)
			events, err := ctrl.GetResourceEvents(testInvocationContext(), "p1", request, 10)
			assert.Nil(t, events)
			assert.Equal(t, failure.code, requireAppError(t, err).Code)
		})
	}
}
