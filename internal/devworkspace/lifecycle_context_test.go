package devworkspace

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// An unknown explicit target with no ownership journal or retirement receipt must
// return the ordinary inspection error, not dereference a missing journal.
func TestValidateLifecycleContextRefusesUnknownTargetWithoutPanic(t *testing.T) {
	t.Parallel()
	m, root := fixtureManager(t, "omniview")
	for _, name := range []string{"never-created", filepath.Join(root, "workspaces", "never-created", "workspace.json")} {
		require.NotPanics(t, func() {
			id, err := m.ValidateLifecycleContext(context.Background(), name, "", "")
			require.Error(t, err)
			require.Empty(t, id)
		})
	}
}
