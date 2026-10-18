//go:build !windows

package devserver

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/require"
)

// TestViteHTTPChildFixture is a real isolated child endpoint, not a fake ready
// callback. It implements only the Vite client HTTP surface the supervisor probes.
func TestViteHTTPChildFixture(t *testing.T) {
	if os.Getenv("OMNIVIEW_VITE_HTTP_FIXTURE") != "1" {
		return
	}
	if os.Getenv("GOWORK") != "off" || os.Getenv("OMNIVIEW_STATE_DIR") == "" {
		os.Exit(3)
	}
	if os.Getenv("OMNIVIEW_FIXTURE_TREE") == "1" {
		signal.Ignore(syscall.SIGTERM)
		// A failing regression must not leak a permanent orphan fixture.
		time.AfterFunc(5*time.Second, func() { os.Exit(0) })
	}
	port := os.Getenv("OMNIVIEW_VITE_PORT")
	fmt.Printf("Local: http://127.0.0.1:%s/\n", port)
	if os.Getenv("OMNIVIEW_FIXTURE_ADVERTISE_ONLY") == "1" {
		time.Sleep(100 * time.Millisecond)
		return
	}
	server := &http.Server{Addr: "127.0.0.1:" + port, ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/@vite/client" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/javascript")
		_, _ = w.Write([]byte("export const fixture = true"))
	})}
	if err := server.ListenAndServe(); err != nil {
		os.Exit(4)
	}
}

func startViteHTTPFixture(t *testing.T, advertiseOnly bool, parent context.Context) (*viteProcess, <-chan DevProcessStatus) {
	t.Helper()
	executable, err := os.Executable()
	require.NoError(t, err)
	shell, err := exec.LookPath("sh")
	require.NoError(t, err)
	directory := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(directory, "ui", "node_modules"), 0700))
	pnpm := filepath.Join(directory, "pnpm-fixture")
	require.NoError(t, os.WriteFile(pnpm, []byte("#!/bin/sh\nif [ \"$OMNIVIEW_FIXTURE_TREE\" = 1 ]; then\n  \"$OMNIVIEW_FIXTURE_EXEC\" -test.run=^TestViteHTTPChildFixture$ &\n  wait \"$!\"\nelse\n  exec \"$OMNIVIEW_FIXTURE_EXEC\" -test.run=^TestViteHTTPChildFixture$\nfi\n"), 0700))
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	env := append(os.Environ(), "OMNIVIEW_VITE_HTTP_FIXTURE=1", "OMNIVIEW_FIXTURE_EXEC="+executable, "OMNIVIEW_STATE_DIR="+t.TempDir(), "OMNIVIEW_FIXTURE_ADVERTISE_ONLY="+strconv.Itoa(map[bool]int{false: 0, true: 1}[advertiseOnly]))
	statuses := make(chan DevProcessStatus, 16)
	ctx, cancel := context.WithCancel(parent)
	vp := newViteProcess(ctx, logging.NewNop(), "fixture", directory, port, BuildOpts{PnpmPath: pnpm, NodePath: shell, Environment: env}, func(LogEntry) {}, func(status DevProcessStatus) { statuses <- status })
	require.NoError(t, vp.Start())
	t.Cleanup(func() { _ = vp.Stop(); cancel() })
	return vp, statuses
}

func TestViteActualHTTPReadinessAndOwnedStop(t *testing.T) {
	vp, statuses := startViteHTTPFixture(t, false, context.Background())
	require.NoError(t, vp.WaitReady())
	require.NoError(t, probeVite(context.Background(), fmt.Sprintf("http://127.0.0.1:%d", vp.port)))
	require.NoError(t, vp.Stop(), "managed Cmd children must stop normally, including Darwin")
	select {
	case <-vp.done:
	case <-time.After(time.Second):
		t.Fatal("owned child not reaped")
	}
	sawReady, sawExit := false, false
	for len(statuses) > 0 {
		switch <-statuses {
		case DevProcessStatusReady:
			sawReady = true
		case DevProcessStatusError:
			sawExit = true
		}
	}
	require.True(t, sawReady)
	require.True(t, sawExit, "process exit must revoke ready state")
}

func TestViteAdvertisementWithoutHTTPNeverBecomesReady(t *testing.T) {
	vp, statuses := startViteHTTPFixture(t, true, context.Background())
	require.Error(t, vp.WaitReady())
	for len(statuses) > 0 {
		require.NotEqual(t, DevProcessStatusReady, <-statuses)
	}
}

func TestViteContextCancellationKillsListeningDescendantBeforeReapingLeader(t *testing.T) {
	t.Setenv("OMNIVIEW_FIXTURE_TREE", "1")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	vp, _ := startViteHTTPFixture(t, false, ctx)
	require.NoError(t, vp.WaitReady())
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", vp.port)
	require.NoError(t, probeVite(context.Background(), endpoint))
	cancel()
	select {
	case <-vp.done:
	case <-time.After(2 * time.Second):
		t.Fatal("canceled Vite tree not reaped")
	}
	require.Error(t, probeVite(context.Background(), endpoint), "TERM-ignoring Vite descendant must not retain the listener after its pnpm leader exits")
	require.NoError(t, vp.Stop(), "already reaped owner must not signal a cached PGID")
}

func TestViteDevRunsNativePNPMPrefixWithoutShell(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node unavailable")
	}
	directory := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(directory, "ui", "node_modules"), 0700))
	runner := filepath.Join(directory, "owned-pnpm.cjs")
	script := `const http = require('node:http');
if (process.argv[2] !== 'pin-fixture' || process.argv[3] !== 'run' || process.argv[4] !== 'dev') process.exit(3);
const port = Number(process.env.OMNIVIEW_VITE_PORT);
const server = http.createServer((request, response) => {
  response.writeHead(request.url === '/@vite/client' ? 200 : 404, {'Content-Type':'application/javascript'});
  response.end('export const fixture = true');
});
server.listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/'));
`
	require.NoError(t, os.WriteFile(runner, []byte(script), 0600))
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	options := BuildOpts{PnpmPath: node, NodePath: node, PnpmArgs: []string{runner, "pin-fixture"}, Environment: os.Environ()}
	process := newViteProcess(ctx, logging.NewNop(), "native-prefix", directory, port, options, func(LogEntry) {}, func(DevProcessStatus) {})
	require.NoError(t, process.Start())
	defer process.Stop()
	require.NoError(t, process.WaitReady())
	require.NoError(t, process.Stop())
}
