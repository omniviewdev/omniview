package window

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

type recordedEvent struct {
	name string
	data any
}

// fakeEmitter records events. onEmit runs under the service lock, so it must
// not call back into the service synchronously.
type fakeEmitter struct {
	mu     sync.Mutex
	events []recordedEvent
	onEmit func(name string, data any)
}

func (e *fakeEmitter) emit(name string, data any) {
	e.mu.Lock()
	e.events = append(e.events, recordedEvent{name: name, data: data})
	onEmit := e.onEmit
	e.mu.Unlock()
	if onEmit != nil {
		onEmit(name, data)
	}
}

func (e *fakeEmitter) take() []recordedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	events := e.events
	e.events = nil
	return events
}

func (e *fakeEmitter) eventsNamed(name string) []recordedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var matching []recordedEvent
	for _, event := range e.events {
		if event.name == name {
			matching = append(matching, event)
		}
	}
	return matching
}

type fakeNativeWindow struct {
	name        string
	sink        windowEventSink
	mu          sync.Mutex
	activations int
	position    *screenPosition
	bounds      Bounds
	visible     bool
}

func (w *fakeNativeWindow) Activate() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.activations++
	w.visible = true
}

// Close mirrors Wails: the OS close is reported back through the sink.
func (w *fakeNativeWindow) Close() {
	w.sink.windowClosed(w.name)
}

func (w *fakeNativeWindow) Hide() {
	w.mu.Lock()
	w.visible = false
	w.mu.Unlock()
	w.sink.windowVisibilityChanged(w.name, false)
}

func (w *fakeNativeWindow) IsVisible() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.visible
}

func (w *fakeNativeWindow) SetPosition(x, y int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.position = &screenPosition{X: x, Y: y}
}

func (w *fakeNativeWindow) Bounds() Bounds {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.bounds
}

func (w *fakeNativeWindow) setBounds(bounds Bounds) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.bounds = bounds
}

type fakeHost struct {
	mu       sync.Mutex
	specs    []windowSpec
	windows  map[string]*fakeNativeWindow
	workArea *Bounds
}

func newFakeHost() *fakeHost {
	return &fakeHost{windows: map[string]*fakeNativeWindow{}}
}

func (h *fakeHost) createWindow(spec windowSpec, sink windowEventSink) nativeWindow {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.specs = append(h.specs, spec)
	window := &fakeNativeWindow{name: spec.Name, sink: sink}
	h.windows[spec.Name] = window
	return window
}

func (h *fakeHost) workAreaNear(int, int) (Bounds, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.workArea == nil {
		return Bounds{}, false
	}
	return *h.workArea, true
}

type testHarness struct {
	service     *Service
	host        *fakeHost
	emitter     *fakeEmitter
	mainWindow  *fakeNativeWindow
	sessionPath string
}

func newTestHarness(t *testing.T, sessionPath string, dropTimeout time.Duration) *testHarness {
	t.Helper()
	if sessionPath == "" {
		sessionPath = filepath.Join(t.TempDir(), SessionFileName)
	}
	host := newFakeHost()
	emitter := &fakeEmitter{}
	mainWindow := &fakeNativeWindow{name: MainWindowName}
	service := newService(serviceDependencies{
		host:        host,
		emitter:     emitter,
		log:         logging.NewNop(),
		mainWindow:  mainWindow,
		sessionPath: sessionPath,
		saveDelay:   10 * time.Millisecond,
		dropTimeout: dropTimeout,
	})
	mainWindow.sink = service
	t.Cleanup(func() {
		require.NoError(t, service.ServiceShutdown())
	})
	return &testHarness{
		service:     service,
		host:        host,
		emitter:     emitter,
		mainWindow:  mainWindow,
		sessionPath: sessionPath,
	}
}

func (h *testHarness) open(t *testing.T, kind Kind, initialState map[string]string) string {
	t.Helper()
	name, err := h.service.Open(OpenRequest{Kind: kind, InitialState: initialState})
	require.NoError(t, err)
	return name
}

