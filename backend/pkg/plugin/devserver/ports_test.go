package devserver

import (
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPortAllocator_ReturnsInRange(t *testing.T) {
	pa := NewPortAllocator()
	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)
	assert.GreaterOrEqual(t, port, PortRangeStart)
	assert.LessOrEqual(t, port, PortRangeEnd)
}

func TestPortAllocator_SkipsUsedPorts(t *testing.T) {
	// Bind the preferred port.
	listener, err := net.Listen("tcp", "127.0.0.1:15173")
	if err != nil {
		t.Skip("cannot bind test port")
	}
	defer listener.Close()

	pa := NewPortAllocator()
	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)
	assert.NotEqual(t, 15173, port)
}

func TestPortAllocator_UniquePerPlugin(t *testing.T) {
	pa := NewPortAllocator()

	port1, err := pa.Allocate("plugin-a")
	require.NoError(t, err)

	port2, err := pa.Allocate("plugin-b")
	require.NoError(t, err)

	assert.NotEqual(t, port1, port2)
}

func TestPortAllocator_Release(t *testing.T) {
	pa := NewPortAllocator()

	port1, err := pa.Allocate("test-plugin")
	require.NoError(t, err)

	pa.Release(port1)

	// After release, same port should be allocatable again.
	port2, err := pa.Allocate("test-plugin-2")
	require.NoError(t, err)
	assert.Equal(t, port1, port2)
}

func TestPortAllocator_ReleaseByPlugin(t *testing.T) {
	pa := NewPortAllocator()

	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)

	released := pa.ReleaseByPlugin("test-plugin")
	assert.Equal(t, port, released)

	// Unknown plugin returns 0.
	assert.Equal(t, 0, pa.ReleaseByPlugin("nonexistent"))
}

func TestPortAllocator_GetPort(t *testing.T) {
	pa := NewPortAllocator()

	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)

	assert.Equal(t, port, pa.GetPort("test-plugin"))
	assert.Equal(t, 0, pa.GetPort("nonexistent"))
}
