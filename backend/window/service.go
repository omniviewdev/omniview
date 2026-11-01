package window

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// Window geometry defaults.
const (
	defaultWorkspaceWidth  = 1440
	defaultWorkspaceHeight = 900
	defaultPanelWidth      = 900
	defaultPanelHeight     = 520
	// A torn-off window's top-left is placed this far up/left of the
	// pointer so the pointer lands on the new window's tab strip.
	tearOffPointerOffsetX = 80
	tearOffPointerOffsetY = 16
	// windowNameRandomBytes is the number of random bytes in "w-<hex>".
	windowNameRandomBytes = 4
	windowNamePrefix      = "w-"
)

// dropResponseTimeout bounds how long EndDrag waits for RespondDrop.
const dropResponseTimeout = 2 * time.Second

// nativeWindow is the subset of an OS window the service drives. Its methods
// may block on the UI thread, so the service never calls them while holding
// its lock.
type nativeWindow interface {
	// Activate shows, restores and focuses the window.
	Activate()
	// Close closes the window; the host reports it through windowClosed.
	Close()
	Hide()
	// IsVisible reports actual native visibility, excluding minimised windows.
	IsVisible() bool
	// SetPosition places the window's top-left at the global point.
	SetPosition(x, y int)
	// Bounds returns the window's current native frame in global px.
	Bounds() Bounds
}

// screenPosition is a window top-left in screen DIP.
type screenPosition struct {
	X int
	Y int
}

// windowSpec describes an OS window to create.
type windowSpec struct {
	Name   string
	Kind   Kind
	Width  int
	Height int
	// Position is nil to let the OS place the window.
	Position *screenPosition
}

// windowEventSink receives OS window lifecycle events. Implementations must
// be called off the UI thread.
type windowEventSink interface {
	windowFocused(name string)
	windowVisibilityChanged(name string, visible bool)
	windowBoundsChanged(name string, bounds Bounds)
	shutdownStarted() bool
	windowClosed(name string)
}

// windowHost creates OS windows and routes their lifecycle events to sink.
type windowHost interface {
	createWindow(spec windowSpec, sink windowEventSink) nativeWindow
	// workAreaNear returns the usable area of the screen nearest to the
	// global point, or false when no screen is known.
	workAreaNear(x, y int) (Bounds, bool)
}

// eventEmitter broadcasts an application event to Go and every window. It
// must not block or call back into the service.
type eventEmitter interface {
	emit(name string, data any)
}

// serviceDependencies wires the platform-independent service core.
type serviceDependencies struct {
	host        windowHost
	emitter     eventEmitter
	log         logging.Logger
	mainWindow  nativeWindow
	sessionPath string
	saveDelay   time.Duration
	dropTimeout time.Duration
}

// dropResponse is a target's answer to a drop.
type dropResponse struct {
	accepted         bool
	targetInstanceID string
}

// dragSession is one active cross-window drag.
type dragSession struct {
	begin DragBegin
	// hoverTarget is the window currently receiving hover events.
	hoverTarget string
	// dropTarget is set while EndDrag waits for the target's RespondDrop.
	dropTarget string
	// dropResponses receives at most one answer (capacity 1).
	dropResponses chan dropResponse
}

// Service is the bound window service: registry, per-window state slots,
// cross-window drag coordination and session persistence.
type Service struct {
	host        windowHost
	emitter     eventEmitter
	log         logging.Logger
	dropTimeout time.Duration
	persister   *sessionPersister

	// settingsOps serializes native settings operations, never lifecycle callbacks.
	// Native calls run without mu, allowing UI-thread hooks to complete.
	settingsOps        sync.Mutex
	settingsState      SettingsState
	settingsRevision   uint64
	settingsNativeBusy bool
	shutdownFlag       atomic.Bool

	// mu guards registry, drags, shuttingDown and the restore queue. Events
	// are emitted while holding it so their order matches the state
	// transitions.
	mu           sync.Mutex
	registry     *windowRegistry
	drags        map[string]*dragSession
	shuttingDown bool
	// pendingRestores are saved windows still waiting for their native
	// window. restoreGate is the window whose first GetState (its frontend
	// finished loading) creates the next one.
	pendingRestores []windowSpec
	restoreGate     string
}

