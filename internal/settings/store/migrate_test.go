package store

import (
	"bytes"
	"encoding/gob"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// encodeGOB is a test helper that GOB-encodes a settings.Store to bytes.
func encodeGOB(t *testing.T, store settings.Store) []byte {
	t.Helper()
	var buf bytes.Buffer
	enc := gob.NewEncoder(&buf)
	require.NoError(t, enc.Encode(store))
	return buf.Bytes()
}

// writeGOBFile writes a GOB-encoded settings.Store to the given path.
func writeGOBFile(t *testing.T, path string, store settings.Store) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, encodeGOB(t, store), 0o600))
}

// openTestStore creates a bbolt store in a temp directory for testing.
func openTestStore(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func TestMigrate_CoreSettings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	gobStore := settings.Store{
		"general": {
			Settings: map[string]settings.Setting{
				"theme":    {ID: "theme", Value: "dark"},
				"fontSize": {ID: "fontSize", Value: float64(14)},
			},
		},
		"editor": {
			Settings: map[string]settings.Setting{
				"tabSize": {ID: "tabSize", Value: float64(4)},
			},
		},
	}
	writeGOBFile(t, filepath.Join(dir, "settings"), gobStore)

	s := openTestStore(t, dir)
	require.NoError(t, MigrateFromGOB(dir, s))

	// Verify core settings migrated.
	general, err := s.LoadCategory("general")
	require.NoError(t, err)
	assert.Equal(t, "dark", general["theme"])
	assert.Equal(t, float64(14), general["fontSize"])

	editor, err := s.LoadCategory("editor")
	require.NoError(t, err)
	assert.Equal(t, float64(4), editor["tabSize"])

	// Verify old file renamed.
	_, err = os.Stat(filepath.Join(dir, "settings"))
	assert.True(t, os.IsNotExist(err), "original file should be renamed")
	_, err = os.Stat(filepath.Join(dir, "settings.gob.bak"))
	assert.NoError(t, err, "backup file should exist")
}

func TestMigrate_PluginSettings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	gobStore := settings.Store{
		"plugin": {
			Settings: map[string]settings.Setting{
				"apiKey":  {ID: "apiKey", Value: "secret123"},
				"timeout": {ID: "timeout", Value: float64(30)},
			},
		},
	}
	pluginDir := filepath.Join(dir, "plugins", "my-plugin")
	writeGOBFile(t, filepath.Join(pluginDir, "settings"), gobStore)

	s := openTestStore(t, dir)
	require.NoError(t, MigrateFromGOB(dir, s))

	got, err := s.LoadPluginSettings("my-plugin")
	require.NoError(t, err)
	assert.Equal(t, "secret123", got["apiKey"])
	assert.Equal(t, float64(30), got["timeout"])

	// Old file renamed.
	_, err = os.Stat(filepath.Join(pluginDir, "settings"))
	assert.True(t, os.IsNotExist(err))
	_, err = os.Stat(filepath.Join(pluginDir, "settings.gob.bak"))
	assert.NoError(t, err)
}

func TestMigrate_MultiplePlugins(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	plugins := map[string]map[string]settings.Setting{
		"plugin-a": {
			"keyA": {ID: "keyA", Value: "valA"},
		},
		"plugin-b": {
			"keyB": {ID: "keyB", Value: float64(42)},
		},
		"plugin-c": {
			"keyC": {ID: "keyC", Value: true},
		},
	}

	for id, settingsMap := range plugins {
		gobStore := settings.Store{
			"plugin": {Settings: settingsMap},
		}
		writeGOBFile(t, filepath.Join(dir, "plugins", id, "settings"), gobStore)
	}

	s := openTestStore(t, dir)
	require.NoError(t, MigrateFromGOB(dir, s))

	all, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Len(t, all, 3)

	gotA, err := s.LoadPluginSettings("plugin-a")
	require.NoError(t, err)
	assert.Equal(t, "valA", gotA["keyA"])

	gotB, err := s.LoadPluginSettings("plugin-b")
	require.NoError(t, err)
	assert.Equal(t, float64(42), gotB["keyB"])

	gotC, err := s.LoadPluginSettings("plugin-c")
	require.NoError(t, err)
	assert.Equal(t, true, gotC["keyC"])
}

func TestMigrate_NoOldFiles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	s := openTestStore(t, dir)
	err := MigrateFromGOB(dir, s)
	assert.NoError(t, err)

	// Store should be empty.
	general, err := s.LoadCategory("general")
	require.NoError(t, err)
	assert.Empty(t, general)
}

func TestMigrate_CorruptGOB(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	// Write garbage as the core settings file.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "settings"), []byte("not valid gob data!!!"), 0o600))

	// Also write a corrupt plugin settings file.
	pluginDir := filepath.Join(dir, "plugins", "bad-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(pluginDir, "settings"), []byte("also garbage"), 0o600))

	s := openTestStore(t, dir)
	err := MigrateFromGOB(dir, s)
	assert.NoError(t, err, "corrupt files should be skipped gracefully")

	// Store should be empty since nothing could be decoded.
	general, err := s.LoadCategory("general")
	require.NoError(t, err)
	assert.Empty(t, general)
}

func TestMigrate_Idempotent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	gobStore := settings.Store{
		"general": {
			Settings: map[string]settings.Setting{
				"theme": {ID: "theme", Value: "dark"},
			},
		},
	}
	writeGOBFile(t, filepath.Join(dir, "settings"), gobStore)

	s := openTestStore(t, dir)
	require.NoError(t, MigrateFromGOB(dir, s))

	// First migration should have renamed the file.
	_, err := os.Stat(filepath.Join(dir, "settings"))
	assert.True(t, os.IsNotExist(err))

	// Running migration again should be a no-op (no source file).
	err = MigrateFromGOB(dir, s)
	assert.NoError(t, err)

	// Data should still be there.
	general, err := s.LoadCategory("general")
	require.NoError(t, err)
	assert.Equal(t, "dark", general["theme"])
}
