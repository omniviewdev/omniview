// Package window owns the application's OS windows: the window registry,
// per-window frontend state slots, cross-window tab drag coordination and
// session persistence. The frontend reaches it through the bound Service.
package window

import (
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// MainWindowName is the name of the first application window. It always
// exists, hides instead of closing, and is never torn down by the service.
const MainWindowName = "main"

// SettingsWindowName identifies the single, non-restorable settings window.
const SettingsWindowName = "settings"

// Kind selects which shell a window renders.
type Kind string

const (
	// KindWorkspace renders the full shell (header, rail, page tabs, panes,
	// bottom drawer, footer).
	KindWorkspace Kind = "workspace"
	// KindPanel renders only a drawer tab strip and the drawer tab content.
	KindPanel Kind = "panel"
	// KindSettings renders the compact settings shell.
	KindSettings Kind = "settings"
)

// isValid reports whether k is one of the known window kinds.
func (k Kind) isValid() bool {
	return k == KindWorkspace || k == KindPanel || k == KindSettings
}

// screenRect is a rectangle in global screen px.
type screenRect struct {
	X      float64
	Y      float64
	Width  float64
	Height float64
}

// containsPoint reports whether the global point lies inside the rectangle.
// The right and bottom edges are exclusive.
func (r screenRect) containsPoint(globalX, globalY float64) bool {
	return globalX >= r.X && globalX < r.X+r.Width &&
		globalY >= r.Y && globalY < r.Y+r.Height
}

// Info describes one live window.
type Info struct {
	Name string `json:"name"`
	Kind Kind   `json:"kind"`
	// Focused is true for the most recently focused window.
	Focused bool `json:"focused"`
}

// SettingsState is the backend-owned location and visibility of settings.
type SettingsState struct {
	RequestID uint64 `json:"requestId"`
	Target    string `json:"target"`
	Visible   bool   `json:"visible"`
}

// OpenRequest describes a window to open.
type OpenRequest struct {
	Kind Kind `json:"kind"`
	// InitialState is the opaque per-slot state handed to the new window
	// before it loads (same format as SaveState slots).
	InitialState map[string]string `json:"initialState"`
	// When HasPosition is set the new window's top-left is placed near the
	// pointer at (ClientX, ClientY) in AnchorWindow's client space.
	AnchorWindow string  `json:"anchorWindow"`
	ClientX      float64 `json:"clientX"`
	ClientY      float64 `json:"clientY"`
	HasPosition  bool    `json:"hasPosition"`
	// Width and Height of the new window; 0 selects the kind's default.
	Width  int `json:"width"`
	Height int `json:"height"`
}

// DragBegin starts a cross-window tab drag session.
type DragBegin struct {
	SessionID    string `json:"sessionId"`
	SourceWindow string `json:"sourceWindow"`
	DragType     string `json:"dragType"`
	// Payload is the JSON of the base-ui TabDragPayload; it is forwarded to
	// target windows verbatim.
	Payload string `json:"payload"`
}

// DropResult is the outcome of EndDrag.
type DropResult struct {
	Accepted         bool   `json:"accepted"`
	TargetWindow     string `json:"targetWindow"`
	TargetInstanceID string `json:"targetInstanceId"`
}

// Errors returned by the service.
var (
	ErrUnknownWindow      = errors.New("unknown window")
	ErrInvalidKind        = errors.New("invalid window kind")
	ErrMainWindowClose    = errors.New("the main window cannot be closed")
	ErrInvalidState       = errors.New("invalid window state")
	ErrInvalidDrag        = errors.New("invalid drag session")
	ErrUnknownDragSession = errors.New("unknown drag session")
	// ErrUnknownGeometry means a window has no native bounds or reported
	// viewport yet, so client coordinates cannot be mapped to the screen.
	ErrUnknownGeometry = errors.New("window geometry unknown")
)

// Event names emitted by the service. Every payload either carries a target
// window name or is meant for all windows.
const (
	EventWindowsChanged = "windows/changed"
	EventSettingsState  = "settings/state"
	EventWindowClosed   = "windows/closed"
	EventDragBegin      = "windows/drag/begin"
	EventDragHover      = "windows/drag/hover"
	EventDragLeave      = "windows/drag/leave"
	EventDragDrop       = "windows/drag/drop"
	EventDragEnd        = "windows/drag/end"
)

// WindowsChangedEvent is the payload of EventWindowsChanged.
type WindowsChangedEvent struct {
	Windows []Info `json:"windows"`
}

// WindowClosedEvent is the payload of EventWindowClosed. States holds the
// closed window's last saved slots (slot -> JSON).
type WindowClosedEvent struct {
	Name   string            `json:"name"`
	Kind   Kind              `json:"kind"`
	States map[string]string `json:"states"`
}

// DragBeginEvent is the payload of EventDragBegin; every window reports a
// fresh viewport in response.
type DragBeginEvent struct {
	SessionID    string `json:"sessionId"`
	SourceWindow string `json:"sourceWindow"`
	DragType     string `json:"dragType"`
}

// DragPointerEvent is the payload of EventDragHover and EventDragDrop. The
// pointer is in the target window's client space.
type DragPointerEvent struct {
	SessionID    string `json:"sessionId"`
	TargetWindow string `json:"targetWindow"`
	// Payload is DragBegin.Payload verbatim (JSON of TabDragPayload).
	Payload string  `json:"payload"`
	ClientX float64 `json:"clientX"`
	ClientY float64 `json:"clientY"`
}

// DragLeaveEvent is the payload of EventDragLeave.
type DragLeaveEvent struct {
	SessionID    string `json:"sessionId"`
	TargetWindow string `json:"targetWindow"`
}

// DragEndEvent is the payload of EventDragEnd; all windows clear remote
// drag state for the session.
type DragEndEvent struct {
	SessionID string `json:"sessionId"`
}

func init() {
	application.RegisterEvent[WindowsChangedEvent](EventWindowsChanged)
	application.RegisterEvent[SettingsState](EventSettingsState)
	application.RegisterEvent[WindowClosedEvent](EventWindowClosed)
	application.RegisterEvent[DragBeginEvent](EventDragBegin)
	application.RegisterEvent[DragPointerEvent](EventDragHover)
	application.RegisterEvent[DragLeaveEvent](EventDragLeave)
	application.RegisterEvent[DragPointerEvent](EventDragDrop)
	application.RegisterEvent[DragEndEvent](EventDragEnd)
}
