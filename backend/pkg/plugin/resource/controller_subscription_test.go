package resource

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ============================================================================
// Subscribe / Unsubscribe via controller
// ============================================================================

func TestSubscribeResource_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.SubscribeResource("p1", "conn-1", "pods")
	require.NoError(t, err)
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestSubscribeResource_RefCounting(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestUnsubscribeResource_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	err := ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	require.NoError(t, err)
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestUnsubscribeResource_AtZero(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	require.NoError(t, err) // no error even when already 0
}

func TestIsSubscribed_AfterSubscribe(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestIsSubscribed_AfterUnsubscribe(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestIsSubscribed_RefCounted(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestSubscription_DifferentResources(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "services"))
}

func TestSubscription_DifferentConnections(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	assert.False(t, ctrl.isSubscribed("p1", "conn-2", "pods"))
}

func TestSubscription_DifferentPlugins(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	assert.False(t, ctrl.isSubscribed("p2", "conn-1", "pods"))
}

func TestSubscription_RemoveAllOnStop(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.SubscribeResource("p1", "conn-1", "services")

	_ = ctrl.OnPluginStop("p1", defaultMeta())

	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "services"))
}

// ============================================================================
// Subscription gating of events through the sink
// ============================================================================

func TestSubscription_GatesADD(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// Not subscribed — should not emit.
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods"})
	assert.Empty(t, emitter.EventsWithKey("ADD"))

	// Subscribe — should emit.
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods"})

	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	assert.Contains(t, ev.Key, "ADD")
}

func TestSubscription_GatesUPDATE_DELETE(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// Not subscribed.
	sink.OnUpdate(resource.WatchUpdatePayload{Connection: "conn-1", Key: "pods"})
	sink.OnDelete(resource.WatchDeletePayload{Connection: "conn-1", Key: "pods"})
	assert.Empty(t, emitter.EventsWithKey("UPDATE"))
	assert.Empty(t, emitter.EventsWithKey("DELETE"))
}

func TestSubscription_STATEBypassesGate(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// Not subscribed — STATE should still emit.
	sink.OnStateChange(resource.WatchStateEvent{ResourceKey: "pods", State: resource.WatchStateSynced})
	assert.NotEmpty(t, emitter.EventsWithKey("STATE"))
}
