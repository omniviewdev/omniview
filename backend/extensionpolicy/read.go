package extensionpolicy

import "slices"

// AllowsRead checks a single exact native binding without cloning the profile.
// want.Fields contains the comparison fields declared and requested on this
// signed edge. Uncompared scalar requests need not be granted for a read.
// Never register Store or this method with the renderer.
func (s *Store) AllowsRead(want Grant) bool {
	if s == nil || want.Read == "" || want.Continuity == "" {
		return false
	}
	s.mu.Lock()
	if s.closed || s.override || s.watch == nil {
		s.mu.Unlock()
		return false
	}
	// A native call can race the filesystem notification. Inspect the current
	// private object; an unreadable, superseded or unobserved file cannot be
	// authorized by an older snapshot. Only Snapshot reattaches a lost watch.
	change := s.refreshLocked(nil)
	allowed := s.state.allowsRead(want) && s.watch != nil && !s.watch.lost.Load()
	s.mu.Unlock()
	s.notify(change)
	return allowed
}

func (s *Snapshot) allowsRead(want Grant) bool {
	b := want.binding()
	if !s.Known || s.denies(b) {
		return false
	}
	i, found := slices.BinarySearchFunc(s.Grants, b, func(g Grant, b Binding) int {
		return byBinding(g.binding(), b)
	})
	if !found {
		return false
	}
	g := &s.Grants[i]
	if g.OwnerPin != want.OwnerPin || g.ContributorPin != want.ContributorPin || g.Contract != want.Contract ||
		g.Read != want.Read || g.Continuity != want.Continuity {
		return false
	}
	for _, field := range want.Fields {
		if _, ok := slices.BinarySearch(g.Fields, field); !ok {
			return false
		}
	}
	return true
}