func (h *testHarness) native(name string) *fakeNativeWindow {
	if name == MainWindowName {
		return h.mainWindow
	}
	h.host.mu.Lock()
	defer h.host.mu.Unlock()
	return h.host.windows[name]
}

// setGeometry sets the native frame and reports the viewport size, the way
// the OS and the frontend would.
func (h *testHarness) setGeometry(name string, bounds Bounds, viewportWidth, viewportHeight float64) {
	h.native(name).setBounds(bounds)
	h.service.refreshBounds(name)
	h.service.ReportViewport(name, viewportWidth, viewportHeight)
}

func TestContentRectSitsAtBottomRightOfNativeFrame(t *testing.T) {
	entry := newWindowEntry("w", KindWorkspace, nil, nil, nil)
	_, ok := entry.contentRect()
	assert.False(t, ok, "no bounds and no viewport")

	// A 24px GTK menu bar above the viewport (live-verified geometry).
	entry.bounds = &Bounds{X: 240, Y: 90, Width: 800, Height: 624}
	_, ok = entry.contentRect()
	assert.False(t, ok, "no viewport reported yet")
	entry.viewportWidth, entry.viewportHeight, entry.hasViewport = 800, 600, true
	content, ok := entry.contentRect()
	require.True(t, ok)
	assert.Equal(t, screenRect{X: 240, Y: 114, Width: 800, Height: 600}, content)

	// Frame decorations on the left shift the origin right as well.
	entry.bounds = &Bounds{X: 10, Y: 20, Width: 810, Height: 600}
	content, _ = entry.contentRect()
	assert.Equal(t, screenRect{X: 20, Y: 20, Width: 800, Height: 600}, content)

	// A viewport larger than the frame (zoom, stale bounds) never moves the
	// origin up/left of the frame.
	entry.viewportWidth, entry.viewportHeight = 900, 700
	content, _ = entry.contentRect()
	assert.Equal(t, screenRect{X: 10, Y: 20, Width: 900, Height: 700}, content)
}

func TestRegistryDropTargetUsesFocusOrderAndSourceOcclusion(t *testing.T) {
	registry := newWindowRegistry()
	geometry := map[string]Bounds{
		// main spans the screen; w-back and w-front overlap in x 200..300.
		"main":    {X: 0, Y: 0, Width: 1000, Height: 1024},
		"w-back":  {X: 100, Y: 76, Width: 200, Height: 224},
		"w-front": {X: 200, Y: 76, Width: 200, Height: 224},
	}
	for _, name := range []string{"main", "w-back", "w-front"} {
		bounds := geometry[name]
		entry := newWindowEntry(name, KindWorkspace, nil, &bounds, nil)
		// Every window has a 24px menu bar above its viewport.
		entry.viewportWidth = float64(bounds.Width)
		entry.viewportHeight = float64(bounds.Height - 24)
		entry.hasViewport = true
		registry.add(entry)
	}
	// Focus order (front to back): w-front, w-back, main.
	assert.Equal(t, []string{"w-front", "w-back", "main"}, registry.focusOrder)

	assert.Equal(t, "w-front", registry.topmostAt(250, 150), "overlap goes to the most recently focused")
	assert.Equal(t, "w-back", registry.topmostAt(150, 150))
	assert.Equal(t, "main", registry.topmostAt(900, 900))
	assert.Equal(t, "main", registry.topmostAt(150, 90), "the menu bar of w-back is not content")
	assert.Empty(t, registry.topmostAt(2000, 2000))

	registry.bringToFront("w-back")
	assert.Equal(t, "w-back", registry.topmostAt(250, 150), "focus changes the z-order")

	// The source occludes windows below it.
	assert.Empty(t, registry.dropTargetAt("w-back", 250, 150))
	assert.Empty(t, registry.dropTargetAt("main", 900, 900))
	assert.Equal(t, "main", registry.dropTargetAt("w-back", 900, 900))
	// A source below the topmost window does not occlude it.
	assert.Equal(t, "w-back", registry.dropTargetAt("main", 150, 150))

	// Hidden windows and windows without a viewport are never targets.
	registry.entries["w-back"].hidden = true
	assert.Equal(t, "w-front", registry.topmostAt(250, 150))
	registry.entries["w-front"].hasViewport = false
	assert.Equal(t, "main", registry.topmostAt(250, 150))
}

