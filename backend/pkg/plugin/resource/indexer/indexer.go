package indexer

import (
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
)

// ResourceIndexer processes resource events to build derived indexes.
type ResourceIndexer interface {
	Name() string
	OnAdd(entry registry.ResourceEntry, raw json.RawMessage)
	OnUpdate(old registry.ResourceEntry, new_ registry.ResourceEntry, raw json.RawMessage)
	OnDelete(entry registry.ResourceEntry)
}

type EventType int

const (
	EventAdd EventType = iota
	EventUpdate
	EventDelete
)

type Event struct {
	Type  EventType
	Entry registry.ResourceEntry
	Old   *registry.ResourceEntry
	Raw   json.RawMessage
}
