package networker

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/plugin-sdk/pkg/networker"
)

// newTestController builds a minimal networker controller for apperror tests.
// No plugins are registered, so every lookup must fail with a structured error.
func newTestController() Controller {
	return NewController(zap.NewNop().Sugar(), nil, nil)
}

// ---------- GetPortForwardSession ----------

func TestGetPortForwardSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetPortForwardSession("nonexistent-session")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}

// ---------- ListPortForwardSessions ----------

func TestListPortForwardSessions_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.ListPortForwardSessions("nonexistent", "conn")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypePluginNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent")
}

// ---------- FindPortForwardSessions ----------

func TestFindPortForwardSessions_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.FindPortForwardSessions("nonexistent", "conn", networker.FindPortForwardSessionRequest{})

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypePluginNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent")
}

// ---------- StartResourcePortForwardingSession ----------

func TestStartResourcePortForwardingSession_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.StartResourcePortForwardingSession("nonexistent", "conn", networker.PortForwardSessionOptions{})

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypePluginNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent")
}

// ---------- ClosePortForwardSession ----------

func TestClosePortForwardSession_SessionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.ClosePortForwardSession("nonexistent-session")

	require.Error(t, err)
	var target *apperror.AppError
	require.True(t, errors.As(err, &target))
	assert.Equal(t, apperror.TypeSessionNotFound, target.Type)
	assert.Equal(t, 404, target.Status)
	assert.Contains(t, target.Detail, "nonexistent-session")
}