func TestServiceFocusEventsReorderHitTest(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	first := h.open(t, KindWorkspace, nil)
	second := h.open(t, KindPanel, nil)
	h.setGeometry(first, Bounds{X: 0, Y: 0, Width: 100, Height: 100}, 100, 100)
	h.setGeometry(second, Bounds{X: 0, Y: 0, Width: 100, Height: 100}, 100, 100)

	h.service.mu.Lock()
	assert.Equal(t, second, h.service.registry.topmostAt(50, 50))
	h.service.mu.Unlock()

	h.emitter.take()
	h.service.windowFocused(first)
	changed := h.emitter.eventsNamed(EventWindowsChanged)
	require.Len(t, changed, 1)
	infos := changed[0].data.(WindowsChangedEvent).Windows
	assert.Equal(t, []Info{
		{Name: MainWindowName, Kind: KindWorkspace, Focused: false},
		{Name: first, Kind: KindWorkspace, Focused: true},
		{Name: second, Kind: KindPanel, Focused: false},
	}, infos)

	h.service.mu.Lock()
	assert.Equal(t, first, h.service.registry.topmostAt(50, 50))
	h.service.mu.Unlock()
}

// Drag fixture geometry (global px). Every window has a 24px menu bar:
//   - main: content (0,24) 500x500
//   - left: content (600,24) 200x200
//   - right: content (900,24) 200x200
const fixtureMenuBar = 24

// mainClient converts a global point into main's client space.
func mainClient(globalX, globalY float64) (float64, float64) {
	return globalX, globalY - fixtureMenuBar
}

func newDragFixture(t *testing.T, dropTimeout time.Duration) (*testHarness, string, string) {
	t.Helper()
	h := newTestHarness(t, "", dropTimeout)
	left := h.open(t, KindWorkspace, nil)
	right := h.open(t, KindPanel, nil)
	h.setGeometry(MainWindowName, Bounds{X: 0, Y: 0, Width: 500, Height: 524}, 500, 500)
	h.setGeometry(left, Bounds{X: 600, Y: 0, Width: 200, Height: 224}, 200, 200)
	h.setGeometry(right, Bounds{X: 900, Y: 0, Width: 200, Height: 224}, 200, 200)
	h.emitter.take()
	return h, left, right
}

func beginTestDrag(t *testing.T, h *testHarness, sessionID string) {
	t.Helper()
	require.NoError(t, h.service.BeginDrag(DragBegin{
		SessionID:    sessionID,
		SourceWindow: MainWindowName,
		DragType:     "omniview/drawer-tab",
		Payload:      `{"tab":{"id":"t1"}}`,
	}))
}

func moveFromMain(h *testHarness, sessionID string, globalX, globalY float64) {
	clientX, clientY := mainClient(globalX, globalY)
	h.service.MoveDrag(sessionID, clientX, clientY)
}

func TestDragHoverLeaveSequenceMapsIntoTargetClientSpace(t *testing.T) {
	h, left, right := newDragFixture(t, time.Second)
	beginTestDrag(t, h, "s1")

	moveFromMain(h, "s1", 100, 100)     // over the source: no target
	moveFromMain(h, "s1", 650, 50)      // enter left
	moveFromMain(h, "s1", 660, 60)      // still left
	moveFromMain(h, "s1", 950, 50)      // left -> right
	moveFromMain(h, "s1", 850, 50)      // gap: leave right
	moveFromMain(h, "s1", 950, 10)      // right's menu bar: not content
	moveFromMain(h, "s1", 950, 60)      // enter right
	moveFromMain(h, "s1", 100, 100)     // back over the source: leave right
	h.service.MoveDrag("unknown", 1, 1) // ignored
	h.service.CancelDrag("s1")
	moveFromMain(h, "s1", 650, 50) // after cancel: ignored

	payload := `{"tab":{"id":"t1"}}`
	assert.Equal(t, []recordedEvent{
		{EventDragBegin, DragBeginEvent{SessionID: "s1", SourceWindow: MainWindowName, DragType: "omniview/drawer-tab"}},
		{EventDragHover, DragPointerEvent{SessionID: "s1", TargetWindow: left, Payload: payload, ClientX: 50, ClientY: 26}},
		{EventDragHover, DragPointerEvent{SessionID: "s1", TargetWindow: left, Payload: payload, ClientX: 60, ClientY: 36}},
		{EventDragLeave, DragLeaveEvent{SessionID: "s1", TargetWindow: left}},
		{EventDragHover, DragPointerEvent{SessionID: "s1", TargetWindow: right, Payload: payload, ClientX: 50, ClientY: 26}},
		{EventDragLeave, DragLeaveEvent{SessionID: "s1", TargetWindow: right}},
		{EventDragHover, DragPointerEvent{SessionID: "s1", TargetWindow: right, Payload: payload, ClientX: 50, ClientY: 36}},
		{EventDragLeave, DragLeaveEvent{SessionID: "s1", TargetWindow: right}},
		{EventDragEnd, DragEndEvent{SessionID: "s1"}},
	}, h.emitter.take())
}

