//go:build !windows

package devserver

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestPrependToPath(t *testing.T) {
	sep := string(os.PathListSeparator)

	tests := []struct {
		name     string
		env      []string
		dirs     []string
		wantPath string // expected value of PATH= entry
	}{
		{
			name:     "adds to existing PATH",
			env:      []string{"HOME=/home/user", "PATH=/usr/bin" + sep + "/bin"},
			dirs:     []string{"/opt/go/bin"},
			wantPath: "/opt/go/bin" + sep + "/usr/bin" + sep + "/bin",
		},
		{
			name:     "creates PATH when missing",
			env:      []string{"HOME=/home/user"},
			dirs:     []string{"/opt/node/bin"},
			wantPath: "/opt/node/bin",
		},
		{
			name:     "multiple dirs prepended",
			env:      []string{"PATH=/usr/bin"},
			dirs:     []string{"/opt/pnpm/bin", "/opt/node/bin"},
			wantPath: "/opt/pnpm/bin" + sep + "/opt/node/bin" + sep + "/usr/bin",
		},
		{
			name:     "empty dirs is no-op",
			env:      []string{"PATH=/usr/bin"},
			dirs:     []string{},
			wantPath: "/usr/bin",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := prependToPath(tt.env, tt.dirs)

			// Find the PATH entry.
			var found bool
			for _, e := range result {
				if strings.HasPrefix(e, "PATH=") {
					found = true
					assert.Equal(t, "PATH="+tt.wantPath, e)
					break
				}
			}

			if tt.wantPath != "" {
				assert.True(t, found, "expected PATH entry in result")
			}
		})
	}
}

func TestNewViteProcess(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop().Sugar()
	appendLog := func(LogEntry) {}
	setStatus := func(DevProcessStatus) {}

	vp := newViteProcess(ctx, logger, "vite-test", "/dev/path", 15173, BuildOpts{
		PnpmPath: "/usr/bin/pnpm",
		NodePath: "/usr/bin/node",
	}, appendLog, setStatus)

	assert.Equal(t, "vite-test", vp.pluginID)
	assert.Equal(t, "/dev/path", vp.devPath)
	assert.Equal(t, 15173, vp.port)
	assert.Equal(t, "/usr/bin/pnpm", vp.buildOpts.PnpmPath)
	assert.NotNil(t, vp.done)
	assert.Nil(t, vp.cmd)
}

func TestViteProcess_Stop_NilCmd(t *testing.T) {
	vp := &viteProcess{
		logger: zap.NewNop().Sugar(),
		done:   make(chan struct{}),
	}
	// cmd is nil — Stop should return early without panic.
	vp.Stop()
}

func TestViteProcess_Stop_NilProcess(t *testing.T) {
	vp := &viteProcess{
		logger: zap.NewNop().Sugar(),
		done:   make(chan struct{}),
		cmd:    &exec.Cmd{}, // cmd non-nil but Process is nil
	}
	vp.Stop()
}

func TestPrependToPath_PreservesOtherEnvVars(t *testing.T) {
	env := []string{"HOME=/home/user", "GOPATH=/go", "PATH=/usr/bin"}
	result := prependToPath(env, []string{"/opt/bin"})

	// All original vars should still be present.
	assert.Contains(t, result, "HOME=/home/user")
	assert.Contains(t, result, "GOPATH=/go")
	assert.Len(t, result, 3) // no extra entries added
}

// processAlive checks if a process with the given PID exists.
func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

// newTestViteProcessWithSleep creates a viteProcess that spawns a shell with
// a child sleep process, simulating the Vite dev server process tree.
// Returns the viteProcess and a cleanup function.
func newTestViteProcessWithSleep(t *testing.T, ctx context.Context) *viteProcess {
	t.Helper()

	vp := &viteProcess{
		ctx:       ctx,
		logger:    zap.NewNop().Sugar(),
		pluginID:  "test",
		appendLog: func(LogEntry) {},
		setStatus: func(DevProcessStatus) {},
		done:      make(chan struct{}),
	}

	// Spawn "sh -c 'sleep 300 & sleep 300'" — creates a parent sh and two
	// child sleep processes, all in the same process group (Setpgid: true).
	cmd := exec.CommandContext(ctx, "sh", "-c", "sleep 300 & sleep 300")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	require.NoError(t, cmd.Start())

	vp.cmd = cmd
	vp.pgid, _ = syscall.Getpgid(cmd.Process.Pid)
	if vp.pgid == 0 {
		vp.pgid = cmd.Process.Pid
	}

	// Set cmd.Cancel to kill the process group on context cancellation.
	cmd.Cancel = func() error {
		return syscall.Kill(-vp.pgid, syscall.SIGKILL)
	}

	// Wait for the process in a goroutine so vp.done gets closed.
	go func() {
		_ = cmd.Wait()
		close(vp.done)
	}()

	// Give the child sleep processes a moment to spawn.
	time.Sleep(50 * time.Millisecond)

	return vp
}

func TestViteProcess_Stop_KillsProcessGroup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	vp := newTestViteProcessWithSleep(t, ctx)
	parentPid := vp.cmd.Process.Pid
	pgid := vp.pgid

	require.True(t, processAlive(parentPid), "parent should be alive before Stop")

	vp.Stop()

	// After Stop(), the entire process group should be dead.
	// Give the OS a moment to reap.
	time.Sleep(100 * time.Millisecond)

	assert.False(t, processAlive(parentPid), "parent should be dead after Stop")

	// Verify no processes in the group are alive by sending signal 0 to the group.
	err := syscall.Kill(-pgid, 0)
	assert.Error(t, err, "process group should be dead after Stop")
}

func TestViteProcess_ContextCancel_KillsProcessGroup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	vp := newTestViteProcessWithSleep(t, ctx)
	parentPid := vp.cmd.Process.Pid
	pgid := vp.pgid

	require.True(t, processAlive(parentPid), "parent should be alive before cancel")

	// Cancel the context — this should trigger cmd.Cancel which kills the process group.
	cancel()

	// Wait for the process to exit.
	select {
	case <-vp.done:
	case <-time.After(5 * time.Second):
		t.Fatal("process did not exit after context cancel")
	}

	time.Sleep(100 * time.Millisecond)

	assert.False(t, processAlive(parentPid), "parent should be dead after context cancel")
	err := syscall.Kill(-pgid, 0)
	assert.Error(t, err, "process group should be dead after context cancel")
}

func TestViteProcess_PGID_CachedAfterStart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	vp := newTestViteProcessWithSleep(t, ctx)
	pgid := vp.PGID()

	require.NotZero(t, pgid, "PGID should be non-zero after start")

	// Kill the process externally.
	_ = syscall.Kill(-pgid, syscall.SIGKILL)

	// Wait for process to die.
	select {
	case <-vp.done:
	case <-time.After(5 * time.Second):
		t.Fatal("process did not exit after external kill")
	}

	// PGID should still return the cached value even though the process is dead.
	cachedPgid := vp.PGID()
	assert.Equal(t, pgid, cachedPgid, "PGID should return cached value after process death")
	assert.NotZero(t, cachedPgid, "cached PGID should be non-zero")
}
