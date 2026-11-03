package resource

import (
	"sync"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

type blockingSourceViewEmitter struct {
	entered chan struct{}
	release chan struct{}
	ended   chan struct{}
}

func (e *blockingSourceViewEmitter) Emit(_ string, data ...any) {
	event, ok := data[0].(HostSourceViewEvent)
	if !ok {
		return
	}
	if event.Kind == "snapshot" {
		close(e.entered)
		<-e.release
	} else if event.Kind == "snapshotEnd" {
		close(e.ended)
	}
}

func waitSourceViewTransient(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for source view event")
	}
}

func TestSourceViewTransientReservationReleasedAfterSizing(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	v.syncLocked("")
	require.True(t, v.synced)
	available := maxSourceTransientBytes - v.snapshotArrayBytes
	require.True(t, v.transientLedger.reserve(available))
	v.transientLedger.release(available)
	v.close()
}

func TestSourceViewTransientContentionAndRelease(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	emitter := &blockingSourceViewEmitter{entered: make(chan struct{}), release: make(chan struct{}), ended: make(chan struct{})}
	v.ctrl.emitter = emitter
	v.syncLocked("")
	require.True(t, v.synced)
	var release sync.Once
	t.Cleanup(func() {
		release.Do(func() { close(emitter.release) })
		v.close()
	})
	go v.emitLoop()
	waitSourceViewTransient(t, emitter.entered)

	other := newSourceView(v.session, "other", "owner", "target")
	var cost int
	for _, member := range v.session.members {
		cost, _ = v.snapshotMemberTransient(member)
	}
	require.Greater(t, cost, 0)
	available := maxSourceTransientBytes - cost - v.snapshotArrayBytes
	require.True(t, v.transientLedger.reserve(available))
	other.syncLocked("")
	require.False(t, other.synced)
	require.NotNil(t, other.retryCancel)
	require.Nil(t, other.snapshotStatus)
	require.True(t, v.session.transientLedger.reserve(maxSourceTransientBytes))
	v.session.transientLedger.release(maxSourceTransientBytes)
	v.session.staging = make(map[string]sourceMember)
	observation := accountingObservation()
	_, err := v.session.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{observation}}})
	require.NoError(t, err, "a stalled view must not exhaust source admission")
	v.transientLedger.release(available)
	require.Eventually(t, func() bool {
		other.mu.Lock()
		defer other.mu.Unlock()
		return other.synced
	}, time.Second, time.Millisecond)
	other.close()

	release.Do(func() { close(emitter.release) })
	waitSourceViewTransient(t, emitter.ended)
	require.True(t, v.transientLedger.reserve(maxSourceTransientBytes))
	v.transientLedger.release(maxSourceTransientBytes)
	v.close()
	other.close()
}

func TestSourceViewChangeTransientContentionAndRelease(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	v.syncLocked("")
	require.True(t, v.synced)
	observation, err := decodeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	record := v.session.fullSourceRecord(observation.Record)
	v.changesLocked([]resourcev2.Record{record}, nil)
	require.Len(t, v.queue, 1)
	available := maxSourceTransientBytes - v.snapshotArrayBytes - v.queue[0].transient
	require.True(t, v.transientLedger.reserve(available))
	v.changesLocked([]resourcev2.Record{record}, nil)
	require.NotNil(t, v.control)
	require.Equal(t, "overflow", v.control.Reset.Reason)
	v.transientLedger.release(available)
	require.Eventually(t, func() bool {
		v.mu.Lock()
		defer v.mu.Unlock()
		return v.synced
	}, time.Second, time.Millisecond)
	v.close()
}