func TestBeginDragRefreshesNativeBounds(t *testing.T) {
	h, left, _ := newDragFixture(t, time.Second)
	// The left window moved without a move event reaching the service.
	h.native(left).setBounds(Bounds{X: 600, Y: 300, Width: 200, Height: 224})
	beginTestDrag(t, h, "s1")
	h.emitter.take()

	moveFromMain(h, "s1", 650, 50)
	assert.Empty(t, h.emitter.take(), "the old position is no longer a target")
	moveFromMain(h, "s1", 650, 350)
	assert.Equal(t, []recordedEvent{
		{EventDragHover, DragPointerEvent{
			SessionID: "s1", TargetWindow: left, Payload: `{"tab":{"id":"t1"}}`, ClientX: 50, ClientY: 26,
		}},
	}, h.emitter.take())
}

func TestDragFromSourceWithoutGeometryHasNoTarget(t *testing.T) {
	h, _, _ := newDragFixture(t, time.Second)
	name := h.open(t, KindPanel, nil)
	require.NoError(t, h.service.BeginDrag(DragBegin{SessionID: "s1", SourceWindow: name, Payload: "{}"}))
	h.emitter.take()
	h.service.MoveDrag("s1", 650, 50)
	assert.Empty(t, h.emitter.take())
	result, err := h.service.EndDrag(context.Background(), "s1", 650, 50)
	require.NoError(t, err)
	assert.False(t, result.Accepted)
}

func TestBeginDragValidation(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	require.ErrorIs(t, h.service.BeginDrag(DragBegin{SessionID: "", SourceWindow: MainWindowName}), ErrInvalidDrag)
	require.ErrorIs(t, h.service.BeginDrag(DragBegin{SessionID: "s", SourceWindow: "w-missing"}), ErrUnknownWindow)
	require.NoError(t, h.service.BeginDrag(DragBegin{SessionID: "s", SourceWindow: MainWindowName}))
	require.ErrorIs(t, h.service.BeginDrag(DragBegin{SessionID: "s", SourceWindow: MainWindowName}), ErrInvalidDrag)
}

func endFromMain(ctx context.Context, h *testHarness, sessionID string, globalX, globalY float64) (DropResult, error) {
	clientX, clientY := mainClient(globalX, globalY)
	return h.service.EndDrag(ctx, sessionID, clientX, clientY)
}

