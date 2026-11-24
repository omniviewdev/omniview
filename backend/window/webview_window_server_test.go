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
	"sync"
	"sync/atomic"
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

// recordingSink records what the window service would be told: a window that
// closed, and one that hid. A headless window reports on the caller's
// goroutine, so a test reads the record after the call returns.
type recordingSink struct {
	inertSink
	closed []string
	hidden []string
}

func (s *recordingSink) windowClosed(name string) { s.closed = append(s.closed, name) }

func (s *recordingSink) windowVisibilityChanged(name string, visible bool) {
	if !visible {
		s.hidden = append(s.hidden, name)
	}
}

func loopbackPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	address, isTCP := listener.Addr().(*net.TCPAddr)
	if !isTCP {
		t.Fatalf("the probe listener address is %T", listener.Addr())
	}
	port := address.Port
	if closeErr := listener.Close(); closeErr != nil {
		t.Fatalf("close the probe listener: %v", closeErr)
	}
	return port
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

func serverWindowTemplate() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{Width: 800, Height: 600}
}

// A process has one Wails application, and it ends with the process.
//
//nolint:gochecknoglobals // application.New keeps the first application of the process in a global, so the tests share it
var serverProcess struct {
	once    sync.Once
	app     *application.App
	port    int
	main    *application.WebviewWindow
	windows atomic.Int32
}

// theServerApplication starts the application the way main.go does: the main
// window is created before Run and is the first window of the registry.
func theServerApplication(t *testing.T) (*application.App, int) {
	t.Helper()
	serverProcess.once.Do(func() {
		port := loopbackPort(t)
		app := application.New(application.Options{
			Name:   "omniview-b110",
			Server: application.ServerOptions{Host: "127.0.0.1", Port: port},
			Assets: application.AssetOptions{Handler: http.NotFoundHandler()},
		})
		mainOptions := serverWindowTemplate()
		mainOptions.Name = MainWindowName
		serverProcess.main = NewWebviewWindow(app, mainOptions)
		go func() { _ = app.Run() }()
		waitServing(t, port)
		serverProcess.app, serverProcess.port = app, port
	})
	if serverProcess.app == nil {
		t.Fatal("the application did not start in an earlier test")
	}
	return serverProcess.app, serverProcess.port
}

// eventsKept connects a client to the event socket, emits count events of size
// bytes, waits until the last one has reached the client (so it has passed
// every transport) and returns how much the live heap grew.
func eventsKept(t *testing.T, app *application.App, port, count, size int) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/wails/events", port), nil)
	if err != nil {
		t.Fatalf("connect to the event socket: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(1 << 20)

	registered, done := make(chan struct{}), make(chan struct{})
	failed := make(chan error, 1)
	go func() {
		seenProbe := false
		for {
			_, message, readErr := conn.Read(ctx)
			if readErr != nil {
				failed <- readErr
				return
			}
			switch {
			case bytes.Contains(message, []byte("b110.done")):
				close(done)
				return
			case !seenProbe && bytes.Contains(message, []byte("b110.probe")):
				seenProbe = true
				close(registered)
			}
		}
	}()

	// The server registers a client after it has answered the upgrade, and an
	// event emitted before that does not reach the client: emit a probe until
	// one arrives. The wait ends with the probe, not with the time.
	for waiting := true; waiting; {
		app.Event.Emit("b110.probe", "probe")
		select {
		case <-registered:
			waiting = false
		case readErr := <-failed:
			t.Fatalf("read the event socket before the probe: %v", readErr)
		case <-time.After(10 * time.Millisecond):
		}
	}

	payload := strings.Repeat("x", size)
	before := liveHeap()
	for range count {
		app.Event.Emit("b110.payload", payload)
	}
	app.Event.Emit("b110.done", "done")
	// Events pass the transports in send order, the windows first and then the
	// sockets, so the end marker on the socket means every payload event has
	// been through every window.
	select {
	case <-done:
	case readErr := <-failed:
		t.Fatalf("read the event socket before the end marker: %v", readErr)
	}
	return int64(liveHeap()) - int64(before)
}

// TestEventsAreNotRetainedByTheWindowsOfTheServerBuild creates the windows the
// way the host does (the main window before Run, a window of the window
// service while the application runs), asks them to show, emits events and
// reads the heap once the last event has passed every transport.
func TestEventsAreNotRetainedByTheWindowsOfTheServerBuild(t *testing.T) {
	app, port := theServerApplication(t)

	host := &wailsWindowHost{app: app, template: serverWindowTemplate()}
	name := fmt.Sprintf("second-%d", serverProcess.windows.Add(1))
	second := host.createWindow(windowSpec{Name: name, Kind: KindWorkspace, Width: 800, Height: 600}, inertSink{})
	wailsWindow{window: serverProcess.main}.Activate()
	second.Activate()
	if _, found := app.Window.GetByName(MainWindowName); !found {
		t.Fatal("the main window is not in the registry of the application")
	}

	if grown := eventsKept(t, app, port, b110Events, b110EventBytes); grown > b110HeapBound {
		t.Fatalf("the heap grew by %d MiB after %d events of %d KiB: a window of the server build keeps the events it was given (bound %d MiB)",
			grown>>20, b110Events, b110EventBytes>>10, b110HeapBound>>20)
	}
}

// A window of the window service has no platform window in the server build,
// and Wails' Close returns at once for a window that did not run: the service
// must still hear that the window closed, or it keeps the entry and the saved
// state of a window that is gone.
func TestClosingAWindowOfTheServerBuildTellsTheWindowService(t *testing.T) {
	app, _ := theServerApplication(t)
	host := &wailsWindowHost{app: app, template: serverWindowTemplate()}
	name := fmt.Sprintf("closing-%d", serverProcess.windows.Add(1))
	sink := &recordingSink{}
	closing := host.createWindow(windowSpec{Name: name, Kind: KindWorkspace, Width: 800, Height: 600}, sink)

	closing.Close()

	if len(sink.closed) != 1 || sink.closed[0] != name || len(sink.hidden) != 0 {
		t.Fatalf("after Close the window service was told closed=%v hidden=%v, want closed=[%s] and nothing hidden", sink.closed, sink.hidden, name)
	}
}

// The settings window hides instead of closing, as it does when it exists.
func TestClosingTheSettingsWindowOfTheServerBuildHidesItInsteadOfClosing(t *testing.T) {
	app, _ := theServerApplication(t)
	host := &wailsWindowHost{app: app, template: serverWindowTemplate()}
	name := fmt.Sprintf("settings-%d", serverProcess.windows.Add(1))
	sink := &recordingSink{}
	settings := host.createWindow(windowSpec{Name: name, Kind: KindSettings, Width: 800, Height: 600}, sink)

	settings.Close()

	if len(sink.hidden) != 1 || sink.hidden[0] != name || len(sink.closed) != 0 {
		t.Fatalf("after Close the window service was told closed=%v hidden=%v, want hidden=[%s] and nothing closed", sink.closed, sink.hidden, name)
	}
}
