package sdk

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteDevInfo_ParsesHandshake(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	err := WriteDevInfo("test-plugin", "1.0.0", "1|1|tcp|127.0.0.1:42367|grpc", 15173)
	require.NoError(t, err)

	info, err := ReadDevInfo("test-plugin")
	require.NoError(t, err)
	assert.Equal(t, os.Getpid(), info.PID)
	assert.Equal(t, "grpc", info.Protocol)
	assert.Equal(t, 1, info.ProtocolVersion)
	assert.Equal(t, "127.0.0.1:42367", info.Addr)
	assert.Equal(t, 15173, info.VitePort)
	assert.Equal(t, "test-plugin", info.PluginID)
}

func TestWriteDevInfo_InvalidHandshake(t *testing.T) {
	err := WriteDevInfo("test", "1.0", "invalid", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid handshake line")
}

func TestCleanupDevInfo(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	err := WriteDevInfo("test-plugin", "1.0.0", "1|1|tcp|127.0.0.1:42367|grpc", 0)
	require.NoError(t, err)

	path := filepath.Join(pluginDir, ".devinfo")
	_, err = os.Stat(path)
	require.NoError(t, err)

	err = CleanupDevInfo("test-plugin")
	require.NoError(t, err)

	_, err = os.Stat(path)
	assert.True(t, os.IsNotExist(err))
}

func TestCleanupDevInfo_NotExist(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	err := CleanupDevInfo("nonexistent-plugin")
	assert.NoError(t, err)
}

func TestWriteDevInfoFromAddr(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "addr-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	addr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 50051}
	err := WriteDevInfoFromAddr("addr-plugin", "2.0.0", addr, 15174)
	require.NoError(t, err)

	info, err := ReadDevInfo("addr-plugin")
	require.NoError(t, err)
	assert.Equal(t, os.Getpid(), info.PID)
	assert.Equal(t, "grpc", info.Protocol)
	assert.Equal(t, 1, info.ProtocolVersion)
	assert.Equal(t, "127.0.0.1:50051", info.Addr)
	assert.Equal(t, 15174, info.VitePort)
	assert.Equal(t, "addr-plugin", info.PluginID)
	assert.Equal(t, "2.0.0", info.Version)
	assert.False(t, info.StartedAt.IsZero())
}

func TestWriteDevInfoFromAddr_NoVitePort(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "go-only")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	addr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 50052}
	err := WriteDevInfoFromAddr("go-only", "1.0.0", addr, 0)
	require.NoError(t, err)

	info, err := ReadDevInfo("go-only")
	require.NoError(t, err)
	assert.Equal(t, 0, info.VitePort)
}

func TestWriteDevInfo_InvalidProtocolVersion(t *testing.T) {
	err := WriteDevInfo("test", "1.0", "1|notanumber|tcp|127.0.0.1:42367|grpc", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid protocol version")
}

func TestReadDevInfo_NotExist(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	_, err := ReadDevInfo("nonexistent")
	assert.Error(t, err)
}

func TestCleanupDevInfo_AlsoCleansTmpFile(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	// Create a leftover tmp file.
	tmpPath := filepath.Join(pluginDir, ".devinfo.tmp")
	require.NoError(t, os.WriteFile(tmpPath, []byte("leftover"), 0644))

	err := CleanupDevInfo("test-plugin")
	require.NoError(t, err)

	_, err = os.Stat(tmpPath)
	assert.True(t, os.IsNotExist(err))
}
