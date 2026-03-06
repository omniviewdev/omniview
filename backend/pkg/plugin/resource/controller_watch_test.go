package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ============================================================================
// StartConnectionWatch
// ============================================================================

func TestStartConnectionWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionWatchFunc: func(_ context.Context, connID string) error {
			assert.Equal(t, "conn-1", connID)
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.StartConnectionWatch("p1", "conn-1")
	require.NoError(t, err)
}

func TestStartConnectionWatch_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionWatchFunc: func(_ context.Context, _ string) error {
			return errors.New("watch start failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.StartConnectionWatch("p1", "conn-1")
	assert.Error(t, err)
}

// ============================================================================
// StopConnectionWatch
// ============================================================================

func TestStopConnectionWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.StopConnectionWatch("p1", "conn-1")
	require.NoError(t, err)
}

func TestStopConnectionWatch_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StopConnectionWatchFunc: func(_ context.Context, _ string) error {
			return errors.New("stop failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.StopConnectionWatch("p1", "conn-1")
	assert.Error(t, err)
}

// ============================================================================
// GetWatchState
// ============================================================================

func TestGetWatchState_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetWatchStateFunc: func(_ context.Context, connID string) (*resource.WatchConnectionSummary, error) {
			return &resource.WatchConnectionSummary{
				ConnectionID: connID,
				Resources:    map[string]resource.WatchState{"pods": resource.WatchStateSynced},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	ws, err := ctrl.GetWatchState("p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", ws.ConnectionID)
	assert.Equal(t, resource.WatchStateSynced, ws.Resources["pods"])
}

func TestGetWatchState_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetWatchStateFunc: func(_ context.Context, _ string) (*resource.WatchConnectionSummary, error) {
			return nil, errors.New("state error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetWatchState("p1", "conn-1")
	assert.Error(t, err)
}

// ============================================================================
// EnsureResourceWatch
// ============================================================================

func TestEnsureResourceWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.EnsureResourceWatch("p1", "conn-1", "pods")
	require.NoError(t, err)
}

func TestEnsureResourceWatch_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		EnsureResourceWatchFunc: func(_ context.Context, _, _ string) error {
			return errors.New("ensure failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.EnsureResourceWatch("p1", "conn-1", "pods")
	assert.Error(t, err)
}

// ============================================================================
// StopResourceWatch
// ============================================================================

func TestStopResourceWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.StopResourceWatch("p1", "conn-1", "pods")
	require.NoError(t, err)
}

// ============================================================================
// RestartResourceWatch
// ============================================================================

func TestRestartResourceWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.RestartResourceWatch("p1", "conn-1", "pods")
	require.NoError(t, err)
}

// ============================================================================
// IsResourceWatchRunning
// ============================================================================

func TestIsResourceWatchRunning_True(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		IsResourceWatchRunningFunc: func(_ context.Context, _, _ string) (bool, error) {
			return true, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	running, err := ctrl.IsResourceWatchRunning("p1", "conn-1", "pods")
	require.NoError(t, err)
	assert.True(t, running)
}

func TestIsResourceWatchRunning_False(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	running, err := ctrl.IsResourceWatchRunning("p1", "conn-1", "pods")
	require.NoError(t, err)
	assert.False(t, running)
}

func TestIsResourceWatchRunning_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		IsResourceWatchRunningFunc: func(_ context.Context, _, _ string) (bool, error) {
			return false, errors.New("check failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	running, err := ctrl.IsResourceWatchRunning("p1", "conn-1", "pods")
	assert.Error(t, err)
	assert.False(t, running)
}
