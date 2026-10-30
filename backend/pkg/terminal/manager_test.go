//go:build !windows

package terminal

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStartSession_PtyHasInitialSize(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mgr, _, outMux, _ := NewManager(ctx, logging.NewNop())
	go func() {
		for {
			select {
			case <-outMux:
			case <-ctx.Done():
				return
			}
		}
	}()

	session, err := mgr.StartSession(nil, sdkexec.SessionOptions{Command: []string{"sh"}})
	require.NoError(t, err)
	defer mgr.terminateSession(session.ID)

	mgr.mux.RLock()
	ptyFile := mgr.ptys[session.ID]
	mgr.mux.RUnlock()
	require.NotNil(t, ptyFile)

	rows, cols, err := pty.Getsize(ptyFile)
	require.NoError(t, err)
	assert.Equal(t, int(InitialRows), rows)
	assert.Equal(t, int(InitialCols), cols)
}

func TestLocalShellStartsInHomeWithSizedPty(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr, _, _, _ := NewManager(ctx, logging.NewNop())
	_, err := mgr.StartSession(nil, sdkexec.SessionOptions{Command: []string{
		"/bin/sh", "-c", `pwd -P > "$HOME/start-directory"; stty size > "$HOME/start-size"`,
	}})
	require.NoError(t, err)
	expected, err := filepath.EvalSymlinks(home)
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		dir, dirErr := os.ReadFile(filepath.Join(home, "start-directory"))
		size, sizeErr := os.ReadFile(filepath.Join(home, "start-size"))
		return dirErr == nil && sizeErr == nil &&
			strings.TrimSpace(string(dir)) == expected &&
			strings.TrimSpace(string(size)) == "27 72"
	}, time.Second*3, time.Millisecond*10)
}