// newService builds the service core, loads the persisted session and
// recreates the saved non-main windows through the host.
func newService(deps serviceDependencies) *Service {
	s := &Service{
		host:            deps.host,
		emitter:         deps.emitter,
		log:             deps.log,
		dropTimeout:     deps.dropTimeout,
		persister:       nil,
		mu:              sync.Mutex{},
		registry:        newWindowRegistry(),
		drags:           map[string]*dragSession{},
		shuttingDown:    false,
		pendingRestores: nil,
		restoreGate:     "",
	}
	s.persister = newSessionPersister(deps.sessionPath, deps.saveDelay, s.snapshotSession, func(err error) {
		s.log.Errorw(context.Background(), "failed to persist window session", "error", err)
	})

	session, err := loadSessionFile(deps.sessionPath)
	if err != nil {
		s.log.Errorw(context.Background(), "window session not restored", "error", err)
	}

	s.registry.add(newWindowEntry(MainWindowName, KindWorkspace, deps.mainWindow, nil, session.States[MainWindowName]))
	s.restoreWindows(session)
	return s
}

// restoreWindows registers the session's non-main windows with their kinds,
// bounds and saved slots, and queues their native windows. They open one at a
// time: the first when the main window's frontend has loaded, each next one
// when the previous restored window's frontend has loaded. Booting every
// webview at once can starve the UI thread on slow (software-rendered)
// systems, and the main window should be usable first.
func (s *Service) restoreWindows(session persistedSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, saved := range session.Windows {
		if saved.Kind == KindSettings || saved.Name == SettingsWindowName {
			continue
		}
		spec := windowSpec{
			Name:     saved.Name,
			Kind:     saved.Kind,
			Width:    0,
			Height:   0,
			Position: nil,
		}
		spec.Width, spec.Height = defaultSize(saved.Kind)
		var bounds *Bounds
		if saved.Bounds != nil {
			restoredBounds := *saved.Bounds
			bounds = &restoredBounds
			spec.Width, spec.Height = restoredBounds.Width, restoredBounds.Height
			spec.Position = &screenPosition{X: restoredBounds.X, Y: restoredBounds.Y}
		}
		s.registry.add(newWindowEntry(saved.Name, saved.Kind, nil, bounds, session.States[saved.Name]))
		s.pendingRestores = append(s.pendingRestores, spec)
	}
	if len(s.pendingRestores) > 0 {
		s.restoreGate = MainWindowName
	}
}

// takeNextRestoreLocked returns the next queued window when name is the
// current restore gate, and moves the gate to that window.
func (s *Service) takeNextRestoreLocked(name string) (windowSpec, bool) {
	if name != s.restoreGate || len(s.pendingRestores) == 0 {
		return windowSpec{}, false
	}
	next := s.pendingRestores[0]
	s.pendingRestores = s.pendingRestores[1:]
	s.restoreGate = next.Name
	if len(s.pendingRestores) == 0 {
		s.restoreGate = ""
	}
	return next, true
}

// createNativeWindow asks the host for the OS window and attaches it to the
// already registered entry.
func (s *Service) createNativeWindow(spec windowSpec) {
	native := s.host.createWindow(spec, s)
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.registry.get(spec.Name); ok {
		entry.native = native
	}
}

