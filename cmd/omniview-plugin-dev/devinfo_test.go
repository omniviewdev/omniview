package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteDevInfoCLI(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	proc := &PluginProcess{
		PID:  12345,
		Addr: "127.0.0.1:42367",
	}

	err := WriteDevInfoCLI("test-plugin", "1.0.0", proc, 15173)
	require.NoError(t, err)

	// Read the file back and validate.
	path := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin", ".devinfo")
	data, err := os.ReadFile(path)
	require.NoError(t, err)

	var info DevInfoCLI
	require.NoError(t, json.Unmarshal(data, &info))

	assert.Equal(t, 12345, info.PID)
	assert.Equal(t, "grpc", info.Protocol)
	assert.Equal(t, 1, info.ProtocolVersion)
	assert.Equal(t, "127.0.0.1:42367", info.Addr)
	assert.Equal(t, 15173, info.VitePort)
	assert.Equal(t, "test-plugin", info.PluginID)
	assert.Equal(t, "1.0.0", info.Version)
	assert.False(t, info.StartedAt.IsZero())
}

func TestWriteDevInfoCLI_NoVitePort(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	proc := &PluginProcess{PID: 99, Addr: "127.0.0.1:50051"}

	err := WriteDevInfoCLI("go-only-plugin", "2.0.0", proc, 0)
	require.NoError(t, err)

	path := filepath.Join(tmpHome, ".omniview", "plugins", "go-only-plugin", ".devinfo")
	data, err := os.ReadFile(path)
	require.NoError(t, err)

	var info DevInfoCLI
	require.NoError(t, json.Unmarshal(data, &info))

	assert.Equal(t, 0, info.VitePort)
}

func TestWriteDevInfoCLI_AtomicWrite(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	proc := &PluginProcess{PID: 100, Addr: "127.0.0.1:50052"}

	err := WriteDevInfoCLI("test-plugin", "1.0.0", proc, 15173)
	require.NoError(t, err)

	// The temp file should NOT exist after a successful write.
	tmpPath := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin", ".devinfo.tmp")
	_, err = os.Stat(tmpPath)
	assert.True(t, os.IsNotExist(err))
}

func TestCleanupDevInfoCLI(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	// Write a file first.
	proc := &PluginProcess{PID: 100, Addr: "127.0.0.1:50052"}
	require.NoError(t, WriteDevInfoCLI("test-plugin", "1.0.0", proc, 0))

	path := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin", ".devinfo")
	_, err := os.Stat(path)
	require.NoError(t, err)

	log := NewLogger(false)
	CleanupDevInfoCLI("test-plugin", log)

	_, err = os.Stat(path)
	assert.True(t, os.IsNotExist(err))
}

func TestCleanupDevInfoCLI_NotExist(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	log := NewLogger(false)
	// Should not panic on non-existent file.
	CleanupDevInfoCLI("nonexistent", log)
}

func TestCleanupDevInfoCLI_AlsoCleansTmpFile(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	dir := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin")
	require.NoError(t, os.MkdirAll(dir, 0755))

	// Create a leftover temp file.
	tmpPath := filepath.Join(dir, ".devinfo.tmp")
	require.NoError(t, os.WriteFile(tmpPath, []byte("leftover"), 0644))

	log := NewLogger(false)
	CleanupDevInfoCLI("test-plugin", log)

	_, err := os.Stat(tmpPath)
	assert.True(t, os.IsNotExist(err))
}
