package plugin

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func TestValidateHasBinary_Exists(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))

	binPath := filepath.Join(binDir, "plugin")
	require.NoError(t, os.WriteFile(binPath, []byte("#!/bin/sh\n"), 0755))

	assert.NoError(t, validateHasBinary(dir))
}

func TestValidateHasBinary_Missing(t *testing.T) {
	dir := t.TempDir()
	err := validateHasBinary(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestValidateHasBinary_NotExecutable(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))

	binPath := filepath.Join(binDir, "plugin")
	require.NoError(t, os.WriteFile(binPath, []byte("data"), 0644))

	err := validateHasBinary(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not executable")
}

func TestValidateHasUiPackage_Exists(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "assets"), 0755))

	assert.NoError(t, validateHasUiPackage(dir))
}

func TestValidateHasUiPackage_Missing(t *testing.T) {
	dir := t.TempDir()
	err := validateHasUiPackage(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "none found")
}

func TestValidateForStart_BackendOnly(t *testing.T) {
	dir := t.TempDir()
	meta := config.PluginMeta{
		ID:           "test",
		Capabilities: []string{"resource"},
	}

	// No binary → fail.
	err := validateForStart(meta, dir)
	assert.Error(t, err)

	// Add binary → pass.
	binDir := filepath.Join(dir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(binDir, "plugin"), []byte("x"), 0755))

	assert.NoError(t, validateForStart(meta, dir))
}

func TestValidateForStart_UIOnly(t *testing.T) {
	dir := t.TempDir()
	meta := config.PluginMeta{
		ID:           "test",
		Capabilities: []string{"ui"},
	}

	// No assets → fail.
	err := validateForStart(meta, dir)
	assert.Error(t, err)

	// Add assets → pass.
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "assets"), 0755))
	assert.NoError(t, validateForStart(meta, dir))
}

func TestValidateForPhase_ValidatingPhase(t *testing.T) {
	dir := t.TempDir()
	meta := config.PluginMeta{ID: "test", Capabilities: []string{"resource"}}

	// No binary → fail.
	err := ValidateForPhase(lifecycle.PhaseValidating, meta, dir)
	assert.Error(t, err)

	// Add binary → pass.
	binDir := filepath.Join(dir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(binDir, "plugin"), []byte("x"), 0755))
	assert.NoError(t, ValidateForPhase(lifecycle.PhaseValidating, meta, dir))
}

func TestValidateForPhase_StartingPhase(t *testing.T) {
	dir := t.TempDir()
	meta := config.PluginMeta{ID: "test", Capabilities: []string{"ui"}}

	// No assets → fail.
	err := ValidateForPhase(lifecycle.PhaseStarting, meta, dir)
	assert.Error(t, err)

	// Add assets → pass.
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "assets"), 0755))
	assert.NoError(t, ValidateForPhase(lifecycle.PhaseStarting, meta, dir))
}

func TestValidateForPhase_OtherPhases_NoOp(t *testing.T) {
	phases := []lifecycle.PluginPhase{
		lifecycle.PhaseRunning,
		lifecycle.PhaseStopped,
		lifecycle.PhaseFailed,
		lifecycle.PhaseInstalled,
	}
	for _, phase := range phases {
		t.Run(string(phase), func(t *testing.T) {
			// Empty meta + non-existent dir should still pass for non-validating phases.
			assert.NoError(t, ValidateForPhase(phase, config.PluginMeta{}, "/nonexistent"))
		})
	}
}

func TestValidateForStart_BackendAndUI(t *testing.T) {
	dir := t.TempDir()
	meta := config.PluginMeta{
		ID:           "test",
		Capabilities: []string{"resource", "ui"},
	}

	// Nothing → fail (binary missing).
	err := validateForStart(meta, dir)
	assert.Error(t, err)

	// Binary only → fail (UI missing).
	binDir := filepath.Join(dir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(binDir, "plugin"), []byte("x"), 0755))
	err = validateForStart(meta, dir)
	assert.Error(t, err)

	// Both → pass.
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "assets"), 0755))
	assert.NoError(t, validateForStart(meta, dir))
}
