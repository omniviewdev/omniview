package exec

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/plugin-sdk/pkg/exec"
)

// newTestController builds a minimal exec controller for apperror tests.
// No plugins are registered, so every lookup must fail with a structured error.
func newTestController() Controller {
	return NewController(zap.NewNop().Sugar(), nil, nil)
}

// ---------- CreateSession ----------

func TestCreateSession_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.CreateSession("nonexistent", "conn", exec.SessionOptions{})

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

// ---------- AttachSession ----------

func TestAttachSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, _, err := ctrl.AttachSession("nonexistent-session")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}

// ---------- DetachSession ----------

func TestDetachSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.DetachSession("nonexistent-session")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}

// ---------- WriteSession ----------

func TestWriteSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	err := ctrl.WriteSession("nonexistent-session", nil)

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

// ---------- ResizeSession ----------

func TestResizeSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	err := ctrl.ResizeSession("nonexistent-session", 24, 80)

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}
