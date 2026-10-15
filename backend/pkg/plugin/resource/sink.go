package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"time"

	"github.com/tidwall/gjson"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// engineWatchSink implements resource.WatchEventSink on the engine side.
// Routes events through the subscription gate and emits to the frontend via EventEmitter.
// Registry updates and indexer enqueuing happen unconditionally; only the Wails
// emit is gated by subscription status.
type engineWatchSink struct {
	pluginID   string
	ctrl       *controller
	store      registry.Store
	dispatcher *indexer.Dispatcher
}

var _ resource.WatchEventSink = (*engineWatchSink)(nil)

func (s *engineWatchSink) entryFromAddPayload(p resource.WatchAddPayload) registry.ResourceEntry {
	p.Metadata = completeMetadata(p.Metadata, p.Data)
	entry := registry.ResourceEntry{
		PluginID:     s.pluginID,
		ConnectionID: p.Connection,
		ResourceKey:  p.Key,
		ID:           p.ID,
		Namespace:    p.Namespace,
		UID:          p.Metadata.UID,
		Labels:       maps.Clone(p.Metadata.Labels),
		CreatedAt:    time.Time{},
	}
	if p.Metadata.CreatedAt != nil {
		entry.CreatedAt = *p.Metadata.CreatedAt
	}
	return entry
}

func (s *engineWatchSink) entryFromUpdatePayload(p resource.WatchUpdatePayload) registry.ResourceEntry {
	p.Metadata = completeMetadata(p.Metadata, p.Data)
	entry := registry.ResourceEntry{
		PluginID:     s.pluginID,
		ConnectionID: p.Connection,
		ResourceKey:  p.Key,
		ID:           p.ID,
		Namespace:    p.Namespace,
		UID:          p.Metadata.UID,
		Labels:       maps.Clone(p.Metadata.Labels),
		CreatedAt:    time.Time{},
	}
	if p.Metadata.CreatedAt != nil {
		entry.CreatedAt = *p.Metadata.CreatedAt
	}
	return entry
}

func (s *engineWatchSink) OnAdd(p resource.WatchAddPayload) {
	p.PluginID = s.pluginID

	// 1. Registry update (unconditional)
	entry := s.entryFromAddPayload(p)
	old, existed := s.store.Put(entry)

	// 2. Subscription gate — ONLY controls Wails emit
	if s.ctrl.isSubscribed(s.pluginID, p.Connection, p.Key) {
		eventKey := fmt.Sprintf("%s/%s/%s/ADD", s.pluginID, p.Connection, p.Key)
		s.ctrl.emitter.Emit(eventKey, p)
	}

	// 3. Enqueue indexer event (unconditional)
	rawCopy := make(json.RawMessage, len(p.Data))
	copy(rawCopy, p.Data)

	if existed {
		s.dispatcher.Enqueue(indexer.Event{
			Type: indexer.EventUpdate, Entry: entry, Old: old, Raw: rawCopy,
		})
	} else {
		s.dispatcher.Enqueue(indexer.Event{
			Type: indexer.EventAdd, Entry: entry, Old: nil, Raw: rawCopy,
		})
	}
}

func (s *engineWatchSink) OnUpdate(p resource.WatchUpdatePayload) {
	p.PluginID = s.pluginID

	entry := s.entryFromUpdatePayload(p)
	old, _ := s.store.Put(entry)

	if s.ctrl.isSubscribed(s.pluginID, p.Connection, p.Key) {
		eventKey := fmt.Sprintf("%s/%s/%s/UPDATE", s.pluginID, p.Connection, p.Key)
		s.ctrl.emitter.Emit(eventKey, p)
	}

	rawCopy := make(json.RawMessage, len(p.Data))
	copy(rawCopy, p.Data)

	s.dispatcher.Enqueue(indexer.Event{
		Type: indexer.EventUpdate, Entry: entry, Old: old, Raw: rawCopy,
	})
}

func (s *engineWatchSink) OnDelete(p resource.WatchDeletePayload) {
	p.PluginID = s.pluginID

	old, existed := s.store.Delete(s.pluginID, p.Connection, p.Key, p.Namespace, p.ID)

	if s.ctrl.isSubscribed(s.pluginID, p.Connection, p.Key) {
		eventKey := fmt.Sprintf("%s/%s/%s/DELETE", s.pluginID, p.Connection, p.Key)
		s.ctrl.emitter.Emit(eventKey, p)
	}

	if existed && old != nil {
		s.dispatcher.Enqueue(indexer.Event{
			Type: indexer.EventDelete, Entry: *old, Old: nil, Raw: nil,
		})
	}
}

func (s *engineWatchSink) OnStateChange(e resource.WatchStateEvent) {
	// Enrich with plugin identity (Connection is already set by the SDK's
	// connectionEnrichingSink wrapper).
	e.PluginID = s.pluginID

	s.ctrl.logger.Infow(context.Background(), "[watch-state] engine sink received",
		"pluginID", s.pluginID,
		"connection", e.Connection,
		"resourceKey", e.ResourceKey,
		"state", e.State,
		"resourceCount", e.ResourceCount,
	)

	// STATE events always flow regardless of subscription status.
	// Emit per-plugin/connection state event so per-connection hooks can match.
	eventKey := fmt.Sprintf("%s/%s/watch/STATE", s.pluginID, e.Connection)
	s.ctrl.emitter.Emit(eventKey, e)
	// Global event for footer/status bar aggregation.
	s.ctrl.emitter.Emit("watch/STATE", e)
}

// completeMetadata fills metadata the payload lacks from the object's own
// "metadata" block (uid, labels, creationTimestamp), the shape Kubernetes and
// Kubernetes-like objects use. The SDK's gRPC watch messages carry only id,
// namespace and data, so payload metadata set by the plugin never arrives;
// without this, label selectors (Service, NetworkPolicy) match nothing.
func completeMetadata(meta resource.ResourceMetadata, data json.RawMessage) resource.ResourceMetadata {
	if meta.UID != "" && len(meta.Labels) > 0 && meta.CreatedAt != nil {
		return meta
	}
	fields := gjson.GetManyBytes(data, "metadata.uid", "metadata.labels", "metadata.creationTimestamp")

	if meta.UID == "" {
		meta.UID = fields[0].String()
	}
	if len(meta.Labels) == 0 && fields[1].IsObject() {
		labels := make(map[string]string)
		fields[1].ForEach(func(k, v gjson.Result) bool {
			labels[k.String()] = v.String()
			return true
		})
		meta.Labels = labels
	}
	if meta.CreatedAt == nil && fields[2].Exists() {
		if t, err := time.Parse(time.RFC3339, fields[2].String()); err == nil {
			meta.CreatedAt = &t
		}
	}
	return meta
}
