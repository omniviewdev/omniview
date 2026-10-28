package resource

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func newSinkTestSetup(t *testing.T) (*engineWatchSink, *controller, *recordingEmitter) {
	t.Helper()
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "plugin-a", &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			return canonicalTestCatalog("provider-a", "pods"), nil
		},
		GetFunc: func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			record := canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID)
			record.Reference = request.Reference
			return record, nil
		},
	})
	ctx, cancel := context.WithCancel(invocation.HostContext(context.Background()))
	t.Cleanup(cancel)
	return &engineWatchSink{ctx: ctx, generationID: ctrl.plugins["plugin-a"].generationID, pluginID: "plugin-a", ctrl: ctrl, store: ctrl.registryStore, dispatcher: ctrl.dispatcher}, ctrl, emitter
}

func sinkTestRecord(t *testing.T, ctrl *controller) (resource.AccessRoute, resource.Record) {
	t.Helper()
	target := admittedReadTarget(t, ctrl, "plugin-a", "conn-1", "pods").Target
	return target.Route, canonicalTestRecord(target.Provider, target.Authority, target.Type, "pod-1")
}

func subscribeSinkTest(t *testing.T, ctrl *controller) HostSubscription {
	t.Helper()
	resolved := admittedReadTarget(t, ctrl, "plugin-a", "conn-1", "pods")
	ctx, err := ctrl.admit(testInvocationContext(), "resource.Subscribe", invocation.Target{Provider: "plugin-a", Connection: "conn-1", ResourceType: "pods"})
	require.NoError(t, err)
	request, ok := invocation.FromContext(ctx)
	require.True(t, ok)
	subscription := HostSubscription{TargetID: resolved.TargetID, Target: resolved.Target}
	require.NoError(t, ctrl.subs.Subscribe(ctx, request.Principal(), "plugin-a", subscription))
	return subscription
}

func TestSink_SubscriptionOnlyGatesEmission(t *testing.T) {
	for _, subscribed := range []bool{false, true} {
		t.Run(map[bool]string{false: "unsubscribed", true: "subscribed"}[subscribed], func(t *testing.T) {
			sink, ctrl, emitter := newSinkTestSetup(t)
			route, record := sinkTestRecord(t, ctrl)
			if subscribed {
				subscribeSinkTest(t, ctrl)
			}
			sink.OnAdd(resource.WatchAddPayload{Route: route, Record: record})
			entry, ok := ctrl.registryStore.Get("plugin-a", record.Reference, route)
			require.True(t, ok)
			require.Equal(t, record.Reference, entry.Reference)
			sink.OnUpdate(resource.WatchUpdatePayload{Route: route, Record: record, Metadata: resource.ResourceMetadata{Labels: map[string]string{"app": "changed"}}})
			entry, ok = ctrl.registryStore.Get("plugin-a", record.Reference, route)
			require.True(t, ok)
			require.Equal(t, "changed", entry.Labels["app"])
			sink.OnDelete(resource.WatchDeletePayload{Route: route, Reference: record.Reference})
			_, ok = ctrl.registryStore.Get("plugin-a", record.Reference, route)
			require.False(t, ok)
			count := 0
			if subscribed {
				count = 1
			}
			for _, event := range []string{"ADD", "UPDATE", "DELETE"} {
				events := emitter.EventsWithKey(event)
				require.Len(t, events, count)
				if subscribed {
					require.Equal(t, "plugin-a/conn-1/pods/"+event, events[0].Key)
				}
			}
			if subscribed {
				require.Equal(t, resource.BestEffortGuarantee, emitter.EventsWithKey("ADD")[0].Data[0].(HostWatchRecordEvent).Guarantee)
				require.Equal(t, resource.BestEffortGuarantee, emitter.EventsWithKey("UPDATE")[0].Data[0].(HostWatchRecordEvent).Guarantee)
				require.Equal(t, resource.BestEffortGuarantee, emitter.EventsWithKey("DELETE")[0].Data[0].(HostWatchDeleteEvent).Guarantee)
			}
		})
	}
}

func TestSink_StateAlwaysEmitsExplicitAdvisoryPayload(t *testing.T) {
	sink, _, emitter := newSinkTestSetup(t)
	sink.OnStateChange(resource.WatchStateEvent{Route: resource.AccessRoute{Connection: "my-cluster"}, Type: "pods", State: resource.WatchStateSynced, Count: resource.Count{Kind: "unknown"}})
	events := emitter.Events()
	require.Len(t, events, 2)
	require.Equal(t, "plugin-a/my-cluster/watch/STATE", events[0].Key)
	require.Equal(t, "watch/STATE", events[1].Key)
	payload := events[0].Data[0].(resource.WatchStateEvent)
	require.Equal(t, "my-cluster", payload.Route.Connection)
	require.Equal(t, "pods", payload.Type)
	require.Equal(t, resource.WatchStateSynced, payload.State)
	require.Equal(t, "unknown", payload.Count.Kind)
	require.Equal(t, resource.BestEffortGuarantee, payload.Guarantee)
	global := events[1].Data[0].(HostWatchStateEvent)
	require.Equal(t, "plugin-a", global.PluginID)
	require.Equal(t, payload, global.WatchStateEvent)
}

