package metric

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type otherKindMetricWindow struct{ legacyMetricWindow }

func TestMetricSessionsSeparateWindowKindsWithSameID(t *testing.T) {
	wrapper := &ServiceWrapper{Realm: invocation.NewWindowRealm(nil)}
	native, browser := &legacyMetricWindow{id: 1}, &otherKindMetricWindow{legacyMetricWindow{id: 1}}
	session := func(window application.Window) *metricFrontendSession {
		t.Helper()
		_, found, err := wrapper.metricSession(context.WithValue(context.Background(), application.WindowKey, window))
		require.NoError(t, err)
		return found
	}
	first, second := session(native), session(browser)
	require.NotSame(t, first, second)
	require.NotEqual(t, first.scope.Principal().Owner(), second.scope.Principal().Owner())
	require.Same(t, first, session(native))
	require.Same(t, second, session(browser))
	require.Len(t, wrapper.sessions, 2)
}
