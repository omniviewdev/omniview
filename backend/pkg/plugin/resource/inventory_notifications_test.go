package resource

import (
	"testing"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func TestInventorySubscribersObserveCommittedProfilesOutsideLocks(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	native := profileTestConnection("route", "native")
	provider := connectionOverlayTestProvider(native)
	registerMockPlugin(ctrl, "plugin", provider)
	_, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{native})
	require.NoError(t, err)
	notifications := 0
	unsubscribe := ctrl.OnInventoryChange(func() {
		notifications++
		require.True(t, ctrl.pluginsMu.TryLock())
		ctrl.pluginsMu.Unlock()
		require.True(t, ctrl.connsMu.TryLock())
		ctrl.connsMu.Unlock()
		require.True(t, ctrl.profilesMu.TryLock())
		ctrl.profilesMu.Unlock()
		require.True(t, ctrl.lifecycleMu.TryLock())
		ctrl.lifecycleMu.Unlock()
		_, err := ctrl.ListAllConnections(testInvocationContext())
		require.NoError(t, err)
	})
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", profileTestConnection("route", "updated"))
	require.NoError(t, err)
	require.Equal(t, 1, notifications)
	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "plugin", "route"))
	require.Equal(t, 2, notifications)
	unsubscribe()
	unsubscribe()
	_, err = ctrl.ResetConnectionProfile(testInvocationContext(), "plugin", "route")
	require.NoError(t, err)
	require.Equal(t, 2, notifications)
}
