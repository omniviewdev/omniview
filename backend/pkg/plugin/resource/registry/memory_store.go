package registry

import (
	"maps"
	"sync"
)

// MemoryStore is the in-memory implementation of RegistryStore.
// Uses a two-level map: entryKey → ResourceEntry for O(1) lookups,
// plus a connection index for O(entries-in-connection) bulk deletes.
type MemoryStore struct {
	mu      sync.RWMutex
	entries map[string]ResourceEntry
	byConn  map[string]map[string]struct{}  // "pluginID/connectionID" → set of entryKeys
	byLabel map[string]map[string]struct{}  // "labelKey=labelValue" → set of entryKeys
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		entries: make(map[string]ResourceEntry),
		byConn:  make(map[string]map[string]struct{}),
		byLabel: make(map[string]map[string]struct{}),
	}
}

func connKey(pluginID, connectionID string) string {
	return pluginID + "/" + connectionID
}

func (s *MemoryStore) Put(entry ResourceEntry) (old *ResourceEntry, existed bool) {
	key := entry.EntryKey()
	ck := connKey(entry.PluginID, entry.ConnectionID)

	s.mu.Lock()
	defer s.mu.Unlock()

	if prev, ok := s.entries[key]; ok {
		prev.Labels = maps.Clone(prev.Labels)
		old = &prev
		existed = true
		s.removeLabelIndex(key, s.entries[key].Labels)
	}

	entry.Labels = maps.Clone(entry.Labels)
	s.entries[key] = entry

	if s.byConn[ck] == nil {
		s.byConn[ck] = make(map[string]struct{})
	}
	s.byConn[ck][key] = struct{}{}

	s.addLabelIndex(key, entry.Labels)

	return old, existed
}

func (s *MemoryStore) PutIfAbsent(entry ResourceEntry) (existing *ResourceEntry, loaded bool) {
	key := entry.EntryKey()

	s.mu.Lock()
	defer s.mu.Unlock()

	if prev, ok := s.entries[key]; ok {
		prev.Labels = maps.Clone(prev.Labels)
		return &prev, true
	}

	ck := connKey(entry.PluginID, entry.ConnectionID)
	entry.Labels = maps.Clone(entry.Labels)
	s.entries[key] = entry

	if s.byConn[ck] == nil {
		s.byConn[ck] = make(map[string]struct{})
	}
	s.byConn[ck][key] = struct{}{}
	s.addLabelIndex(key, entry.Labels)

	return nil, false
}

func (s *MemoryStore) Get(pluginID, connectionID, resourceKey, namespace, id string) (*ResourceEntry, bool) {
	key := (ResourceEntry{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, Namespace: namespace, ID: id,
	}).EntryKey()

	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.entries[key]
	if !ok {
		return nil, false
	}
	entry.Labels = maps.Clone(entry.Labels)
	return &entry, true
}

func (s *MemoryStore) Delete(pluginID, connectionID, resourceKey, namespace, id string) (*ResourceEntry, bool) {
	key := (ResourceEntry{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, Namespace: namespace, ID: id,
	}).EntryKey()

	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.entries[key]
	if !ok {
		return nil, false
	}

	delete(s.entries, key)
	s.removeLabelIndex(key, entry.Labels)

	ck := connKey(pluginID, connectionID)
	if set, ok := s.byConn[ck]; ok {
		delete(set, key)
		if len(set) == 0 {
			delete(s.byConn, ck)
		}
	}

	entry.Labels = maps.Clone(entry.Labels)
	return &entry, true
}

func (s *MemoryStore) DeleteByConnection(pluginID, connectionID string) []ResourceEntry {
	ck := connKey(pluginID, connectionID)

	s.mu.Lock()
	defer s.mu.Unlock()

	keys, ok := s.byConn[ck]
	if !ok {
		return nil
	}

	removed := make([]ResourceEntry, 0, len(keys))
	for key := range keys {
		if entry, ok := s.entries[key]; ok {
			s.removeLabelIndex(key, entry.Labels)
			delete(s.entries, key)
			entry.Labels = maps.Clone(entry.Labels)
			removed = append(removed, entry)
		}
	}
	delete(s.byConn, ck)

	return removed
}

func (s *MemoryStore) addLabelIndex(entryKey string, labels map[string]string) {
	for k, v := range labels {
		lk := k + "=" + v
		if s.byLabel[lk] == nil {
			s.byLabel[lk] = make(map[string]struct{})
		}
		s.byLabel[lk][entryKey] = struct{}{}
	}
}

func (s *MemoryStore) removeLabelIndex(entryKey string, labels map[string]string) {
	for k, v := range labels {
		lk := k + "=" + v
		if set, ok := s.byLabel[lk]; ok {
			delete(set, entryKey)
			if len(set) == 0 {
				delete(s.byLabel, lk)
			}
		}
	}
}

func (s *MemoryStore) ScanByLabel(pluginID, connectionID, resourceKey string, selector map[string]string) []ResourceEntry {
	if len(selector) == 0 {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var candidates map[string]struct{}
	for k, v := range selector {
		lk := k + "=" + v
		set, ok := s.byLabel[lk]
		if !ok {
			return nil
		}
		if candidates == nil {
			candidates = make(map[string]struct{}, len(set))
			for key := range set {
				candidates[key] = struct{}{}
			}
		} else {
			for key := range candidates {
				if _, ok := set[key]; !ok {
					delete(candidates, key)
				}
			}
		}
		if len(candidates) == 0 {
			return nil
		}
	}

	prefix := pluginID + "/" + connectionID + "/" + resourceKey + "/"
	var result []ResourceEntry
	for key := range candidates {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			if entry, ok := s.entries[key]; ok {
				entry.Labels = maps.Clone(entry.Labels)
				result = append(result, entry)
			}
		}
	}
	return result
}

func (s *MemoryStore) ScanByResourceKey(pluginID, connectionID, resourceKey string) []ResourceEntry {
	prefix := pluginID + "/" + connectionID + "/" + resourceKey + "/"

	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []ResourceEntry
	for key, entry := range s.entries {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			entry.Labels = maps.Clone(entry.Labels)
			result = append(result, entry)
		}
	}
	return result
}
