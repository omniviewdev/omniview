package logs

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/plugin-sdk/pkg/logs"
)

// newTestController builds a minimal logs controller for apperror tests.
// No plugins are registered, so every lookup must fail with a structured error.
func newTestController() Controller {
	ctrl := NewController(zap.NewNop().Sugar(), nil, nil)
	ctrl.Run(context.Background())
	return ctrl
}

// ---------- CreateSession ----------

func TestCreateSession_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.CreateSession("nonexistent", "conn", logs.CreateSessionOptions{})

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypePluginNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent")
}

// ---------- GetSession ----------

func TestGetSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetSession("nonexistent-session")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}

// ---------- CloseSession ----------

func TestCloseSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	err := ctrl.CloseSession("nonexistent-session")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}

// ---------- SendCommand ----------

func TestSendCommand_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	err := ctrl.SendCommand("nonexistent-session", logs.StreamCommandPause)

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}

// ---------- UpdateSessionOptions ----------

func TestUpdateSessionOptions_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.UpdateSessionOptions("nonexistent-session", logs.LogSessionOptions{})

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}
