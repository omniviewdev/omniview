package registry

import (
	"maps"
	"slices"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type projectionKey struct{ Plugin, Connection, Address string }
type connectionKey struct{ Plugin, Connection string }
type labelKey struct{ Name, Value string }

// MemoryStore keeps equal addresses isolated by route and plugin ownership.
// Compound struct keys preserve opaque IDs, including separators and Unicode.
type MemoryStore struct {
	mu      sync.RWMutex
	entries map[projectionKey]ResourceEntry
	byConn  map[connectionKey]map[projectionKey]struct{}
	byLabel map[labelKey]map[projectionKey]struct{}
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{entries: make(map[projectionKey]ResourceEntry), byConn: make(map[connectionKey]map[projectionKey]struct{}), byLabel: make(map[labelKey]map[projectionKey]struct{})}
}

func cloneEntry(entry ResourceEntry) ResourceEntry {
	entry.Labels = maps.Clone(entry.Labels)
	entry.Reference.Address.Scope = slices.Clone(entry.Reference.Address.Scope)
	if entry.Reference.Incarnation != nil {
		incarnation := *entry.Reference.Incarnation
		entry.Reference.Incarnation = &incarnation
	}
	return entry
}

func entryProjection(entry ResourceEntry) (projectionKey, bool) {
	key := entry.EntryKey()
	return projectionKey{entry.PluginID, entry.Route.Connection, key}, key != "" && entry.PluginID != "" && entry.Route.Connection != ""
}

func (s *MemoryStore) Put(entry ResourceEntry) (*ResourceEntry, bool) { return s.put(entry, false) }
func (s *MemoryStore) PutIfAbsent(entry ResourceEntry) (*ResourceEntry, bool) {
	return s.put(entry, true)
}

func (s *MemoryStore) put(entry ResourceEntry, absentOnly bool) (*ResourceEntry, bool) {
	key, valid := entryProjection(entry)
	if !valid {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var old *ResourceEntry
	if previous, exists := s.entries[key]; exists {
		copy := cloneEntry(previous)
		old = &copy
		if absentOnly {
			return old, true
		}
		s.removeLabels(key, previous.Labels)
	}
	entry = cloneEntry(entry)
	s.entries[key] = entry
	connection := connectionKey{entry.PluginID, entry.Route.Connection}
	if s.byConn[connection] == nil {
		s.byConn[connection] = make(map[projectionKey]struct{})
	}
	s.byConn[connection][key] = struct{}{}
	for name, value := range entry.Labels {
		label := labelKey{name, value}
		if s.byLabel[label] == nil {
			s.byLabel[label] = make(map[projectionKey]struct{})
		}
		s.byLabel[label][key] = struct{}{}
	}
	return old, old != nil
}

func (s *MemoryStore) Get(pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute) (*ResourceEntry, bool) {
	key, valid := entryProjection(ResourceEntry{PluginID: pluginID, Reference: reference, Route: route})
	if !valid {
		return nil, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, exists := s.entries[key]
	if !exists {
		return nil, false
	}
	// Incarnation is an optional precondition, not address identity.
	if reference.Incarnation != nil && (entry.Reference.Incarnation == nil || *reference.Incarnation != *entry.Reference.Incarnation) {
		return nil, false
	}
	copy := cloneEntry(entry)
	return &copy, true
}

func (s *MemoryStore) Delete(pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute) (*ResourceEntry, bool) {
	key, valid := entryProjection(ResourceEntry{PluginID: pluginID, Reference: reference, Route: route})
	if !valid {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, exists := s.entries[key]
	if !exists {
		return nil, false
	}
	if reference.Incarnation != nil && (entry.Reference.Incarnation == nil || *reference.Incarnation != *entry.Reference.Incarnation) {
		return nil, false
	}
	s.remove(key, entry)
	copy := cloneEntry(entry)
	return &copy, true
}

func (s *MemoryStore) removeLabels(key projectionKey, labels map[string]string) {
	for name, value := range labels {
		label := labelKey{name, value}
		delete(s.byLabel[label], key)
		if len(s.byLabel[label]) == 0 {
			delete(s.byLabel, label)
		}
	}
}

func (s *MemoryStore) remove(key projectionKey, entry ResourceEntry) {
	delete(s.entries, key)
	s.removeLabels(key, entry.Labels)
	connection := connectionKey{entry.PluginID, entry.Route.Connection}
	delete(s.byConn[connection], key)
	if len(s.byConn[connection]) == 0 {
		delete(s.byConn, connection)
	}
}

func (s *MemoryStore) DeleteByConnection(pluginID, connectionID string) []ResourceEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := s.byConn[connectionKey{pluginID, connectionID}]
	removed := make([]ResourceEntry, 0, len(keys))
	for key := range keys {
		entry := s.entries[key]
		removed = append(removed, cloneEntry(entry))
		s.remove(key, entry)
	}
	return removed
}

func (s *MemoryStore) ScanByLabel(pluginID, connectionID, resourceType string, selector map[string]string) []ResourceEntry {
	if len(selector) == 0 {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var candidates map[projectionKey]struct{}
	for name, value := range selector {
		set := s.byLabel[labelKey{name, value}]
		if len(set) == 0 {
			return nil
		}
		if candidates == nil || len(set) < len(candidates) {
			candidates = set
		}
	}
	var result []ResourceEntry
	for key := range candidates {
		entry := s.entries[key]
		if key.Plugin != pluginID || key.Connection != connectionID || entry.Reference.Address.Type != resourceType {
			continue
		}
		matches := true
		for name, value := range selector {
			if actual, ok := entry.Labels[name]; !ok || actual != value {
				matches = false
				break
			}
		}
		if matches {
			result = append(result, cloneEntry(entry))
		}
	}
	return result
}

func (s *MemoryStore) ScanByResourceKey(pluginID, connectionID, resourceType string) []ResourceEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []ResourceEntry
	for key := range s.byConn[connectionKey{pluginID, connectionID}] {
		entry := s.entries[key]
		if entry.Reference.Address.Type == resourceType {
			result = append(result, cloneEntry(entry))
		}
	}
	return result
}
