package resource

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
)

func TestExtensionShellRouteOutlivesViewNotWindowOrConnectionEpoch(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	ctx := invocation.NewScope(invocation.TrustedUI).Context(t.Context())
	other := invocation.NewScope(invocation.TrustedUI).Context(t.Context())
	proof, view, _ := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "incarnation")
	_, err := ctrl.GuardExtensionRootRoute(other, "p1", proof)
	require.Error(t, err)
	_, err = ctrl.GuardExtensionRootRoute(ctx, "other", proof)
	require.Error(t, err)
	current, err := ctrl.GuardExtensionRootRoute(ctx, "p1", proof)
	require.NoError(t, err)
	require.NoError(t, current(ctx))
	require.Error(t, current(other))
	require.NoError(t, ctrl.CloseSourceView(ctx, "p1", view.ViewID))
	_, err = ctrl.GuardExtensionRootRoute(ctx, "p1", proof)
	require.Error(t, err, "a closed view cannot establish a new launch")
	require.NoError(t, current(ctx), "closing the source view does not retire the existing process")
	release, err := ctrl.fenceStoppedRoute("p1", target.Target.Route.Connection)
	require.NoError(t, err)
	require.Error(t, current(ctx))
	release()
	require.Error(t, current(ctx), "ending the stop transaction cannot revive its predecessor")
}
