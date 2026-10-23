package devserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
)

func newTestPortAllocator(t *testing.T) *PortAllocator {
	t.Helper()
	svc := appstate.NewTestService(t)
	return NewPortAllocator(svc.RootDir())
}

func TestPortAllocator_ReturnsInRange(t *testing.T) {
	pa := newTestPortAllocator(t)
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

	pa := newTestPortAllocator(t)
	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)
	assert.NotEqual(t, 15173, port)
}

func TestPortAllocator_UniquePerPlugin(t *testing.T) {
	pa := newTestPortAllocator(t)

	port1, err := pa.Allocate("plugin-a")
	require.NoError(t, err)

	port2, err := pa.Allocate("plugin-b")
	require.NoError(t, err)

	assert.NotEqual(t, port1, port2)
}

func TestPortAllocator_Release(t *testing.T) {
	pa := newTestPortAllocator(t)

	port1, err := pa.Allocate("test-plugin")
	require.NoError(t, err)

	pa.Release(port1)

	// After release, same port should be allocatable again.
	port2, err := pa.Allocate("test-plugin-2")
	require.NoError(t, err)
	assert.Equal(t, port1, port2)
}

func TestPortAllocator_ReleaseByPlugin(t *testing.T) {
	pa := newTestPortAllocator(t)

	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)

	released := pa.ReleaseByPlugin("test-plugin")
	assert.Equal(t, port, released)

	// Unknown plugin returns 0.
	assert.Equal(t, 0, pa.ReleaseByPlugin("nonexistent"))
}

func TestPortAllocator_GetPort(t *testing.T) {
	pa := newTestPortAllocator(t)

	port, err := pa.Allocate("test-plugin")
	require.NoError(t, err)

	assert.Equal(t, port, pa.GetPort("test-plugin"))
	assert.Equal(t, 0, pa.GetPort("nonexistent"))
}

func workspacePortAllocatorFixture(t *testing.T) *PortAllocator {
	t.Helper()
	allocator := newTestPortAllocator(t)
	registry, err := devsession.OpenRegistry(t.TempDir(), devsession.RegistryOptions{})
	require.NoError(t, err)
	allocator.registry = registry
	allocator.owner, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: "9f479dc5-9fd0-4359-915a-ed307fbe5510", Generation: "port-policy-fixture", Role: "host", Source: t.TempDir()})
	require.NoError(t, err)
	allocator.portPolicy = devcontract.PortPolicy{Policy: "sticky", Overrides: map[string]int{}}
	return allocator
}

func TestWorkspacePortPolicyStrictRejectsCollisionAndStickyReallocates(t *testing.T) {
	allocator := workspacePortAllocatorFixture(t)
	original, err := allocator.Allocate("fixture")
	require.NoError(t, err)
	allocator.Release(original)
	collision, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", original))
	require.NoError(t, err)
	defer collision.Close()
	allocator.portPolicy.Policy = "strict"
	_, err = allocator.Allocate("fixture")
	require.True(t, errors.Is(err, devsession.ErrPortConflict), "strict manifest policy must fail instead of choosing another port: %v", err)
	require.Zero(t, allocator.GetPort("fixture"))
	allocator.portPolicy.Policy = "sticky"
	reallocated, err := allocator.Allocate("fixture")
	require.NoError(t, err)
	require.NotEqual(t, original, reallocated)
	allocator.Release(reallocated)
	sticky, err := allocator.Allocate("fixture")
	require.NoError(t, err)
	require.Equal(t, reallocated, sticky, "the actual successful assignment must remain sticky")
	allocator.Release(sticky)
}

func TestWorkspacePluginOverrideIsExactAndStrictEvenWithStickyPolicy(t *testing.T) {
	allocator := workspacePortAllocatorFixture(t)
	collision, err := net.Listen("tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	override := collision.Addr().(*net.TCPAddr).Port
	defer collision.Close()
	allocator.portPolicy.Overrides["plugin-vite:fixture"] = override
	_, err = allocator.Allocate("fixture")
	require.ErrorIs(t, err, devsession.ErrPortConflict, "explicit per-plugin overrides must not silently fall back")
	require.NoError(t, collision.Close())
	actual, err := allocator.Allocate("fixture")
	require.NoError(t, err)
	require.Equal(t, override, actual)
	leases, err := allocator.registry.List(context.Background(), allocator.owner.WorkspaceID)
	require.NoError(t, err)
	require.Len(t, leases, 1)
	require.True(t, leases[0].Strict)
	require.Equal(t, "plugin-vite", leases[0].Key.Role)
	require.Equal(t, "fixture", leases[0].Key.PluginID)
	allocator.Release(actual)
}
