//go:build !windows

package terminal

import (
	"context"
	"testing"

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