func TestEndDragAccepted(t *testing.T) {
	h, left, _ := newDragFixture(t, 5*time.Second)
	h.emitter.onEmit = func(name string, data any) {
		if name == EventDragDrop {
			drop := data.(DragPointerEvent)
			go h.service.RespondDrop(drop.SessionID, true, "drawer-"+drop.TargetWindow)
		}
	}
	beginTestDrag(t, h, "s1")
	moveFromMain(h, "s1", 650, 50)

	result, err := endFromMain(context.Background(), h, "s1", 655, 55)
	require.NoError(t, err)
	assert.Equal(t, DropResult{Accepted: true, TargetWindow: left, TargetInstanceID: "drawer-" + left}, result)

	drops := h.emitter.eventsNamed(EventDragDrop)
	require.Len(t, drops, 1)
	assert.Equal(t, DragPointerEvent{
		SessionID: "s1", TargetWindow: left, Payload: `{"tab":{"id":"t1"}}`, ClientX: 55, ClientY: 31,
	}, drops[0].data, "the drop point is in the target's client space")

	names := []string{}
	for _, event := range h.emitter.take() {
		names = append(names, event.name)
	}
	assert.Equal(t, []string{EventDragBegin, EventDragHover, EventDragDrop, EventDragEnd}, names)

	_, err = endFromMain(context.Background(), h, "s1", 655, 55)
	require.ErrorIs(t, err, ErrUnknownDragSession, "the session is removed after it ends")
}

func TestEndDragDeclined(t *testing.T) {
	h, _, _ := newDragFixture(t, 5*time.Second)
	h.emitter.onEmit = func(name string, data any) {
		if name == EventDragDrop {
			go h.service.RespondDrop(data.(DragPointerEvent).SessionID, false, "")
		}
	}
	beginTestDrag(t, h, "s1")
	result, err := endFromMain(context.Background(), h, "s1", 650, 50)
	require.NoError(t, err)
	assert.False(t, result.Accepted)
}

func TestEndDragTimeoutIsNotAccepted(t *testing.T) {
	h, _, _ := newDragFixture(t, 30*time.Millisecond)
	beginTestDrag(t, h, "s1")

	started := time.Now()
	result, err := endFromMain(context.Background(), h, "s1", 650, 50)
	require.NoError(t, err)
	assert.False(t, result.Accepted)
	assert.Less(t, time.Since(started), time.Second)
	assert.Len(t, h.emitter.eventsNamed(EventDragEnd), 1)

	// A late answer is ignored.
	h.service.RespondDrop("s1", true, "late")
	h.service.mu.Lock()
	assert.Empty(t, h.service.drags)
	h.service.mu.Unlock()
}

func TestEndDragCallerCancellationIsAnError(t *testing.T) {
	h, _, _ := newDragFixture(t, 5*time.Second)
	beginTestDrag(t, h, "s1")
	ctx, cancel := context.WithCancel(context.Background())
	h.emitter.onEmit = func(name string, _ any) {
		if name == EventDragDrop {
			cancel()
		}
	}
	result, err := endFromMain(ctx, h, "s1", 650, 50)
	require.ErrorIs(t, err, context.Canceled)
	assert.False(t, result.Accepted)
	assert.Len(t, h.emitter.eventsNamed(EventDragEnd), 1)
}

func TestEndDragOverNothingLeavesPreviousTarget(t *testing.T) {
	h, left, _ := newDragFixture(t, 5*time.Second)
	beginTestDrag(t, h, "s1")
	moveFromMain(h, "s1", 650, 50)
	h.emitter.take()

	result, err := endFromMain(context.Background(), h, "s1", 3000, 3000)
	require.NoError(t, err)
	assert.False(t, result.Accepted)
	assert.Equal(t, []recordedEvent{
		{EventDragLeave, DragLeaveEvent{SessionID: "s1", TargetWindow: left}},
		{EventDragEnd, DragEndEvent{SessionID: "s1"}},
	}, h.emitter.take())
}

func TestDropTargetClosingDeclinesDrop(t *testing.T) {
	h, left, _ := newDragFixture(t, 5*time.Second)
	h.emitter.onEmit = func(name string, _ any) {
		if name == EventDragDrop {
			go func() { _ = h.service.Close(left) }()
		}
	}
	beginTestDrag(t, h, "s1")
	started := time.Now()
	result, err := endFromMain(context.Background(), h, "s1", 650, 50)
	require.NoError(t, err)
	assert.False(t, result.Accepted)
	assert.Less(t, time.Since(started), time.Second)
}