// Open creates a window of the requested kind and returns its name. The
// InitialState slots are served by GetState before the window loads.
func (s *Service) Open(req OpenRequest) (string, error) {
	if req.Kind == KindSettings {
		return "", fmt.Errorf("%w: use OpenSettings", ErrInvalidKind)
	}
	if req.HasPosition && req.AnchorWindow == SettingsWindowName {
		return "", fmt.Errorf("%w: settings cannot transfer tabs", ErrInvalidDrag)
	}
	if !req.Kind.isValid() {
		return "", fmt.Errorf("%w %q", ErrInvalidKind, req.Kind)
	}
	for slot, state := range req.InitialState {
		if err := validateSlotState(slot, state); err != nil {
			return "", err
		}
	}
	spec := windowSpec{Name: "", Kind: req.Kind, Width: req.Width, Height: req.Height, Position: nil}
	defaultWidth, defaultHeight := defaultSize(req.Kind)
	if spec.Width <= 0 {
		spec.Width = defaultWidth
	}
	if spec.Height <= 0 {
		spec.Height = defaultHeight
	}
	if req.HasPosition {
		s.refreshBounds(req.AnchorWindow)
		s.mu.Lock()
		globalX, globalY, err := s.clientToGlobalLocked(req.AnchorWindow, req.ClientX, req.ClientY)
		s.mu.Unlock()
		if err != nil {
			return "", fmt.Errorf("place window at anchor pointer: %w", err)
		}
		position := s.fitInWorkArea(tearOffTopLeft(globalX, globalY), spec.Width, spec.Height)
		spec.Position = &position
	}

	s.mu.Lock()
	name, err := s.newWindowNameLocked()
	if err != nil {
		s.mu.Unlock()
		return "", err
	}
	spec.Name = name
	s.registry.add(newWindowEntry(name, req.Kind, nil, nil, req.InitialState))
	s.mu.Unlock()

	s.createNativeWindow(spec)

	s.mu.Lock()
	s.emitWindowsChangedLocked()
	s.mu.Unlock()
	s.persister.schedule()
	return name, nil
}

// List returns the live windows in creation order.
func (s *Service) List() []Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registry.infos()
}

// Focus shows, restores and focuses the named window.
func (s *Service) Focus(name string) error {
	if name == SettingsWindowName {
		_, err := s.OpenSettings("")
		return err
	}
	native, err := s.nativeWindowFor(name)
	if err != nil {
		return err
	}
	native.Activate()
	return nil
}

// Close closes a non-main window. Its state is removed and windows/closed is
// emitted once the OS window has closed.
func (s *Service) Close(name string) error {
	if name == SettingsWindowName {
		return s.HideSettings()
	}
	if name == MainWindowName {
		return ErrMainWindowClose
	}
	native, err := s.nativeWindowFor(name)
	if err != nil {
		return err
	}
	native.Close()
	return nil
}

// MoveToPointer places the named window like a torn-off tab: its top-left
// goes up/left of the pointer, which is given in the window's own client
// space.
func (s *Service) MoveToPointer(name string, clientX, clientY float64) error {
	if name == SettingsWindowName {
		return fmt.Errorf("%w: settings cannot transfer tabs", ErrInvalidDrag)
	}
	s.refreshBounds(name)
	s.mu.Lock()
	globalX, globalY, err := s.clientToGlobalLocked(name, clientX, clientY)
	var native nativeWindow
	var width, height int
	if err == nil {
		native, err = s.nativeWindowLocked(name)
	}
	if entry, ok := s.registry.get(name); ok && entry.bounds != nil {
		width, height = entry.bounds.Width, entry.bounds.Height
	}
	s.mu.Unlock()
	if err != nil {
		return fmt.Errorf("move window to pointer: %w", err)
	}
	position := s.fitInWorkArea(tearOffTopLeft(globalX, globalY), width, height)
	native.SetPosition(position.X, position.Y)
	return nil
}

// GetState returns the named window's slots (slot -> JSON). A window calls it
// once its frontend has loaded, which also releases the next queued restore.
func (s *Service) GetState(name string) (map[string]string, error) {
	s.mu.Lock()
	entry, ok := s.registry.get(name)
	if !ok {
		s.mu.Unlock()
		return nil, fmt.Errorf("%w %q", ErrUnknownWindow, name)
	}
	states := entry.copyStates()
	next, restoreNext := s.takeNextRestoreLocked(name)
	s.mu.Unlock()
	if restoreNext {
		s.createNativeWindow(next)
	}
	return states, nil
}

