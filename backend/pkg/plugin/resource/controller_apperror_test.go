package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// newTestController creates a controller with a no-op logger and no settings
// provider, then calls Run so the context is initialised.
func newTestController() *controller {
	ctrl := NewController(zap.NewNop().Sugar(), nil).(*controller)
	ctrl.Run(context.Background())
	return ctrl
}

// requireAppError is a test helper that asserts err is a non-nil *apperror.AppError
// and returns it for further assertions.
func requireAppError(t *testing.T, err error) *apperror.AppError {
	t.Helper()
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr), "expected *apperror.AppError, got %T: %v", err, err)
	return appErr
}

// ======================== PluginNotFound tests ======================== //

func TestStartConnection_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.StartConnection("nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestStopConnection_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.StopConnection("nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestLoadConnections_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.LoadConnections("nonexistent")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetConnectionNamespaces_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetConnectionNamespaces("nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGet_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.Get("nonexistent", "conn", "key", resourcetypes.GetInput{})
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetResourceGroup_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetResourceGroup("nonexistent", "group")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetResourceType_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetResourceType("nonexistent", "type")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetLayout_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetLayout("nonexistent", "layout")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetDefaultLayout_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetDefaultLayout("nonexistent")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// TestCRUDMethods_PluginNotFound verifies that all CRUD methods (List, Find,
// Create, Update, Delete) return a PluginNotFound AppError when invoked with a
// non-existent plugin ID. These all go through getClientConnection.
func TestCRUDMethods_PluginNotFound(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "List",
			fn: func() error {
				_, err := ctrl.List("nonexistent", "conn", "key", resourcetypes.ListInput{})
				return err
			},
		},
		{
			name: "Find",
			fn: func() error {
				_, err := ctrl.Find("nonexistent", "conn", "key", resourcetypes.FindInput{})
				return err
			},
		},
		{
			name: "Create",
			fn: func() error {
				_, err := ctrl.Create("nonexistent", "conn", "key", resourcetypes.CreateInput{})
				return err
			},
		},
		{
			name: "Update",
			fn: func() error {
				_, err := ctrl.Update("nonexistent", "conn", "key", resourcetypes.UpdateInput{})
				return err
			},
		},
		{
			name: "Delete",
			fn: func() error {
				_, err := ctrl.Delete("nonexistent", "conn", "key", resourcetypes.DeleteInput{})
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appErr := requireAppError(t, tt.fn())
			assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
			assert.Equal(t, 404, appErr.Status)
		})
	}
}

// TestAdditionalMethods_PluginNotFound verifies remaining methods that check
// for a plugin client via c.clients or getClientConnection.
func TestAdditionalMethods_PluginNotFound(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "StartConnectionInformer",
			fn: func() error {
				return ctrl.StartConnectionInformer("nonexistent", "conn")
			},
		},
		{
			name: "StopConnectionInformer",
			fn: func() error {
				return ctrl.StopConnectionInformer("nonexistent", "conn")
			},
		},
		{
			name: "GetEditorSchemas",
			fn: func() error {
				_, err := ctrl.GetEditorSchemas("nonexistent", "conn")
				return err
			},
		},
		{
			name: "GetActions",
			fn: func() error {
				_, err := ctrl.GetActions("nonexistent", "conn", "key")
				return err
			},
		},
		{
			name: "ExecuteAction",
			fn: func() error {
				_, err := ctrl.ExecuteAction("nonexistent", "conn", "key", "action", resourcetypes.ActionInput{})
				return err
			},
		},
		{
			name: "GetInformerState",
			fn: func() error {
				_, err := ctrl.GetInformerState("nonexistent", "conn")
				return err
			},
		},
		{
			name: "EnsureInformerForResource",
			fn: func() error {
				return ctrl.EnsureInformerForResource("nonexistent", "conn", "key")
			},
		},
		{
			name: "GetResourceDefinition",
			fn: func() error {
				_, err := ctrl.GetResourceDefinition("nonexistent", "type")
				return err
			},
		},
		{
			name: "SetLayout",
			fn: func() error {
				return ctrl.SetLayout("nonexistent", "layout", nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appErr := requireAppError(t, tt.fn())
			assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
			assert.Equal(t, 404, appErr.Status)
		})
	}
}

// ======================== ConnectionNotFound tests ======================== //

// TestListConnections_ConnectionNotFound verifies that ListConnections returns
// TypeConnectionNotFound when the plugin has no connections entry in the map.
func TestListConnections_ConnectionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.ListConnections("nonexistent")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypeConnectionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// TestGetConnection_NoConnectionsConfigured verifies that GetConnection returns
// TypeConnectionNotFound when the plugin ID has no connections map entry.
func TestGetConnection_NoConnectionsConfigured(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetConnection("nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypeConnectionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// TestConnectionMethods_NoConnectionsConfigured verifies that methods which
// check c.connections (rather than c.clients) return TypeConnectionNotFound
// when the plugin has no connection entries.
func TestConnectionMethods_NoConnectionsConfigured(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "UpdateConnection",
			fn: func() error {
				_, err := ctrl.UpdateConnection("nonexistent", types.Connection{ID: "conn"})
				return err
			},
		},
		{
			name: "RemoveConnection",
			fn: func() error {
				return ctrl.RemoveConnection("nonexistent", "conn")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appErr := requireAppError(t, tt.fn())
			assert.Equal(t, apperror.TypeConnectionNotFound, appErr.Type)
			assert.Equal(t, 404, appErr.Status)
		})
	}
}