func TestCloseEmitsStatesAndRemovesWindow(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	drawer := `{"version":1,"tabs":[],"focusedId":null}`
	name := h.open(t, KindPanel, map[string]string{"drawer": drawer})

	states, err := h.service.GetState(name)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"drawer": drawer}, states, "initial state is served before the window loads")

	pages := `{"version":1}`
	require.NoError(t, h.service.SaveState(name, "pages", pages))
	h.emitter.take()

	require.NoError(t, h.service.Close(name))

	closed := h.emitter.eventsNamed(EventWindowClosed)
	require.Len(t, closed, 1)
	assert.Equal(t, WindowClosedEvent{
		Name:   name,
		Kind:   KindPanel,
		States: map[string]string{"drawer": drawer, "pages": pages},
	}, closed[0].data)
	changed := h.emitter.eventsNamed(EventWindowsChanged)
	require.Len(t, changed, 1)
	assert.Equal(t, []Info{{Name: MainWindowName, Kind: KindWorkspace, Focused: true}},
		changed[0].data.(WindowsChangedEvent).Windows)

	_, err = h.service.GetState(name)
	require.ErrorIs(t, err, ErrUnknownWindow)
	assert.NotContains(t, h.service.ListStates(), name)
	assert.Equal(t, []Info{{Name: MainWindowName, Kind: KindWorkspace, Focused: true}}, h.service.List())

	// A duplicate close notification is ignored.
	h.service.windowClosed(name)
	assert.Len(t, h.emitter.eventsNamed(EventWindowClosed), 1)

	require.ErrorIs(t, h.service.Close(MainWindowName), ErrMainWindowClose)
	require.ErrorIs(t, h.service.Close(name), ErrUnknownWindow)
}

func TestClosingSourceWindowEndsItsDrag(t *testing.T) {
	h, left, right := newDragFixture(t, time.Second)
	require.NoError(t, h.service.BeginDrag(DragBegin{SessionID: "s1", SourceWindow: left, Payload: "{}"}))
	// Global (950,50) in left's client space: left's content origin is (600,24).
	h.service.MoveDrag("s1", 350, 26)
	h.emitter.take()

	require.NoError(t, h.service.Close(left))
	events := h.emitter.take()
	require.GreaterOrEqual(t, len(events), 2)
	assert.Equal(t, recordedEvent{EventDragLeave, DragLeaveEvent{SessionID: "s1", TargetWindow: right}}, events[0])
	assert.Equal(t, recordedEvent{EventDragEnd, DragEndEvent{SessionID: "s1"}}, events[1])
}

func TestOpenValidatesAndPlacesWindowAtAnchorPointer(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	_, err := h.service.Open(OpenRequest{Kind: "bogus"})
	require.ErrorIs(t, err, ErrInvalidKind)
	_, err = h.service.Open(OpenRequest{Kind: KindPanel, InitialState: map[string]string{"drawer": "{not json"}})
	require.ErrorIs(t, err, ErrInvalidState)
	_, err = h.service.Open(OpenRequest{Kind: KindPanel, AnchorWindow: "w-missing", HasPosition: true})
	require.ErrorIs(t, err, ErrUnknownWindow)
	_, err = h.service.Open(OpenRequest{Kind: KindPanel, AnchorWindow: "", HasPosition: true})
	require.ErrorIs(t, err, ErrUnknownWindow)
	_, err = h.service.Open(OpenRequest{Kind: KindPanel, AnchorWindow: MainWindowName, HasPosition: true})
	require.ErrorIs(t, err, ErrUnknownGeometry, "main has not reported its viewport yet")
	require.Empty(t, h.host.specs)

	// main at (240,90) with a 24px menu bar: content origin (240,114). The
	// native frame is read when Open runs, not from a stale event.
	h.service.ReportViewport(MainWindowName, 800, 600)
	h.mainWindow.setBounds(Bounds{X: 240, Y: 90, Width: 800, Height: 624})
	name, err := h.service.Open(OpenRequest{
		Kind: KindPanel, AnchorWindow: MainWindowName, ClientX: 500.4, ClientY: 300, HasPosition: true,
	})
	require.NoError(t, err)
	assert.Regexp(t, `^w-[0-9a-f]{8}$`, name)
	require.Len(t, h.host.specs, 1)
	assert.Equal(t, windowSpec{
		Name:     name,
		Kind:     KindPanel,
		Width:    defaultPanelWidth,
		Height:   defaultPanelHeight,
		Position: &screenPosition{X: 740 - tearOffPointerOffsetX, Y: 414 - tearOffPointerOffsetY},
	}, h.host.specs[0])

	require.NoError(t, h.service.Focus(name))
	assert.Equal(t, 1, h.native(name).activations)
	require.ErrorIs(t, h.service.SaveState(name, "pages", "{bad"), ErrInvalidState)
	require.ErrorIs(t, h.service.SaveState("w-missing", "pages", "{}"), ErrUnknownWindow)
}

