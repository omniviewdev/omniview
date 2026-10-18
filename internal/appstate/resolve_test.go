package appstate

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveRoot_EnvVar(t *testing.T) {
	home := rootFixtureHome(t)
	root := filepath.Join(home, "env-state")
	t.Setenv("OMNIVIEW_STATE_DIR", root)
	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, root, got)
}

func TestResolveRoot_TildeExpansion(t *testing.T) {
	home := rootFixtureHome(t)
	t.Setenv("OMNIVIEW_STATE_DIR", "~/custom-omniview")
	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(home, "custom-omniview"), got)
}

func TestResolveRoot_Default(t *testing.T) {
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	rootFixtureHome(t)
	old := buildStateDir
	buildStateDir = ""
	t.Cleanup(func() { buildStateDir = old })

	home, err := os.UserHomeDir()
	require.NoError(t, err)
	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(home, ".omniview"), got)
}

func TestResolveRoot_BuildFlag(t *testing.T) {
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	home := rootFixtureHome(t)
	old := buildStateDir
	buildStateDir = filepath.Join(home, ".omniview-nightly")
	t.Cleanup(func() { buildStateDir = old })

	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(home, ".omniview-nightly"), got)
}

func TestResolveRoot_Priority(t *testing.T) {
	home := rootFixtureHome(t)
	old := buildStateDir
	buildStateDir = filepath.Join(home, "build-default")
	t.Cleanup(func() { buildStateDir = old })

	t.Setenv("OMNIVIEW_STATE_DIR", filepath.Join(home, "env-override"))

	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(home, "env-override"), got, "env var should take priority over build flag")
}

func TestExpandAndValidate_RejectsRelative(t *testing.T) {
	_, err := expandAndValidate("relative/path")
	assert.Error(t, err)
}

func TestExpandAndValidate_TildeOnly(t *testing.T) {
	home := rootFixtureHome(t)
	got, err := expandAndValidate("~")
	require.NoError(t, err)
	assert.Equal(t, home, got)
}

func TestWithRootRejectsRelativeAndCanonicalizesAliases(t *testing.T) {
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	_, err := New(WithRoot("relative/state"))
	require.Error(t, err)
	root := t.TempDir()
	alias := filepath.Join(t.TempDir(), "alias")
	require.NoError(t, os.Symlink(root, alias))
	service, err := New(WithRoot(alias))
	require.NoError(t, err)
	defer service.Close()
	expected, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)
	assert.Equal(t, expected, service.Root())
	_, err = New(WithRoot(root))
	require.Error(t, err, "canonical alias must retain the same root flock")
}

func rootFixtureHome(t *testing.T) string {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	return home
}