// SaveState stores one slot of the named window and schedules persistence.
func (s *Service) SaveState(name, slot, stateJSON string) error {
	if err := validateSlotState(slot, stateJSON); err != nil {
		return err
	}
	s.mu.Lock()
	entry, ok := s.registry.get(name)
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("%w %q", ErrUnknownWindow, name)
	}
	if entry.kind == KindSettings {
		s.mu.Unlock()
		return fmt.Errorf("%w: settings slots are not supported", ErrInvalidState)
	}
	entry.states[slot] = stateJSON
	s.mu.Unlock()
	s.persister.schedule()
	return nil
}

// ListStates returns every live window's slots (window -> slot -> JSON).
func (s *Service) ListStates() map[string]map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	states := make(map[string]map[string]string, len(s.registry.entries))
	for name, entry := range s.registry.entries {
		if entry.kind == KindSettings {
			continue
		}
		states[name] = entry.copyStates()
	}
	return states
}

// ReportViewport records the named window's webview viewport size in CSS
// px. Together with the native bounds it locates the window's content on
// screen for drag hit-testing. Reports from unknown windows (for example a
// window that just closed) are ignored.
func (s *Service) ReportViewport(name string, width, height float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.registry.get(name)
	if !ok {
		return
	}
	entry.viewportWidth = width
	entry.viewportHeight = height
	entry.hasViewport = width > 0 && height > 0
}

// ServiceShutdown flushes the session. Windows closed by the application
// teardown afterwards keep their persisted state.
func (s *Service) ServiceShutdown() error {
	s.shutdownFlag.Store(true)
	s.mu.Lock()
	s.shuttingDown = true
	s.mu.Unlock()
	return s.persister.close()
}

func (s *Service) windowFocused(name string) {
	if name == SettingsWindowName {
		s.reconcileSettingsVisibility(true)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.registry.get(name)
	if !ok || s.shuttingDown {
		return
	}
	entry.hidden = false
	if s.registry.focusedName() == name {
		return
	}
	s.registry.bringToFront(name)
	s.emitWindowsChangedLocked()
}

func (s *Service) windowVisibilityChanged(name string, visible bool) {
	if name == SettingsWindowName {
		s.reconcileSettingsVisibility(false)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.registry.get(name); ok {
		entry.hidden = !visible
	}
}

func (s *Service) windowBoundsChanged(name string, bounds Bounds) {
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return
	}
	s.mu.Lock()
	entry, ok := s.registry.get(name)
	if !ok || s.shuttingDown {
		s.mu.Unlock()
		return
	}
	entry.bounds = &bounds
	s.mu.Unlock()
	if name != MainWindowName {
		s.persister.schedule()
	}
}

// windowClosed removes a closed window, settles drags involving it and
// hands its slots to the remaining windows through windows/closed.
func (s *Service) windowClosed(name string) {
	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return
	}
	entry, ok := s.registry.remove(name)
	if !ok {
		s.mu.Unlock()
		return
	}
	s.settleDragsForClosedWindowLocked(name)
	s.emitter.emit(EventWindowClosed, WindowClosedEvent{
		Name:   entry.name,
		Kind:   entry.kind,
		States: entry.copyStates(),
	})
	s.emitWindowsChangedLocked()
	s.mu.Unlock()
	s.persister.schedule()
}

// snapshotSession captures the persistable state.
func (s *Service) snapshotSession() persistedSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := emptySession()
	for _, name := range s.registry.creationOrder {
		entry := s.registry.entries[name]
		if entry.kind == KindSettings {
			continue
		}
		session.States[name] = entry.copyStates()
		if name == MainWindowName {
			continue
		}
		var bounds *Bounds
		if entry.bounds != nil {
			savedBounds := *entry.bounds
			bounds = &savedBounds
		}
		session.Windows = append(session.Windows, persistedWindow{Name: name, Kind: entry.kind, Bounds: bounds})
	}
	return session
}

func (s *Service) nativeWindowFor(name string) (nativeWindow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nativeWindowLocked(name)
}

func (s *Service) nativeWindowLocked(name string) (nativeWindow, error) {
	entry, ok := s.registry.get(name)
	if !ok {
		return nil, fmt.Errorf("%w %q", ErrUnknownWindow, name)
	}
	if entry.native == nil {
		return nil, fmt.Errorf("window %q has no OS window yet", name)
	}
	return entry.native, nil
}