func TestMoveToPointerUsesWindowOwnClientSpace(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	name := h.open(t, KindPanel, nil)

	require.ErrorIs(t, h.service.MoveToPointer("w-missing", 1, 1), ErrUnknownWindow)
	require.ErrorIs(t, h.service.MoveToPointer(name, 1, 1), ErrUnknownGeometry)
	assert.Nil(t, h.native(name).position)

	// Content origin (100,124): a 24px menu bar above a 900x520 viewport.
	h.service.ReportViewport(name, 900, 520)
	h.native(name).setBounds(Bounds{X: 100, Y: 100, Width: 900, Height: 544})
	require.NoError(t, h.service.MoveToPointer(name, 10.4, 20))
	assert.Equal(t,
		&screenPosition{X: 110 - tearOffPointerOffsetX, Y: 144 - tearOffPointerOffsetY},
		h.native(name).position,
	)
}

func TestPlacementKeepsWindowsInsideTheWorkArea(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	h.host.workArea = &Bounds{X: 0, Y: 0, Width: 1920, Height: 1080}
	h.service.ReportViewport(MainWindowName, 1920, 1056)
	h.mainWindow.setBounds(Bounds{X: 0, Y: 0, Width: 1920, Height: 1080})

	// Released near the bottom-right corner: the panel opens fully on screen.
	name, err := h.service.Open(OpenRequest{
		Kind: KindPanel, AnchorWindow: MainWindowName, ClientX: 1890, ClientY: 1040, HasPosition: true,
	})
	require.NoError(t, err)
	assert.Equal(t,
		&screenPosition{X: 1920 - defaultPanelWidth, Y: 1080 - defaultPanelHeight},
		h.host.specs[0].Position,
	)

	// Released above and left of the screen: the window snaps to its edges.
	_, err = h.service.Open(OpenRequest{
		Kind: KindPanel, AnchorWindow: MainWindowName, ClientX: 10, ClientY: -100, HasPosition: true,
	})
	require.NoError(t, err)
	assert.Equal(t, &screenPosition{X: 0, Y: 0}, h.host.specs[1].Position)

	// A window larger than the work area aligns to its top-left.
	h.service.ReportViewport(name, 2400, 1176)
	h.native(name).setBounds(Bounds{X: 0, Y: 0, Width: 2400, Height: 1200})
	require.NoError(t, h.service.MoveToPointer(name, 1000, 500))
	assert.Equal(t, &screenPosition{X: 0, Y: 0}, h.native(name).position)
}

