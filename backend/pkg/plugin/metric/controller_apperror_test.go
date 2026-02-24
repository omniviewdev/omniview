package metric

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/plugin-sdk/pkg/metric"
)

func newTestController() Controller {
	return NewController(zap.NewNop().Sugar(), nil, nil)
}

func TestQuery_PluginNotFound(t *testing.T) {
	c := newTestController()

	_, err := c.Query("nonexistent", "conn", metric.QueryRequest{})
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}

func TestSubscribe_PluginNotFound(t *testing.T) {
	c := newTestController()

	_, err := c.Subscribe("nonexistent", "conn", SubscribeRequest{})
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent")
}

func TestUnsubscribe_SessionNotFound(t *testing.T) {
	c := newTestController()

	err := c.Unsubscribe("nonexistent-sub")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeSessionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "nonexistent-sub")
}
