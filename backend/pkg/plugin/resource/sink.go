package resource

import (
	"context"
	"fmt"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// engineWatchSink implements resource.WatchEventSink on the engine side.
// Routes events through the subscription gate and emits to the frontend via EventEmitter.
type engineWatchSink struct {
	pluginID string
	ctrl     *controller
}

var _ resource.WatchEventSink = (*engineWatchSink)(nil)

func (s *engineWatchSink) OnAdd(p resource.WatchAddPayload) {
	p.PluginID = s.pluginID
	if !s.ctrl.isSubscribed(s.pluginID, p.Connection, p.Key) {
		return
	}
	eventKey := fmt.Sprintf("%s/%s/%s/ADD", s.pluginID, p.Connection, p.Key)
	s.ctrl.emitter.Emit(eventKey, p)
}

func (s *engineWatchSink) OnUpdate(p resource.WatchUpdatePayload) {
	p.PluginID = s.pluginID
	if !s.ctrl.isSubscribed(s.pluginID, p.Connection, p.Key) {
		return
	}
	eventKey := fmt.Sprintf("%s/%s/%s/UPDATE", s.pluginID, p.Connection, p.Key)
	s.ctrl.emitter.Emit(eventKey, p)
}

func (s *engineWatchSink) OnDelete(p resource.WatchDeletePayload) {
	p.PluginID = s.pluginID
	if !s.ctrl.isSubscribed(s.pluginID, p.Connection, p.Key) {
		return
	}
	eventKey := fmt.Sprintf("%s/%s/%s/DELETE", s.pluginID, p.Connection, p.Key)
	s.ctrl.emitter.Emit(eventKey, p)
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
