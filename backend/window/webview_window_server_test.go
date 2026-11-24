//go:build server

package window

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// B-110. The server build has no native page, so nothing drains the
// JavaScript that Wails queues for a webview window it runs: the queue grew by
// every event until the process was out of memory (a client that read the
// events as fast as the host made them took the host from 67 MiB to 9.5 GiB in
// 30 s). The events are the same for every producer (logs, metrics, resources,
// terminals): each goes through app.Event.Emit and from there to every window.
const (
	b110Events     = 2000
	b110EventBytes = 24 << 10
	// The events carry 47 MiB. A window that keeps them holds at least that
	// much; the bound leaves room for what the socket and the runtime hold.
	b110HeapBound = 16 << 20
)

type inertSink struct{}

func (inertSink) windowFocused(string)                 {}
func (inertSink) windowVisibilityChanged(string, bool) {}
func (inertSink) windowBoundsChanged(string, Bounds)   {}
func (inertSink) shutdownStarted() bool                { return false }
func (inertSink) windowClosed(string)                  {}

func loopbackPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

// waitServing returns when the application answers; it waits for that event
// only and decides nothing.
func waitServing(t *testing.T, port int) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		response, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the application did not start serving")
}

func liveHeap() uint64 {
	runtime.GC()
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return stats.HeapAlloc
}

// TestEventsAreNotRetainedByTheWindowsOfTheServerBuild creates the windows the
// way the host does (the main window before Run, a window of the window
// service while the application runs), asks them to show, emits events and
// reads the heap once the last event has passed every transport.
func TestEventsAreNotRetainedByTheWindowsOfTheServerBuild(t *testing.T) {
	port := loopbackPort(t)
	app := application.New(application.Options{
		Name:   "omniview-b110",
		Server: application.ServerOptions{Host: "127.0.0.1", Port: port},
		Assets: application.AssetOptions{Handler: http.NotFoundHandler()},
	})
	template := application.WebviewWindowOptions{Width: 800, Height: 600}
	mainOptions := template
	mainOptions.Name = MainWindowName
	mainWindow := NewWebviewWindow(app, mainOptions)

	stopped := make(chan error, 1)
	go func() { stopped <- app.Run() }()
	t.Cleanup(func() {
		app.Quit()
		select {
		case <-stopped:
		case <-time.After(30 * time.Second):
			t.Error("the application did not stop")
		}
	})
	waitServing(t, port)

	host := &wailsWindowHost{app: app, template: template}
	second := host.createWindow(windowSpec{Name: "second", Kind: KindWorkspace, Width: 800, Height: 600}, inertSink{})
	wailsWindow{window: mainWindow}.Activate()
	second.Activate()
	for _, name := range []string{MainWindowName, "second"} {
		if _, found := app.Window.GetByName(name); !found {
			t.Fatalf("window %q is not in the registry of the application", name)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/wails/events", port), nil)
	if err != nil {
		t.Fatalf("connect to the event socket: %v", err)
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)

	payload := strings.Repeat("x", b110EventBytes)
	before := liveHeap()
	for range b110Events {
		app.Event.Emit("b110.payload", payload)
	}
	app.Event.Emit("b110.done", "done")
	// Events pass the transports in send order, the windows first and then the
	// sockets, so the end marker on the socket means every payload event has
	// been through every window.
	for {
		_, message, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("read the event socket before the end marker: %v", err)
		}
		if bytes.Contains(message, []byte("b110.done")) {
			break
		}
	}
	after := liveHeap()

	if grown := int64(after) - int64(before); grown > b110HeapBound {
		t.Fatalf("the heap grew by %d MiB after %d events of %d KiB: a window of the server build keeps the events it was given (bound %d MiB)",
			grown>>20, b110Events, b110EventBytes>>10, b110HeapBound>>20)
	}
}