func TestSink_UsesOnlyExplicitMetadata(t *testing.T) {
	sink, ctrl, _ := newSinkTestSetup(t)
	route, record := sinkTestRecord(t, ctrl)
	body, err := resource.JSONToValue([]byte(`{"metadata":{"name":"wrong","namespace":"wrong","uid":"not-identity","labels":{"app":"body"},"creationTimestamp":"2026-10-01T12:00:00Z"}}`))
	require.NoError(t, err)
	record.Body = body
	sink.OnAdd(resource.WatchAddPayload{Route: route, Record: record})
	entry, ok := ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.True(t, ok)
	require.Empty(t, entry.Labels)
	require.True(t, entry.CreatedAt.IsZero())
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	labels := map[string]string{"app": "provider"}
	sink.OnUpdate(resource.WatchUpdatePayload{Route: route, Record: record, Metadata: resource.ResourceMetadata{Labels: labels, CreatedAt: &created}})
	labels["app"] = "mutated"
	entry, ok = ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.True(t, ok)
	require.Equal(t, "provider", entry.Labels["app"])
	require.Equal(t, created, entry.CreatedAt)
	require.Equal(t, "pod-1", entry.Reference.Address.ID)
}

func TestSink_RejectsForeignAuthorityAndCancelledGeneration(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	route, record := sinkTestRecord(t, ctrl)
	subscribeSinkTest(t, ctrl)
	foreign := record
	foreign.Reference.Address.Authority = "foreign"
	sink.OnAdd(resource.WatchAddPayload{Route: route, Record: foreign})
	_, ok := ctrl.registryStore.Get("plugin-a", foreign.Reference, route)
	require.False(t, ok)
	ctx, cancel := context.WithCancel(sink.ctx)
	cancel()
	sink.ctx = ctx
	sink.OnAdd(resource.WatchAddPayload{Route: route, Record: record})
	sink.OnUpdate(resource.WatchUpdatePayload{Route: route, Record: record})
	sink.OnDelete(resource.WatchDeletePayload{Route: route, Reference: record.Reference})
	sink.OnStateChange(resource.WatchStateEvent{Route: route, Type: "pods"})
	_, ok = ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.False(t, ok)
	require.Empty(t, emitter.Events())
}

func TestSink_FiniteObservationDoesNotEmitLiveReadiness(t *testing.T) {
	_, ctrl, emitter := newSinkTestSetup(t)
	route, record := sinkTestRecord(t, ctrl)
	require.NoError(t, ctrl.observeRecord(testInvocationContext(), "plugin-a", route, record))
	_, ok := ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.True(t, ok)
	require.Empty(t, emitter.Events())
}

func TestSink_UpdateMembershipMatchesFiniteRowKeys(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	route, record := sinkTestRecord(t, ctrl)
	subscription := subscribeSinkTest(t, ctrl)
	finite, err := ctrl.Get(testInvocationContext(), "plugin-a", HostGetRequest{TargetID: subscription.TargetID, Request: resource.GetRequest{Route: route, Reference: record.Reference, Representation: record.Representation.ID}})
	require.NoError(t, err)
	sink.OnAdd(resource.WatchAddPayload{Route: route, Record: record})
	sink.OnUpdate(resource.WatchUpdatePayload{Route: route, Record: record})
	sink.OnDelete(resource.WatchDeletePayload{Route: route, Reference: record.Reference, LastKnown: &record})
	add := emitter.EventsWithKey("ADD")[0].Data[0].(HostWatchRecordEvent)
	update := emitter.EventsWithKey("UPDATE")[0].Data[0].(HostWatchRecordEvent)
	deletion := emitter.EventsWithKey("DELETE")[0].Data[0].(HostWatchDeleteEvent)
	require.Equal(t, subscription.TargetID, add.Record.TargetID)
	require.Equal(t, finite.Key, add.Record.Key)
	require.Equal(t, add.Record.Key, update.Record.Key)
	require.Equal(t, add.Record.Key, deletion.Key)
	require.Equal(t, add.Record.AddressKey, deletion.AddressKey)
	require.NotNil(t, deletion.LastKnown)
	require.Equal(t, add.Record.Key, deletion.LastKnown.Key)
}

func TestSink_RetiredGenerationCannotMutateOrEmit(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	route, record := sinkTestRecord(t, ctrl)
	subscribeSinkTest(t, ctrl)
	ctrl.pluginsMu.Lock()
	ctrl.plugins["plugin-a"].generationID = "replacement-generation"
	ctrl.pluginsMu.Unlock()
	sink.OnAdd(resource.WatchAddPayload{Route: route, Record: record})
	sink.OnStateChange(resource.WatchStateEvent{Route: route, Type: "pods"})
	_, ok := ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.False(t, ok)
	require.Empty(t, emitter.Events())
}

func TestSink_DeliveryReauthorizesSubscriber(t *testing.T) {
	sink, ctrl, emitter := newSinkTestSetup(t)
	route, record := sinkTestRecord(t, ctrl)
	subscribeSinkTest(t, ctrl)
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, _ invocation.Target) error {
		if operation == "resource.WatchDelivery" {
			return errors.New("subscription access revoked")
		}
		return nil
	}))
	sink.OnAdd(resource.WatchAddPayload{Route: route, Record: record})
	_, ok := ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.True(t, ok)
	require.Empty(t, emitter.Events())
}
