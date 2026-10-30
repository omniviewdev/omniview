package resource

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
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
	_, err := ctrl.ScopeValues(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn"}, "namespace")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestGet_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.Get(testInvocationContext(), "nonexistent", HostGetRequest{TargetID: "request-label", Request: grpcGetRequest()})
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestCatalog_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.Catalog(testInvocationContext(), "nonexistent", resource.CatalogRequest{Route: resource.AccessRoute{Connection: "conn"}})
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestFiniteMethods_PluginNotFound(t *testing.T) {
	ctrl := newTestController()
	target := resource.ReadTarget{Route: grpcGetRequest().Route, Provider: "p1", Authority: "authority", Type: "native::Pod", Representation: "native"}
	tests := []struct {
		name string
		fn   func() error
	}{
		{"Enumerate", func() error {
			_, err := ctrl.Enumerate(testInvocationContext(), "nonexistent", HostEnumerateRequest{TargetID: "label", Request: resource.EnumerateRequest{Target: target}})
			return err
		}},
		{"NativeQuery", func() error {
			_, err := ctrl.NativeQuery(testInvocationContext(), "nonexistent", HostNativeQueryRequest{TargetID: "label", Request: resource.NativeQueryRequest{Target: target, Language: "native", Query: resource.Value{Kind: "null"}}})
			return err
		}},
		{"Mutate", func() error {
			_, err := ctrl.Mutate(testInvocationContext(), "nonexistent", resource.MutationRequest{Route: grpcGetRequest().Route, Reference: grpcGetRequest().Reference, Operation: "update", Input: resource.Value{Kind: "null"}})
			return err
		}},
		{"Action", func() error {
			_, err := ctrl.Action(testInvocationContext(), "nonexistent", resource.ActionRequest{Route: grpcGetRequest().Route, Reference: grpcGetRequest().Reference, Action: "inspect", Input: resource.Value{Kind: "null"}})
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			appErr := requireAppError(t, test.fn())
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
				return ctrl.StartConnectionWatch(testInvocationContext(), "nonexistent", []resource.ReadTarget{{Route: resource.AccessRoute{Connection: "conn"}, Provider: "p1", Authority: "authority", Type: "native::Pod", Representation: "native"}})
			},
		},
		{
			name: "StopConnectionWatch",
			fn: func() error {
				return ctrl.StopConnectionWatch(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn"})
			},
		},
		{
			name: "GetEditorSchemas",
			fn: func() error {
				_, err := ctrl.GetEditorSchemas(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn"})
				return err
			},
		},
		{
			name: "GetActions",
			fn: func() error {
				_, err := ctrl.GetActions(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn"}, "key")
				return err
			},
		},
		{
			name: "Action",
			fn: func() error {
				_, err := ctrl.Action(testInvocationContext(), "nonexistent", resource.ActionRequest{Route: grpcGetRequest().Route, Reference: grpcGetRequest().Reference, Action: "inspect", Input: resource.Value{Kind: "null"}})
				return err
			},
		},
		{
			name: "GetWatchState",
			fn: func() error {
				_, err := ctrl.GetWatchState(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn"})
				return err
			},
		},
		{
			name: "EnsureResourceWatch",
			fn: func() error {
				return ctrl.EnsureResourceWatch(testInvocationContext(), "nonexistent", resource.ReadTarget{Route: resource.AccessRoute{Connection: "conn"}, Provider: "p1", Authority: "authority", Type: "native::Pod", Representation: "native"})
			},
		},
		{
			name: "GetResourceDefinition",
			fn: func() error {
				_, err := ctrl.GetResourceDefinition(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn"}, "type")
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

// TestGetConnection_NoConnectionsConfigured verifies that GetConnection returns
// TypeConnectionNotFound when the plugin ID has no connections map entry.
func TestGetConnection_NoConnectionsConfigured(t *testing.T) {
	ctrl := newTestController()
	_, err := ctrl.GetConnection(testInvocationContext(), "nonexistent", "conn")
	appErr := requireAppError(t, err)
	assert.Equal(t, apperror.TypeConnectionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

func TestConnectionProfileMethods_PluginNotFound(t *testing.T) {
	ctrl := newTestController()

	tests := []struct {
		name string
		fn   func() error
	}{
		{
			name: "SaveConnectionProfile",
			fn: func() error {
				_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "nonexistent", types.Connection{ID: "conn"})
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
			assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
			assert.Equal(t, 404, appErr.Status)
		})
	}
}
