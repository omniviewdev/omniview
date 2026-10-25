package resource

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// newTestController creates a controller with a no-op logger and no settings
// provider, then calls Run so the context is initialised.
func newTestController() *controller {
	// Provide a pluginStoreFn that panics if called — these tests never exercise
	// the local store path, so the function should never be invoked.
	storeFn := func(pluginID string) (*appstate.ScopedRoot, error) {
		panic("unexpected call to pluginStoreFn in test for plugin " + pluginID)
	}
	ctrl, ok := NewController(logging.NewNop(), nil, storeFn, nil).(*controller)
	if !ok {
		panic("NewController did not return *controller")
	}
	ctrl.Run(context.Background())
	return ctrl
}

// requireAppError is a test helper that asserts err is a non-nil *apperror.AppError
// and returns it for further assertions.
func requireAppError(t *testing.T, err error) *apperror.AppError {
	t.Helper()
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr, "expected *apperror.AppError, got %T: %v", err, err)
	return appErr
}

// ======================== PluginNotFound tests ======================== //

func TestStartConnection_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.StartConnection(testInvocationContext(), "nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestStopConnection_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.StopConnection(testInvocationContext(), "nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestLoadConnections_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.LoadConnections(testInvocationContext(), "nonexistent")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetConnectionNamespaces_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetConnectionNamespaces(testInvocationContext(), "nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGet_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.Get(testInvocationContext(), "nonexistent", "conn", "key", resource.GetInput{})
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetResourceGroup_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetResourceGroup(testInvocationContext(), "nonexistent", "group")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGetResourceType_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetResourceType(testInvocationContext(), "nonexistent", "type")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// TestCRUDMethods_PluginNotFound verifies that all CRUD methods (List, Find,
// Create, Update, Delete) return a PluginNotFound AppError when invoked with a
// non-existent plugin ID.
func TestCRUDMethods_PluginNotFound(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "List",
			fn: func() error {
				_, err := ctrl.List(testInvocationContext(), "nonexistent", "conn", "key", resource.ListInput{})
				return err
			},
		},
		{
			name: "Find",
			fn: func() error {
				_, err := ctrl.Find(testInvocationContext(), "nonexistent", "conn", "key", resource.FindInput{})
				return err
			},
		},
		{
			name: "Create",
			fn: func() error {
				_, err := ctrl.Create(testInvocationContext(), "nonexistent", "conn", "key", resource.CreateInput{})
				return err
			},
		},
		{
			name: "Update",
			fn: func() error {
				_, err := ctrl.Update(testInvocationContext(), "nonexistent", "conn", "key", resource.UpdateInput{})
				return err
			},
		},
		{
			name: "Delete",
			fn: func() error {
				_, err := ctrl.Delete(testInvocationContext(), "nonexistent", "conn", "key", resource.DeleteInput{})
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
// for a plugin provider.
func TestAdditionalMethods_PluginNotFound(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "StartConnectionWatch",
			fn: func() error {
				return ctrl.StartConnectionWatch(testInvocationContext(), "nonexistent", "conn")
			},
		},
		{
			name: "StopConnectionWatch",
			fn: func() error {
				return ctrl.StopConnectionWatch(testInvocationContext(), "nonexistent", "conn")
			},
		},
		{
			name: "GetEditorSchemas",
			fn: func() error {
				_, err := ctrl.GetEditorSchemas(testInvocationContext(), "nonexistent", "conn")
				return err
			},
		},
		{
			name: "GetActions",
			fn: func() error {
				_, err := ctrl.GetActions(testInvocationContext(), "nonexistent", "conn", "key")
				return err
			},
		},
		{
			name: "ExecuteAction",
			fn: func() error {
				_, err := ctrl.ExecuteAction(testInvocationContext(), "nonexistent", "conn", "key", "action", resource.ActionInput{})
				return err
			},
		},
		{
			name: "GetWatchState",
			fn: func() error {
				_, err := ctrl.GetWatchState(testInvocationContext(), "nonexistent", "conn")
				return err
			},
		},
		{
			name: "EnsureResourceWatch",
			fn: func() error {
				return ctrl.EnsureResourceWatch(testInvocationContext(), "nonexistent", "conn", "key")
			},
		},
		{
			name: "GetResourceDefinition",
			fn: func() error {
				_, err := ctrl.GetResourceDefinition(testInvocationContext(), "nonexistent", "type")
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

// ======================== ConnectionNotFound tests ======================== //

// TestListConnections_ConnectionNotFound verifies that ListConnections returns
// TypeConnectionNotFound when the plugin has no connections entry in the map.
func TestListConnections_ConnectionNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.ListConnections(testInvocationContext(), "nonexistent")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypeConnectionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// TestGetConnection_NoConnectionsConfigured verifies that GetConnection returns
// TypeConnectionNotFound when the plugin ID has no connections map entry.
func TestGetConnection_NoConnectionsConfigured(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetConnection(testInvocationContext(), "nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypeConnectionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// TestConnectionMethods_NoConnectionsConfigured verifies that methods which
// check c.connections return TypeConnectionNotFound when the plugin has no
// connection entries.
func TestConnectionMethods_NoConnectionsConfigured(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "UpdateConnection",
			fn: func() error {
				_, err := ctrl.UpdateConnection(testInvocationContext(), "nonexistent", types.Connection{ID: "conn"})
				return err
			},
		},
		{
			name: "RemoveConnection",
			fn: func() error {
				return ctrl.RemoveConnection(testInvocationContext(), "nonexistent", "conn")
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
