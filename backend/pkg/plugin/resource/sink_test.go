package resource

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func newSinkTestSetup(t *testing.T) (*engineWatchSink, *controller, *recordingEmitter) {
	t.Helper()
	ctrl, emitter := newTestControllerWithEmitter(t)
	sink := &engineWatchSink{pluginID: "plugin-a", ctrl: ctrl}
	return sink, ctrl, emitter
}

func TestSink_OnAdd_Subscribed_Emits(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	events := emitter.EventsWithKey("ADD")
	assert.Len(t, events, 1)
}

func TestSink_OnAdd_NotSubscribed_Suppressed(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	events := emitter.EventsWithKey("ADD")
	assert.Empty(t, events)
}

func TestSink_OnAdd_SetsPluginID(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods"})

	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	payload, ok := ev.Data.(resource.WatchAddPayload)
	assert.True(t, ok)
	assert.Equal(t, "plugin-a", payload.PluginID)
}

func TestSink_OnUpdate_Subscribed_Emits(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnUpdate(resource.WatchUpdatePayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	events := emitter.EventsWithKey("UPDATE")
	assert.Len(t, events, 1)
}

func TestSink_OnUpdate_NotSubscribed_Suppressed(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnUpdate(resource.WatchUpdatePayload{Connection: "conn-1", Key: "pods"})

	events := emitter.EventsWithKey("UPDATE")
	assert.Empty(t, events)
}

func TestSink_OnUpdate_SetsPluginID(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnUpdate(resource.WatchUpdatePayload{Connection: "conn-1", Key: "pods"})

	ev := emitter.WaitForEvent(t, "UPDATE", time.Second)
	payload, ok := ev.Data.(resource.WatchUpdatePayload)
	assert.True(t, ok)
	assert.Equal(t, "plugin-a", payload.PluginID)
}

func TestSink_OnDelete_Subscribed_Emits(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnDelete(resource.WatchDeletePayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	events := emitter.EventsWithKey("DELETE")
	assert.Len(t, events, 1)
}

func TestSink_OnDelete_NotSubscribed_Suppressed(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnDelete(resource.WatchDeletePayload{Connection: "conn-1", Key: "pods"})

	events := emitter.EventsWithKey("DELETE")
	assert.Empty(t, events)
}

func TestSink_OnDelete_SetsPluginID(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnDelete(resource.WatchDeletePayload{Connection: "conn-1", Key: "pods"})

	ev := emitter.WaitForEvent(t, "DELETE", time.Second)
	payload, ok := ev.Data.(resource.WatchDeletePayload)
	assert.True(t, ok)
	assert.Equal(t, "plugin-a", payload.PluginID)
}

func TestSink_OnStateChange_AlwaysEmits(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)
	// No subscription — STATE should still flow.

	sink.OnStateChange(resource.WatchStateEvent{Connection: "conn-1", ResourceKey: "pods", State: resource.WatchStateSynced})

	events := emitter.EventsWithKey("STATE")
	assert.Len(t, events, 2) // per-plugin/connection + global
}

func TestSink_OnStateChange_EmitsPerPluginConnection(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnStateChange(resource.WatchStateEvent{Connection: "conn-1", ResourceKey: "pods", State: resource.WatchStateSynced})

	// Key format: ${pluginID}/${connectionID}/watch/STATE
	events := emitter.EventsWithKey("plugin-a/conn-1/watch/STATE")
	assert.Len(t, events, 1)
}

func TestSink_OnStateChange_EmitsGlobal(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnStateChange(resource.WatchStateEvent{Connection: "conn-1", ResourceKey: "pods", State: resource.WatchStateSynced})

	all := emitter.Events()
	var found bool
	for _, ev := range all {
		if ev.Key == "watch/STATE" {
			found = true
			break
		}
	}
	assert.True(t, found, "expected global watch/STATE event")
}

func TestSink_OnStateChange_SetsPluginID(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnStateChange(resource.WatchStateEvent{
		Connection:  "conn-1",
		ResourceKey: "pods",
		State:       resource.WatchStateSynced,
	})

	ev := emitter.WaitForEvent(t, "STATE", time.Second)
	payload, ok := ev.Data.(resource.WatchStateEvent)
	assert.True(t, ok)
	assert.Equal(t, "plugin-a", payload.PluginID)
	assert.Equal(t, "conn-1", payload.Connection)
}

func TestSink_OnStateChange_EventKeyFormat(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)

	sink.OnStateChange(resource.WatchStateEvent{
		Connection:  "my-cluster",
		ResourceKey: "core::v1::Pod",
		State:       resource.WatchStateSyncing,
	})

	// Exactly 2 events emitted: per-connection + global
	all := emitter.Events()
	assert.Len(t, all, 2)

	// Per-connection key matches frontend listener pattern: ${pluginID}/${connectionID}/watch/STATE
	assert.Equal(t, "plugin-a/my-cluster/watch/STATE", all[0].Key)
	// Global key for status bar aggregation
	assert.Equal(t, "watch/STATE", all[1].Key)

	// Both events carry the same enriched payload
	perPayload, ok := all[0].Data.(resource.WatchStateEvent)
	assert.True(t, ok)
	assert.Equal(t, "plugin-a", perPayload.PluginID)
	assert.Equal(t, "my-cluster", perPayload.Connection)
	assert.Equal(t, "core::v1::Pod", perPayload.ResourceKey)
	assert.Equal(t, resource.WatchStateSyncing, perPayload.State)
}

func TestSink_EventKeyFormat_ADD(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "core::v1::Pod")

	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "core::v1::Pod"})

	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	assert.Equal(t, "plugin-a/conn-1/core::v1::Pod/ADD", ev.Key)
}

func TestSink_EventKeyFormat_UPDATE_DELETE(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	ctrl.subs.Subscribe("plugin-a", "conn-1", "pods")

	sink.OnUpdate(resource.WatchUpdatePayload{Connection: "conn-1", Key: "pods"})
	sink.OnDelete(resource.WatchDeletePayload{Connection: "conn-1", Key: "pods"})

	updates := emitter.EventsWithKey("UPDATE")
	assert.Len(t, updates, 1)
	assert.Equal(t, "plugin-a/conn-1/pods/UPDATE", updates[0].Key)

	deletes := emitter.EventsWithKey("DELETE")
	assert.Len(t, deletes, 1)
	assert.Equal(t, "plugin-a/conn-1/pods/DELETE", deletes[0].Key)
}
