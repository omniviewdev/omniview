//go:build !windows

package plugin

import (
	"os"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// processExists is whether the system still has the process. A process that has ended and has not been reaped is still there (it can be signalled), so one that is gone is one whose parent has waited for it.
func processExists(pid int) bool { return syscall.Kill(pid, 0) == nil }

// openFiles is how many files this process has open.
func openFiles(t *testing.T) int {
	t.Helper()
	entries, err := os.ReadDir("/dev/fd")
	require.NoError(t, err)
	return len(entries)
}

func TestARefusedPluginIsReapedWhenTheLoadReturnsAndLeavesNoOpenFileAndNoGoroutineBehind(t *testing.T) {
	pm := newTestManager(t)
	fixture := installProtocolPlugin(t, pm, "acme", 2, "")
	refuse := func() {
		backend, _, err := createWithin(t, pm, fixture, refusalBound)
		if backend != nil {
			backend.Kill()
		}
		require.Error(t, err)
		pids := pidsIn(t, fixture.pids)
		require.False(t, processExists(pids[len(pids)-1]), "the process is reaped, not only killed, when the load returns (pid %d)", pids[len(pids)-1])
	}
	refuse() // the first start opens what the first start of a process opens, once
	files, goroutines := openFiles(t), runtime.NumGoroutine()

	const refusals = 20
	for range refusals {
		refuse()
	}

	assert.Equal(t, files, openFiles(t), "%d refusals leave no file open", refusals)
	const slack = 5 // goroutines of the package's other tests may come and go; a Kill after the refusal leaves four for each of the refusals (6 before, 86 after 20 refusals)
	assert.Eventually(t, func() bool { return runtime.NumGoroutine() <= goroutines+slack }, 5*time.Second, 20*time.Millisecond,
		"%d refusals leave no goroutine behind (go-plugin's Kill, which a refusal does not make, dials the plugin and leaves the connection's goroutines): %d before, %d after", refusals, goroutines, runtime.NumGoroutine())
	assert.Empty(t, socketsIn(t, fixture.sockets), "and no socket")
	assert.Len(t, pidsIn(t, fixture.pids), refusals+1, "each refusal was a process of its own")
}