func TestSessionRoundTrip(t *testing.T) {
	sessionPath := filepath.Join(t.TempDir(), SessionFileName)
	first := newTestHarness(t, sessionPath, time.Second)
	panel := first.open(t, KindPanel, map[string]string{"drawer": `{"tabs":[1]}`})
	workspace := first.open(t, KindWorkspace, nil)
	first.service.windowBoundsChanged(panel, Bounds{X: 40, Y: 50, Width: 700, Height: 450})
	require.NoError(t, first.service.SaveState(MainWindowName, "pages", `{"main":true}`))
	require.NoError(t, first.service.SaveState(workspace, "pages", `{"w":true}`))
	require.NoError(t, first.service.ServiceShutdown())

	// Windows torn down by the application after shutdown keep their state.
	first.host.windows[panel].Close()

	second := newTestHarness(t, sessionPath, time.Second)
	panelSpec := windowSpec{Name: panel, Kind: KindPanel, Width: 700, Height: 450, Position: &screenPosition{X: 40, Y: 50}}
	workspaceSpec := windowSpec{Name: workspace, Kind: KindWorkspace, Width: defaultWorkspaceWidth, Height: defaultWorkspaceHeight}
	// Saved windows are known (and listed) at once, but open one at a time.
	assert.Empty(t, second.host.specs)
	assert.Equal(t, []Info{
		{Name: MainWindowName, Kind: KindWorkspace, Focused: false},
		{Name: panel, Kind: KindPanel, Focused: false},
		{Name: workspace, Kind: KindWorkspace, Focused: true},
	}, second.service.List())

	// The main window's frontend loaded: the first saved window opens.
	mainStates, err := second.service.GetState(MainWindowName)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"pages": `{"main":true}`}, mainStates)
	assert.Equal(t, []windowSpec{panelSpec}, second.host.specs)

	// A repeated load of main (a reload) does not skip ahead.
	_, err = second.service.GetState(MainWindowName)
	require.NoError(t, err)
	assert.Equal(t, []windowSpec{panelSpec}, second.host.specs)

	// The restored panel loaded: the next saved window opens.
	panelStates, err := second.service.GetState(panel)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"drawer": `{"tabs":[1]}`}, panelStates)
	assert.Equal(t, []windowSpec{panelSpec, workspaceSpec}, second.host.specs)

	workspaceStates, err := second.service.GetState(workspace)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"pages": `{"w":true}`}, workspaceStates)
	assert.Equal(t, []windowSpec{panelSpec, workspaceSpec}, second.host.specs)

	// The restored window's bounds survive the next save untouched.
	require.NoError(t, second.service.ServiceShutdown())
	session, err := loadSessionFile(sessionPath)
	require.NoError(t, err)
	assert.Equal(t, &Bounds{X: 40, Y: 50, Width: 700, Height: 450}, session.Windows[0].Bounds)
}

func TestSessionSavesAreDebounced(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	require.NoError(t, h.service.SaveState(MainWindowName, "pages", `{"v":1}`))
	require.NoError(t, h.service.SaveState(MainWindowName, "pages", `{"v":2}`))

	require.Eventually(t, func() bool {
		session, err := loadSessionFile(h.sessionPath)
		return err == nil && session.States[MainWindowName]["pages"] == `{"v":2}`
	}, 2*time.Second, 5*time.Millisecond)

	info, err := os.Stat(h.sessionPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(sessionFileMode), info.Mode().Perm())
}

func TestCorruptSessionIsBackedUpAndStartsEmpty(t *testing.T) {
	for name, content := range map[string]string{
		"invalid json": `{"windows": [`,
		"invalid kind": `{"windows":[{"name":"w-00000001","kind":"floating"}],"states":{}}`,
		"main listed":  `{"windows":[{"name":"main","kind":"workspace"}],"states":{}}`,
		"duplicate":    `{"windows":[{"name":"w-1","kind":"panel"},{"name":"w-1","kind":"panel"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			sessionPath := filepath.Join(t.TempDir(), SessionFileName)
			require.NoError(t, os.WriteFile(sessionPath, []byte(content), 0o600))

			h := newTestHarness(t, sessionPath, time.Second)
			assert.Empty(t, h.host.specs)
			assert.Equal(t, []Info{{Name: MainWindowName, Kind: KindWorkspace, Focused: true}}, h.service.List())

			backup, err := os.ReadFile(sessionPath + corruptSessionSuffix)
			require.NoError(t, err)
			assert.Equal(t, content, string(backup))

			// The next save writes a fresh, valid session.
			require.NoError(t, h.service.SaveState(MainWindowName, "pages", `{}`))
			require.NoError(t, h.service.ServiceShutdown())
			written, err := os.ReadFile(sessionPath)
			require.NoError(t, err)
			var session persistedSession
			require.NoError(t, json.Unmarshal(written, &session))
			assert.Equal(t, map[string]string{"pages": `{}`}, session.States[MainWindowName])
		})
	}
}

func TestMissingSessionStartsEmpty(t *testing.T) {
	session, err := loadSessionFile(filepath.Join(t.TempDir(), "absent.json"))
	require.NoError(t, err)
	assert.Equal(t, emptySession(), session)
}
