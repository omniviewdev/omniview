package appstate

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveRoot_EnvVar(t *testing.T) {
	t.Setenv("OMNIVIEW_STATE_DIR", "/tmp/test-omniview-env")
	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, "/tmp/test-omniview-env", got)
}

func TestResolveRoot_TildeExpansion(t *testing.T) {
	home, err := os.UserHomeDir()
	require.NoError(t, err)
	t.Setenv("OMNIVIEW_STATE_DIR", "~/custom-omniview")
	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(home, "custom-omniview"), got)
}

func TestResolveRoot_Default(t *testing.T) {
	t.Setenv("OMNIVIEW_STATE_DIR", "")
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
	old := buildStateDir
	buildStateDir = "/opt/omniview-nightly"
	t.Cleanup(func() { buildStateDir = old })

	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, "/opt/omniview-nightly", got)
}

func TestResolveRoot_Priority(t *testing.T) {
	old := buildStateDir
	buildStateDir = "/opt/build-default"
	t.Cleanup(func() { buildStateDir = old })

	t.Setenv("OMNIVIEW_STATE_DIR", "/tmp/env-override")

	got, err := ResolveRoot()
	require.NoError(t, err)
	assert.Equal(t, "/tmp/env-override", got, "env var should take priority over build flag")
}

func TestExpandAndValidate_RejectsRelative(t *testing.T) {
	_, err := expandAndValidate("relative/path")
	assert.Error(t, err)
}

func TestExpandAndValidate_TildeOnly(t *testing.T) {
	home, err := os.UserHomeDir()
	require.NoError(t, err)
	got, err := expandAndValidate("~")
	require.NoError(t, err)
	assert.Equal(t, home, got)
}
