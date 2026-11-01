package window

import (
	"fmt"
	"strings"
)

func (s *Service) shutdownStarted() bool {
	return s.shutdownFlag.Load()
}

// OpenSettings shows the single settings window. Empty targets preserve its location.
func (s *Service) OpenSettings(target string) (string, error) {
	if !validSettingsTarget(target) {
		return "", fmt.Errorf("invalid settings target")
	}
	s.settingsOps.Lock()
	defer s.settingsOps.Unlock()
	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return "", fmt.Errorf("application is shutting down")
	}
	entry, exists := s.registry.get(SettingsWindowName)
	s.settingsRevision++
	s.settingsNativeBusy = true
	if target != "" {
		s.settingsState.RequestID++
		s.settingsState.Target = target
	} else if s.settingsState.Target == "" {
		s.settingsState.RequestID++
		s.settingsState.Target = "/settings?category=general"
	}
	s.settingsState.Visible = true
	if !exists {
		entry = newWindowEntry(SettingsWindowName, KindSettings, nil, nil, nil)
		s.registry.add(entry)
	}
	s.emitter.emit(EventSettingsState, s.settingsState)
	native := entry.native
	s.mu.Unlock()
	if native == nil {
		spec := windowSpec{Name: SettingsWindowName, Kind: KindSettings, Width: 1060, Height: 640}
		if area, ok := s.host.workAreaNear(0, 0); ok {
			spec.Width = min(spec.Width, area.Width)
			spec.Height = min(spec.Height, area.Height)
			spec.Position = &screenPosition{X: area.X + (area.Width-spec.Width)/2, Y: area.Y + (area.Height-spec.Height)/2}
		}
		s.createNativeWindow(spec)
		s.mu.Lock()
		native = entry.native
		s.emitWindowsChangedLocked()
		s.mu.Unlock()
	}
	native.Activate()
	s.finishSettingsNativeOperation(true)
	return SettingsWindowName, nil
}

// HideSettings keeps the native window and its frontend drafts alive.
func (s *Service) HideSettings() error {
	s.settingsOps.Lock()
	defer s.settingsOps.Unlock()
	s.mu.Lock()
	entry, exists := s.registry.get(SettingsWindowName)
	if !exists {
		s.mu.Unlock()
		return nil
	}
	native := entry.native
	s.settingsRevision++
	s.settingsNativeBusy = true
	entry.hidden = true
	s.settingsState.Visible = false
	s.emitter.emit(EventSettingsState, s.settingsState)
	s.mu.Unlock()
	if native != nil {
		native.Hide()
	}
	s.finishSettingsNativeOperation(false)
	return nil
}

// GetSettingsState returns the current routing request and native visibility.
func (s *Service) GetSettingsState() SettingsState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settingsState
}

// SetSettingsLocation records only navigation accepted for the current request.
func (s *Service) SetSettingsLocation(target string, requestID uint64) error {
	if !validSettingsTarget(target) {
		return fmt.Errorf("invalid settings target")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if requestID == s.settingsState.RequestID && target != "" {
		s.settingsState.Target = target
	}
	return nil
}

func validSettingsTarget(target string) bool {
	if target == "" {
		return true
	}
	rest, ok := strings.CutPrefix(target, "/settings")
	if !ok {
		return false
	}
	rest = strings.TrimPrefix(rest, "/")
	return rest == "" || rest[0] == '?' || rest[0] == '#'
}

// finishSettingsNativeOperation publishes the completed native operation. Native
// callbacks during the operation are ignored rather than re-entering its lock.
func (s *Service) finishSettingsNativeOperation(visible bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.settingsNativeBusy = false
	if entry, ok := s.registry.get(SettingsWindowName); ok {
		entry.hidden = !visible
		if visible && s.registry.focusedName() != SettingsWindowName {
			s.registry.bringToFront(SettingsWindowName)
			s.emitWindowsChangedLocked()
		}
	}
}

// Native events can arrive after a later hide/show operation. Read actual
// visibility outside mu and fence the result against concurrent operations.
func (s *Service) reconcileSettingsVisibility(focused bool) {
	s.mu.Lock()
	entry, ok := s.registry.get(SettingsWindowName)
	if !ok || entry.native == nil || s.settingsNativeBusy || s.shuttingDown {
		s.mu.Unlock()
		return
	}
	native, revision := entry.native, s.settingsRevision
	s.mu.Unlock()
	visible := native.IsVisible()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settingsNativeBusy || revision != s.settingsRevision || s.shuttingDown {
		return
	}
	entry.hidden = !visible
	if s.settingsState.Visible != visible {
		s.settingsState.Visible = visible
		s.emitter.emit(EventSettingsState, s.settingsState)
	}
	if focused && visible && s.registry.focusedName() != SettingsWindowName {
		s.registry.bringToFront(SettingsWindowName)
		s.emitWindowsChangedLocked()
	}
}