func TestSourceViewSnapshotArrayContention(t *testing.T) {
	first := boundedSourceViewFixture(t, 0, 1)
	first.syncLocked("")
	require.True(t, first.synced)
	arrayCost := first.snapshotArrayBytes
	var recordCost int
	for _, member := range first.session.members {
		recordCost, _ = first.snapshotMemberTransient(member)
	}
	available := maxSourceTransientBytes - 4*arrayCost - recordCost
	require.Positive(t, available)
	require.True(t, first.transientLedger.reserve(available))
	views := []*sourceView{first}
	for range 3 {
		v := newSourceView(first.session, "view", "owner", "target")
		v.syncLocked("")
		require.True(t, v.synced)
		views = append(views, v)
	}
	last := newSourceView(first.session, "last", "owner", "target")
	last.syncLocked("")
	require.False(t, last.synced)
	require.NotNil(t, last.retryCancel)
	first.transientLedger.release(available)
	require.Eventually(t, func() bool {
		last.mu.Lock()
		defer last.mu.Unlock()
		return last.synced
	}, time.Second, time.Millisecond)
	for _, v := range views {
		v.close()
	}
	last.close()
	require.True(t, first.transientLedger.reserve(maxSourceTransientBytes))
	first.transientLedger.release(maxSourceTransientBytes)
}

type blockingChangeEmitter struct {
	entered chan struct{}
	release chan struct{}
	status  chan struct{}
}

func (e *blockingChangeEmitter) Emit(_ string, data ...any) {
	event, ok := data[0].(HostSourceViewEvent)
	if !ok {
		return
	}
	switch event.Kind {
	case "changes":
		close(e.entered)
		<-e.release
	case "status":
		close(e.status)
	}
}

func TestSourceViewChangeEmissionReservationReleased(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	emitter := &blockingChangeEmitter{entered: make(chan struct{}), release: make(chan struct{}), status: make(chan struct{})}
	v.ctrl.emitter = emitter
	v.syncLocked("")
	observation, err := decodeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	v.changesLocked([]resourcev2.Record{v.session.fullSourceRecord(observation.Record)}, nil)
	require.Len(t, v.queue, 1)
	cost := v.queue[0].transient
	require.Positive(t, cost)
	var release sync.Once
	t.Cleanup(func() {
		release.Do(func() { close(emitter.release) })
		v.close()
	})
	go v.emitLoop()
	waitSourceViewTransient(t, emitter.entered)
	available := maxSourceTransientBytes - cost
	require.True(t, v.transientLedger.reserve(available))
	v.transientLedger.release(available)
	v.statusLocked()
	release.Do(func() { close(emitter.release) })
	waitSourceViewTransient(t, emitter.status)
	require.True(t, v.transientLedger.reserve(maxSourceTransientBytes))
	v.transientLedger.release(maxSourceTransientBytes)
}

func TestSourceViewQueuedChangeReservationLifetime(t *testing.T) {
	first := boundedSourceViewFixture(t, 0, 1)
	first.syncLocked("")
	observation, err := decodeSourceMember(first.session.members["0"])
	require.NoError(t, err)
	record := first.session.fullSourceRecord(observation.Record)
	first.changesLocked([]resourcev2.Record{record}, nil)
	require.Len(t, first.queue, 1)
	cost := first.queue[0].transient
	require.Positive(t, cost)

	other := newSourceView(first.session, "other", "owner", "target")
	other.synced = true
	available := maxSourceTransientBytes - first.snapshotArrayBytes - cost - (cost - 1)
	require.Positive(t, available)
	require.True(t, first.transientLedger.reserve(available))
	other.changesLocked([]resourcev2.Record{record}, nil)
	require.NotNil(t, other.control)
	require.Equal(t, "overflow", other.control.Reset.Reason)
	require.Len(t, first.queue, 1)
	first.transientLedger.release(available)
	other.close()

	first.resetLocked("resync", "reset")
	require.Empty(t, first.queue)
	require.True(t, first.transientLedger.reserve(maxSourceTransientBytes))
	first.transientLedger.release(maxSourceTransientBytes)
	first.synced = true
	first.changesLocked([]resourcev2.Record{record}, nil)
	require.Len(t, first.queue, 1)
	first.close()
	other.close()
	require.True(t, first.transientLedger.reserve(maxSourceTransientBytes))
	first.transientLedger.release(maxSourceTransientBytes)
}
