package settings

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func newTestController() Controller {
	return NewController(logging.NewNop(), nil)
}

func TestSnapshot_PluginNotFound(t *testing.T) {
	c := newTestController()

	_, err := c.Snapshot("nonexistent")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}

func TestCommitSettings_PluginNotFound(t *testing.T) {
	c := newTestController()

	_, err := c.CommitSettings(context.Background(), "nonexistent", map[string]any{"foo": "bar"}, nil)
	require.Error(t, err)

	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}
