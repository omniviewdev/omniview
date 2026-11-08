//go:build devcontrol

package host

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// The lifecycle service is registered with Wails only in development builds
// and from this package, so main's startup check and its drift tests never see
// it. Wails binds every exported method of a registered service to the page, so
// the service must expose none that the audit gateway allowlist has not
// classified; today it exposes none at all.
func TestDevelopmentControlLifecycleBindsNoUnclassifiedMethod(t *testing.T) {
	policy, err := auditgate.Default()
	require.NoError(t, err)
	require.NoError(t, policy.Verify((*developmentControlLifecycle)(nil)))

	bound, err := auditgate.BoundMethodFQNs((*developmentControlLifecycle)(nil))
	require.NoError(t, err)
	require.Empty(t, bound, "the control lifecycle must not expose Wails-bound methods")
}
