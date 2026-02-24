package diagnostics

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

func newTestClient() *DiagnosticsClient {
	return &DiagnosticsClient{UI: nil}
}

func TestReadLog_App_NotImplemented(t *testing.T) {
	c := newTestClient()

	_, err := c.ReadLog("app")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeNotImplemented, appErr.Type)
	assert.Equal(t, 501, appErr.Status)
}

func TestReadLog_Unknown_Validation(t *testing.T) {
	c := newTestClient()

	_, err := c.ReadLog("unknown")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Detail, "unknown")
}

func TestStartTail_App_NotImplemented(t *testing.T) {
	c := newTestClient()

	err := c.StartTail("app")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeNotImplemented, appErr.Type)
	assert.Equal(t, 501, appErr.Status)
}

func TestStartTail_Unknown_Validation(t *testing.T) {
	c := newTestClient()

	err := c.StartTail("unknown")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Detail, "unknown")
}

func TestStopTail_App_NotImplemented(t *testing.T) {
	c := newTestClient()

	err := c.StopTail("app")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeNotImplemented, appErr.Type)
	assert.Equal(t, 501, appErr.Status)
}

func TestStopTail_Unknown_Validation(t *testing.T) {
	c := newTestClient()

	err := c.StopTail("unknown")
	require.Error(t, err)

	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Detail, "unknown")
}
