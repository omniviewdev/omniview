package resource

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ============================================================================
// GetActions
// ============================================================================

func TestGetActions_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetActionsFunc: func(_ context.Context, key string) ([]resource.ActionDescriptor, error) {
			assert.Equal(t, "pods", key)
			return []resource.ActionDescriptor{
				{ID: "restart", Label: "Restart Pod"},
				{ID: "delete", Label: "Delete Pod"},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	actions, err := ctrl.GetActions("p1", "conn-1", "pods")
	require.NoError(t, err)
	require.Len(t, actions, 2)
	assert.Equal(t, "restart", actions[0].ID)
	assert.Equal(t, "Restart Pod", actions[0].Label)
	assert.Equal(t, "delete", actions[1].ID)
}

func TestGetActions_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetActionsFunc: func(_ context.Context, _ string) ([]resource.ActionDescriptor, error) {
			return nil, errors.New("actions unavailable")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetActions("p1", "conn-1", "pods")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "actions unavailable")
}

func TestGetActions_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetActions("nonexistent", "conn-1", "pods")
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// ExecuteAction
// ============================================================================

func TestExecuteAction_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ExecuteActionFunc: func(_ context.Context, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error) {
			assert.Equal(t, "pods", key)
			assert.Equal(t, "restart", actionID)
			return &resource.ActionResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.ExecuteAction("p1", "conn-1", "pods", "restart", resource.ActionInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestExecuteAction_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ExecuteActionFunc: func(_ context.Context, _, _ string, _ resource.ActionInput) (*resource.ActionResult, error) {
			return nil, errors.New("action failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.ExecuteAction("p1", "conn-1", "pods", "restart", resource.ActionInput{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "action failed")
}

func TestExecuteAction_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.ExecuteAction("nonexistent", "conn-1", "pods", "restart", resource.ActionInput{})
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// StreamAction
// ============================================================================

func TestStreamAction_ReturnsOperationID(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StreamActionFunc: func(_ context.Context, _, _ string, _ resource.ActionInput, stream chan<- resource.ActionEvent) error {
			close(stream)
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	opID, err := ctrl.StreamAction("p1", "conn-1", "pods", "restart", resource.ActionInput{ID: "req-1"})
	require.NoError(t, err)
	assert.NotEmpty(t, opID)
	assert.True(t, strings.HasPrefix(opID, "op_restart_req-1_"),
		"expected operation ID prefix 'op_restart_req-1_', got %s", opID)
}

func TestStreamAction_EmitsEvents(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StreamActionFunc: func(_ context.Context, _, _ string, _ resource.ActionInput, stream chan<- resource.ActionEvent) error {
			stream <- resource.ActionEvent{Type: "progress", Data: map[string]interface{}{"pct": 50}}
			stream <- resource.ActionEvent{Type: "complete", Data: map[string]interface{}{"pct": 100}}
			close(stream)
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	opID, err := ctrl.StreamAction("p1", "conn-1", "pods", "restart", resource.ActionInput{ID: "r1"})
	require.NoError(t, err)

	// Wait for both events to be emitted.
	events := emitter.WaitForNEvents(t, "action/stream/"+opID, 2, 2*time.Second)
	assert.Len(t, events, 2)

	// Verify event types in order.
	ev0, ok := events[0].Data.(resource.ActionEvent)
	require.True(t, ok)
	assert.Equal(t, "progress", ev0.Type)

	ev1, ok := events[1].Data.(resource.ActionEvent)
	require.True(t, ok)
	assert.Equal(t, "complete", ev1.Type)
}

func TestStreamAction_EmitsError(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StreamActionFunc: func(_ context.Context, _, _ string, _ resource.ActionInput, stream chan<- resource.ActionEvent) error {
			close(stream)
			return errors.New("stream broke")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	opID, err := ctrl.StreamAction("p1", "conn-1", "pods", "restart", resource.ActionInput{ID: "r1"})
	require.NoError(t, err)

	// Wait for the error event.
	ev := emitter.WaitForEvent(t, "action/stream/"+opID, 2*time.Second)
	actionEv, ok := ev.Data.(resource.ActionEvent)
	require.True(t, ok)
	assert.Equal(t, "error", actionEv.Type)
	assert.Contains(t, actionEv.Data["message"], "stream broke")
}

func TestStreamAction_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.StreamAction("nonexistent", "conn-1", "pods", "restart", resource.ActionInput{})
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func TestStreamAction_ChannelDrained(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	eventCount := 5
	mock := &mockProvider{
		StreamActionFunc: func(_ context.Context, _, _ string, _ resource.ActionInput, stream chan<- resource.ActionEvent) error {
			for i := 0; i < eventCount; i++ {
				stream <- resource.ActionEvent{Type: "progress", Data: map[string]interface{}{"i": i}}
			}
			close(stream)
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	opID, err := ctrl.StreamAction("p1", "conn-1", "pods", "restart", resource.ActionInput{ID: "r1"})
	require.NoError(t, err)

	events := emitter.WaitForNEvents(t, "action/stream/"+opID, eventCount, 2*time.Second)
	assert.Len(t, events, eventCount, "all events should be drained from channel")
}

func TestStreamAction_OperationIDFormat(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StreamActionFunc: func(_ context.Context, _, _ string, _ resource.ActionInput, stream chan<- resource.ActionEvent) error {
			close(stream)
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	opID, err := ctrl.StreamAction("p1", "conn-1", "pods", "scale", resource.ActionInput{ID: "input-42"})
	require.NoError(t, err)

	// Format: op_{actionID}_{inputID}_{timestamp}
	parts := strings.SplitN(opID, "_", 4)
	require.Len(t, parts, 4, "operation ID should have 4 parts separated by underscore")
	assert.Equal(t, "op", parts[0])
	assert.Equal(t, "scale", parts[1])
	assert.Equal(t, "input-42", parts[2])
	assert.NotEmpty(t, parts[3], "timestamp part should be non-empty")
}
