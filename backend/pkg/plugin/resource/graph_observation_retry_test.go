package resource

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// A mounted observation re-evaluates when one of its source populations changes.
// An evaluation that fails with UNAVAILABLE keeps the demand so the next change
// retries it. When the failure comes before the populations are read again, such
// as route admission while the catalog is briefly unavailable, the notification
// the delivered change already closed must not wake the observation a second time.
func TestGraphObservationUnavailableBeforeProjectionWaitsForNextChange(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := demandRecord(t, target.Target, "pod", "peer")

	service := NewGraphService(ctrl, nil, nil)
	var unavailable atomic.Bool
	var attempts atomic.Int64
	validate := service.validateReference
	service.validateReference = func(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) error {
		if unavailable.Load() {
			attempts.Add(1)
			return resourcev2.NewError("UNAVAILABLE", "catalog unavailable")
		}
		return validate(ctx, pluginID, route, reference)
	}

	var failed atomic.Int64
	ready := make(chan string, 16)
	request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}
	opened, err := service.openObservation(testInvocationContext(), context.Background(), request, func(snapshot HostGraphObservationSnapshot) {
		switch snapshot.State {
		case "failed":
			failed.Add(1)
		case "ready":
			if len(snapshot.Edges) == 1 {
				select {
				case ready <- snapshot.Edges[0].Target.Reference.Address.ID:
				default:
				}
			}
		}
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = service.closeObservation(testInvocationContext(), opened.ObservationID) })
	require.NoError(t, service.syncObservation(testInvocationContext(), opened.ObservationID))
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	demandSnapshot(open, record)
	// Repeated ready frames for the same edge are not the one being waited for.
	awaitPeer := func(want string) {
		t.Helper()
		deadline := time.After(5 * time.Second)
		for {
			select {
			case got := <-ready:
				if got == want {
					return
				}
			case <-deadline:
				t.Fatalf("observation did not become ready for %q", want)
			}
		}
	}
	awaitPeer("peer")

	upsert := func(name string) {
		sourceSend(open.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(demandRecord(t, target.Target, "pod", name))}}}}})
	}

	// One change arrives while route admission is unavailable: one failed attempt.
	unavailable.Store(true)
	upsert("first")
	require.Eventually(t, func() bool { return failed.Load() >= 1 }, 5*time.Second, time.Millisecond)

	// Nothing changed since, so the observation must wait instead of retrying.
	before := attempts.Load()
	time.Sleep(200 * time.Millisecond)
	require.LessOrEqual(t, attempts.Load()-before, int64(5), "an unavailable evaluation retried without any further change")

	// The next change retries it, and the observation recovers.
	unavailable.Store(false)
	upsert("second")
	awaitPeer("second")
}