// refreshBounds reads the current native bounds of the named windows, or of
// every live window when no name is given. Native calls run outside the lock.
func (s *Service) refreshBounds(names ...string) {
	natives := map[string]nativeWindow{}
	s.mu.Lock()
	if len(names) == 0 {
		names = slices.Clone(s.registry.creationOrder)
	}
	for _, name := range names {
		if entry, ok := s.registry.get(name); ok && entry.native != nil {
			natives[name] = entry.native
		}
	}
	s.mu.Unlock()

	refreshed := make(map[string]Bounds, len(natives))
	for name, native := range natives {
		refreshed[name] = native.Bounds()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for name, bounds := range refreshed {
		entry, ok := s.registry.get(name)
		if !ok || bounds.Width <= 0 || bounds.Height <= 0 {
			continue
		}
		entry.bounds = &bounds
	}
}

// clientToGlobalLocked maps a point in the named window's client space to
// global px through the window's content rect.
func (s *Service) clientToGlobalLocked(name string, clientX, clientY float64) (float64, float64, error) {
	entry, ok := s.registry.get(name)
	if !ok {
		return 0, 0, fmt.Errorf("%w %q", ErrUnknownWindow, name)
	}
	content, ok := entry.contentRect()
	if !ok {
		return 0, 0, fmt.Errorf("%w: %q", ErrUnknownGeometry, name)
	}
	return content.X + clientX, content.Y + clientY, nil
}

// tearOffTopLeft places a window's top-left up/left of the global pointer
// so the pointer lands on the window's tab strip.
func tearOffTopLeft(globalX, globalY float64) screenPosition {
	return screenPosition{
		X: int(math.Round(globalX)) - tearOffPointerOffsetX,
		Y: int(math.Round(globalY)) - tearOffPointerOffsetY,
	}
}

// fitInWorkArea moves a window placed at position so that it stays on the
// screen nearest to that point: fully inside the work area when it fits,
// otherwise aligned to the work area's top-left. A tab released near a screen
// edge must not open a window that is mostly off screen.
func (s *Service) fitInWorkArea(position screenPosition, width, height int) screenPosition {
	area, ok := s.host.workAreaNear(position.X, position.Y)
	if !ok {
		return position
	}
	return screenPosition{
		X: clampToSpan(position.X, area.X, area.X+area.Width-width),
		Y: clampToSpan(position.Y, area.Y, area.Y+area.Height-height),
	}
}

// clampToSpan keeps value within [low, high]; when the span is empty (the
// window is larger than the area) it returns low.
func clampToSpan(value, low, high int) int {
	if high < low {
		return low
	}
	return min(max(value, low), high)
}

func (s *Service) newWindowNameLocked() (string, error) {
	random := make([]byte, windowNameRandomBytes)
	for {
		if _, err := rand.Read(random); err != nil {
			return "", fmt.Errorf("generate window name: %w", err)
		}
		name := windowNamePrefix + hex.EncodeToString(random)
		if _, taken := s.registry.get(name); !taken {
			return name, nil
		}
	}
}

func (s *Service) emitWindowsChangedLocked() {
	s.emitter.emit(EventWindowsChanged, WindowsChangedEvent{Windows: s.registry.infos()})
}

func defaultSize(kind Kind) (int, int) {
	if kind == KindPanel {
		return defaultPanelWidth, defaultPanelHeight
	}
	return defaultWorkspaceWidth, defaultWorkspaceHeight
}

func validateSlotState(slot, stateJSON string) error {
	if slot == "" {
		return fmt.Errorf("%w: empty slot name", ErrInvalidState)
	}
	if !json.Valid([]byte(stateJSON)) {
		return fmt.Errorf("%w: slot %q is not valid JSON", ErrInvalidState, slot)
	}
	return nil
}

func cloneStates(states map[string]string) map[string]string {
	if states == nil {
		return map[string]string{}
	}
	return maps.Clone(states)
}
