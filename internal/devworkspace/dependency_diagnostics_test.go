package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDependencyCommandRetainsPrivateEvidenceWithoutLeakingCredentials(t *testing.T) {
	w := generatedFixture(t)
	graph := &BuildGraph{workspace: w}
	ctx := context.WithValue(context.Background(), linkToolchainKey{}, graph)
	_, err := linkCommand(ctx, w.Root, "/bin/sh", "-c", "printf 'registry-token-secret' >&2; exit 17")
	require.Error(t, err)
	require.NotContains(t, err.Error(), "registry-token-secret")
	path := filepath.Join(w.Root, ".local", "dependency-command-error.json")
	raw, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	require.Contains(t, string(raw), "registry-token-secret")
	info, statErr := os.Stat(path)
	require.NoError(t, statErr)
	require.Equal(t, os.FileMode(0600), info.Mode().Perm())
	require.NoError(t, ValidateGenerated(context.Background(), w))
}
