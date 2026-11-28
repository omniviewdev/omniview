package settings

import (
	"context"
	"errors"
)

// AppearanceChangedEvent carries a revision, never a category map. Each window
// reads its own effective material, which can differ from the one in its peers.
const AppearanceChangedEvent = "appearance/changed"

// AppearanceRequest is the complete input to the native material controller.
// Surface opacity is deliberately absent: changing tint never touches a native view.
type AppearanceRequest struct {
	WindowMaterial string
	GlassStyle     string
	Theme          string
}

// AppearanceMaterial describes what this window can actually render. Capabilities
// do not replace the user's portable preferences when a platform falls back.
type AppearanceMaterial struct {
	Effective    string `json:"effective"`
	Glass        bool   `json:"glass"`
	Translucent  bool   `json:"translucent"`
	ForcedOpaque bool   `json:"forcedOpaque"`
	Reason       string `json:"reason"`
}

type AppearancePreferences struct {
	WindowMaterial string `json:"windowMaterial"`
	GlassStyle     string `json:"glassStyle"`
	ChromeOpacity  int    `json:"chromeOpacity"`
	ContentOpacity int    `json:"contentOpacity"`
	MenuOpacity    int    `json:"menuOpacity"`
	SheetOpacity   int    `json:"sheetOpacity"`
	Theme          string `json:"theme"`
	Density        string `json:"density"`
	TextSize       string `json:"textSize"`
	Motion         string `json:"motion"`
}

type AppearanceSnapshot struct {
	Revision    uint64                `json:"revision"`
	Preferences AppearancePreferences `json:"preferences"`
	Material    AppearanceMaterial    `json:"material"`
}

type appearanceProjection struct {
	preferences  AppearancePreferences
	revision     uint64
	apply        func(AppearanceRequest)
	presentation func(context.Context) AppearanceMaterial
	notify       func(uint64)
	transition   chan struct{}
}

// appearancePreferences takes the service's validated, SDK-normalized category,
// never a UI proposal. Explicitly project public scalars; do not serialize the map.
func appearancePreferences(values map[string]any) AppearancePreferences {
	text := func(key string) string { v, _ := values[key].(string); return v }
	number := func(key string) int { v, _ := values[key].(int); return v }
	return AppearancePreferences{
		WindowMaterial: text("windowMaterial"), GlassStyle: text("glassStyle"),
		ChromeOpacity: number("chromeOpacity"), ContentOpacity: number("contentOpacity"),
		MenuOpacity: number("menuOpacity"), SheetOpacity: number("sheetOpacity"),
		Theme: text("theme"), Density: text("density"), TextSize: text("textSize"), Motion: text("motion"),
	}
}

func (p AppearancePreferences) request() AppearanceRequest {
	return AppearanceRequest{WindowMaterial: p.WindowMaterial, GlassStyle: p.GlassStyle, Theme: p.Theme}
}

// SetupAppearance seeds the next build's material controller from durable settings
// after hydration and before creating any windows or accepting commits.
func (s *Service) SetupAppearance(
	apply func(AppearanceRequest), presentation func(context.Context) AppearanceMaterial, notify func(uint64),
) {
	preferences := appearancePreferences(s.CategoryValues("appearance"))
	s.mu.Lock()
	s.appearance = &appearanceProjection{
		preferences: preferences, revision: 1, apply: apply, presentation: presentation, notify: notify, transition: nil,
	}
	s.mu.Unlock()
	apply(preferences.request())
}

// ApplyAppearance is a committed effect, not a writer. The settings service already
// serializes host commits; never hold a projection lock across native UI dispatch.
func (s *Service) ApplyAppearance(values map[string]any) {
	s.mu.Lock()
	p := s.appearance
	if p == nil {
		s.mu.Unlock()
		return
	}
	next := appearancePreferences(values)
	previous := p.preferences
	if next == previous {
		s.mu.Unlock()
		return
	}
	if request := next.request(); request != previous.request() {
		// Only material transitions cross the UI thread. A concurrent reader waits
		// for the same publication rather than pairing the old backing with a new revision.
		p.transition = make(chan struct{})
		s.mu.Unlock()
		p.apply(request)
		s.mu.Lock()
		close(p.transition)
		p.transition = nil
	}
	p.preferences = next
	p.revision++
	revision, notify := p.revision, p.notify
	s.mu.Unlock()
	notify(revision)
}

// AppearanceChanged invalidates cached projections after a native window changes
// readiness, material or accessibility state. It never rewrites a preference.
func (s *Service) AppearanceChanged() {
	s.mu.Lock()
	if s.appearance == nil || s.appearance.transition != nil {
		s.mu.Unlock()
		return
	}
	s.appearance.revision++
	revision, notify := s.appearance.revision, s.appearance.notify
	s.mu.Unlock()
	notify(revision)
}

func (s *Service) getAppearance(ctx context.Context) (AppearanceSnapshot, error) {
	for {
		s.mu.RLock()
		p := s.appearance
		if p == nil {
			s.mu.RUnlock()
			return AppearanceSnapshot{}, errors.New("window appearance is unavailable in this build")
		}
		prefs, revision, transition := p.preferences, p.revision, p.transition
		s.mu.RUnlock()
		if transition != nil {
			select {
			case <-ctx.Done():
				return AppearanceSnapshot{}, ctx.Err()
			case <-transition:
				continue
			}
		}

		// Consult the caller's cached presentation without holding a service lock.
		material := p.presentation(ctx)
		s.mu.RLock()
		current := p.revision == revision && p.transition == nil
		s.mu.RUnlock()
		if current {
			return AppearanceSnapshot{Revision: revision, Preferences: prefs, Material: material}, nil
		}
	}
}
