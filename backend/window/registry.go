package window

import "slices"

// windowEntry is the service's view of one live window.
type windowEntry struct {
	name string
	kind Kind
	// native is nil only between registration and OS window creation.
	native nativeWindow
	// viewportWidth and viewportHeight are the webview viewport size in CSS
	// px, valid when hasViewport is set.
	viewportWidth  float64
	viewportHeight float64
	hasViewport    bool
	// hidden windows (hidden or minimised) are never drag targets.
	hidden bool
	// bounds is the last known native frame in global px; nil until known.
	bounds *Bounds
	// states maps slot -> JSON.
	states map[string]string
}

// newWindowEntry builds an entry with no reported viewport; states are
// copied.
func newWindowEntry(name string, kind Kind, native nativeWindow, bounds *Bounds, states map[string]string) *windowEntry {
	return &windowEntry{
		name:           name,
		kind:           kind,
		native:         native,
		viewportWidth:  0,
		viewportHeight: 0,
		hasViewport:    false,
		hidden:         false,
		bounds:         bounds,
		states:         cloneStates(states),
	}
}

// windowRegistry tracks live windows, their creation order and their focus
// order. It is not safe for concurrent use; the Service guards it.
type windowRegistry struct {
	entries map[string]*windowEntry
	// creationOrder lists window names in the order they were registered.
	creationOrder []string
	// focusOrder lists window names, most recently focused first.
	focusOrder []string
}

func newWindowRegistry() *windowRegistry {
	return &windowRegistry{
		entries:       map[string]*windowEntry{},
		creationOrder: []string{},
		focusOrder:    []string{},
	}
}

// add registers a window on top of the focus order.
func (r *windowRegistry) add(entry *windowEntry) {
	r.entries[entry.name] = entry
	r.creationOrder = append(r.creationOrder, entry.name)
	r.focusOrder = append([]string{entry.name}, r.focusOrder...)
}

func (r *windowRegistry) get(name string) (*windowEntry, bool) {
	entry, ok := r.entries[name]
	return entry, ok
}

// remove unregisters a window and returns its entry.
func (r *windowRegistry) remove(name string) (*windowEntry, bool) {
	entry, ok := r.entries[name]
	if !ok {
		return nil, false
	}
	delete(r.entries, name)
	r.creationOrder = slices.DeleteFunc(r.creationOrder, func(candidate string) bool { return candidate == name })
	r.focusOrder = slices.DeleteFunc(r.focusOrder, func(candidate string) bool { return candidate == name })
	return entry, true
}

// bringToFront moves the window to the top of the focus order.
func (r *windowRegistry) bringToFront(name string) {
	if _, ok := r.entries[name]; !ok {
		return
	}
	r.focusOrder = slices.DeleteFunc(r.focusOrder, func(candidate string) bool { return candidate == name })
	r.focusOrder = append([]string{name}, r.focusOrder...)
}

// focusedName returns the most recently focused window.
func (r *windowRegistry) focusedName() string {
	if len(r.focusOrder) == 0 {
		return ""
	}
	return r.focusOrder[0]
}

// infos lists live windows in creation order.
func (r *windowRegistry) infos() []Info {
	focused := r.focusedName()
	infos := make([]Info, 0, len(r.creationOrder))
	for _, name := range r.creationOrder {
		entry := r.entries[name]
		infos = append(infos, Info{Name: name, Kind: entry.kind, Focused: name == focused})
	}
	return infos
}

// contentRect returns the window's webview viewport in global px. The
// viewport sits at the bottom-right of the native frame: menu bars and
// title areas take the space above (and left of) it.
func (entry *windowEntry) contentRect() (screenRect, bool) {
	if entry.bounds == nil || !entry.hasViewport {
		return screenRect{X: 0, Y: 0, Width: 0, Height: 0}, false
	}
	return screenRect{
		X:      float64(entry.bounds.X) + max(0, float64(entry.bounds.Width)-entry.viewportWidth),
		Y:      float64(entry.bounds.Y) + max(0, float64(entry.bounds.Height)-entry.viewportHeight),
		Width:  entry.viewportWidth,
		Height: entry.viewportHeight,
	}, true
}

// topmostAt returns the name of the topmost visible window whose content
// rect contains the global point, or "" when no window does.
func (r *windowRegistry) topmostAt(globalX, globalY float64) string {
	for _, name := range r.focusOrder {
		entry := r.entries[name]
		if entry.hidden {
			continue
		}
		if content, ok := entry.contentRect(); ok && content.containsPoint(globalX, globalY) {
			return name
		}
	}
	return ""
}

// dropTargetAt returns the window that should receive a drag from source at
// the global point. The source window occludes everything below it, so a
// point over the source yields "".
func (r *windowRegistry) dropTargetAt(source string, globalX, globalY float64) string {
	topmost := r.topmostAt(globalX, globalY)
	if topmost == source {
		return ""
	}
	if entry, ok := r.entries[topmost]; ok && entry.kind == KindSettings {
		return ""
	}
	return topmost
}

// copyStates returns a copy of the window's slots.
func (entry *windowEntry) copyStates() map[string]string {
	return cloneStates(entry.states)
}
