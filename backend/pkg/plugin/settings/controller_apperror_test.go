package settings

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

func newTestController() Controller {
	return NewController(zap.NewNop().Sugar(), nil)
}

func TestGetSetting_PluginNotFound(t *testing.T) {
	c := newTestController()

	_, err := c.GetSetting("nonexistent", "foo")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}

func TestSetSetting_PluginNotFound(t *testing.T) {
	c := newTestController()

	err := c.SetSetting("nonexistent", "foo", "bar")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}

func TestSetSettings_PluginNotFound(t *testing.T) {
	c := newTestController()

	err := c.SetSettings("nonexistent", map[string]any{"foo": "bar"})
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}
