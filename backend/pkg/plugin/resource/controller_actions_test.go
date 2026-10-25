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

	actions, err := ctrl.GetActions(testInvocationContext(), "p1", "conn-1", "pods")
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

	_, err := ctrl.GetActions(testInvocationContext(), "p1", "conn-1", "pods")
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestGetActions_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetActions(testInvocationContext(), "nonexistent", "conn-1", "pods")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// ExecuteAction
// ============================================================================

func TestExecuteAction_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ExecuteActionFunc: func(
			_ context.Context,
			key, actionID string,
			_ resource.ActionInput,
		) (*resource.ActionResult, error) {
			assert.Equal(t, "pods", key)
			assert.Equal(t, "restart", actionID)
			return &resource.ActionResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.ExecuteAction(testInvocationContext(), "p1", "conn-1", "pods", "restart", resource.ActionInput{})
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

	_, err := ctrl.ExecuteAction(testInvocationContext(), "p1", "conn-1", "pods", "restart", resource.ActionInput{})
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestExecuteAction_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.ExecuteAction(testInvocationContext(), "nonexistent", "conn-1", "pods", "restart", resource.ActionInput{})
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// StreamAction
// ============================================================================

func TestStreamAction_OpaqueHandleRequiresProviderReady(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _, _ string, _ resource.ActionInput, ch chan<- resource.ActionEvent) error {
		ch <- resource.ActionEvent{Type: "ready"}
		<-ctx.Done()
		return ctx.Err()
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", "conn-1", "opaque", "restart", resource.ActionInput{ID: "private-object"})
	require.NoError(t, err)
	assert.NotEmpty(t, id)
	assert.NotContains(t, id, "private-object")
	assert.NotContains(t, id, "restart")
	require.NoError(t, ctrl.CancelStreamAction(testInvocationContext(), id))
	assert.Equal(t, 0, actionCount(ctrl.actions))
}

func TestStreamAction_MissingReadyFailsWithoutHandle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(context.Context, string, string, resource.ActionInput, chan<- resource.ActionEvent) error {
		return nil
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", "conn-1", "opaque", "restart", resource.ActionInput{})
	require.Error(t, err)
	assert.Empty(t, id)
	assert.Equal(t, 0, actionCount(ctrl.actions))
}

func TestStreamAction_EmitsOrderedSnapshotsOnlyAfterAttach(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	release := make(chan struct{})
	registerMockPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _, _ string, _ resource.ActionInput, ch chan<- resource.ActionEvent) error {
		ch <- resource.ActionEvent{Type: "ready"}
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		ch <- resource.ActionEvent{Type: "progress", Data: map[string]any{"pct": 50}}
		ch <- resource.ActionEvent{Type: "complete", Data: map[string]any{"pct": 100}}
		return nil
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", "conn-1", "opaque", "restart", resource.ActionInput{})
	require.NoError(t, err)
	assert.Empty(t, emitter.EventsWithKey("action/stream/"+id))
	first, err := ctrl.AttachStreamAction(testInvocationContext(), id)
	require.NoError(t, err)
	assert.Equal(t, uint64(1), first.Sequence)
	close(release)
	events := emitter.WaitForNEvents(t, "action/stream/"+id, 2, 2*time.Second)
	progress := events[0].Data[0].(ActionSnapshot)
	complete := events[1].Data[0].(ActionSnapshot)
	assert.Equal(t, "progress", progress.Event.Type)
	assert.Equal(t, "complete", complete.Event.Type)
	assert.Greater(t, complete.Sequence, progress.Sequence)
	assert.True(t, complete.Terminal)
}

func TestStreamAction_NormalizesTerminalFailureAfterReady(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	release := make(chan struct{})
	registerMockPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _, _ string, _ resource.ActionInput, ch chan<- resource.ActionEvent) error {
		ch <- resource.ActionEvent{Type: "ready"}
		select {
		case <-release:
			return errors.New("secret-provider-diagnostic")
		case <-ctx.Done():
			return ctx.Err()
		}
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", "conn-1", "opaque", "restart", resource.ActionInput{})
	require.NoError(t, err)
	_, err = ctrl.AttachStreamAction(testInvocationContext(), id)
	require.NoError(t, err)
	close(release)
	event := emitter.WaitForEvent(t, "action/stream/"+id, 2*time.Second).Data[0].(ActionSnapshot)
	require.NotNil(t, event.Event.Error)
	assert.Equal(t, "PROVIDER_ERROR", event.Event.Error.Code)
	assert.False(t, strings.Contains(event.Event.Error.Error(), "secret"))
	assert.True(t, event.Terminal)
}

func TestStreamAction_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.StreamAction(testInvocationContext(), "nonexistent", "conn-1", "opaque", "restart", resource.ActionInput{})
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}
