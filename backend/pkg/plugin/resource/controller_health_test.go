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
// GetHealth
// ============================================================================

func TestGetHealth_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetHealthFunc: func(_ context.Context, connID, key string, data json.RawMessage) (*resource.ResourceHealth, error) {
			assert.Equal(t, "conn-1", connID)
			assert.Equal(t, "core::v1::Pod", key)
			assert.JSONEq(t, `{"name":"my-pod"}`, string(data))
			return &resource.ResourceHealth{
				Status:  resource.HealthHealthy,
				Reason:  "AllConditionsMet",
				Message: "Pod is running and healthy",
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	data := json.RawMessage(`{"name":"my-pod"}`)
	health, err := ctrl.GetHealth("p1", "conn-1", "core::v1::Pod", data)
	require.NoError(t, err)
	require.NotNil(t, health)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "AllConditionsMet", health.Reason)
	assert.Equal(t, "Pod is running and healthy", health.Message)
}

func TestGetHealth_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetHealthFunc: func(_ context.Context, _, _ string, _ json.RawMessage) (*resource.ResourceHealth, error) {
			return nil, errors.New("health check failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	health, err := ctrl.GetHealth("p1", "conn-1", "core::v1::Pod", nil)
	assert.Error(t, err)
	assert.Nil(t, health)
	assert.Contains(t, err.Error(), "health check failed")
}

func TestGetHealth_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	health, err := ctrl.GetHealth("nonexistent", "conn-1", "pods", nil)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Nil(t, health)
}

// ============================================================================
// GetResourceEvents
// ============================================================================

func TestGetResourceEvents_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetResourceEventsFunc: func(_ context.Context, connID, key, id, ns string, limit int32) ([]resource.ResourceEvent, error) {
			assert.Equal(t, "conn-1", connID)
			assert.Equal(t, "core::v1::Pod", key)
			assert.Equal(t, "my-pod", id)
			assert.Equal(t, "default", ns)
			assert.Equal(t, int32(10), limit)
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
	registerMockPlugin(ctrl, "p1", mock)

	events, err := ctrl.GetResourceEvents("p1", "conn-1", "core::v1::Pod", "my-pod", "default", 10)
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
		GetResourceEventsFunc: func(_ context.Context, _, _, _, _ string, _ int32) ([]resource.ResourceEvent, error) {
			return nil, errors.New("events unavailable")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetResourceEvents("p1", "conn-1", "core::v1::Pod", "my-pod", "default", 10)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "events unavailable")
}

func TestGetResourceEvents_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetResourceEvents("nonexistent", "conn-1", "pods", "pod-1", "default", 10)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}
