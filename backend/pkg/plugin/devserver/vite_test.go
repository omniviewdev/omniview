package devserver

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
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
