package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unsafe"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func boundedSourceViewFixture(t *testing.T, bodyBytes, count int) *sourceView {
	t.Helper()
	ctrl, _, _, target := sourceTestFixture(t)
	representation := canonicalTestRepresentation()
	s := &sourceSession{
		coordinator:      ctrl.sources,
		pluginGeneration: &pluginState{generationID: "generation"},
		target:           target.Target,
		ctx:              context.WithValue(context.Background(), sourceBindingKey{}, sourceBinding{Representation: representation}),
		hasSnapshot:      true,
		members:          make(map[string]sourceMember),
	}
	for i := range count {
		r := sourceTestRecord(target.Target, fmt.Sprint(i), "")
		r.Representation = representation
		if bodyBytes != 0 {
			r.Body.Map["large"] = resourcev2.Value{Kind: "string", String: strings.Repeat("x", bodyBytes)}
		}
		member, _, err := makeTestSourceMember(resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(r)}, defaultSourceStagingBytes)
		require.NoError(t, err)
		s.members[fmt.Sprint(i)] = member
	}
	return newSourceView(s, "view", "owner", "target")
}

func TestSourceViewSnapshotByteChunksAndSequence(t *testing.T) {
	v := boundedSourceViewFixture(t, 1<<20, 8)
	v.syncLocked("")
	require.True(t, v.synced)
	require.Greater(t, len(v.snapshotEnds), 1)
	require.Len(t, v.snapshot, 8)
	start := 0
	for i, end := range v.snapshotEnds {
		records := make([]HostRecord, 0, end-start)
		for _, member := range v.snapshot[start:end] {
			observation, err := materializeSourceMember(member)
			require.NoError(t, err)
			r := observation.Record
			record, err := envelopeRecord(v.snapshotGeneration, v.owner, v.targetID, v.snapshotTarget, resourcev2.Record{Reference: r.Reference, Body: r.Body, Representation: v.snapshotBinding, Coverage: r.Coverage, SourceRevision: r.SourceRevision})
			require.NoError(t, err)
			records = append(records, record)
		}
		event := HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: fmt.Sprint(i + 1), Kind: "snapshot", Records: records}
		encoded, err := json.Marshal(event)
		require.NoError(t, err)
		require.LessOrEqual(t, len(encoded), sourceViewQueueBytes)
		for _, record := range event.Records {
			require.Len(t, record.Record.Body.Map["large"].String, 1<<20)
		}
		start = end
	}
	require.Equal(t, len(v.snapshot), start)
	endSequence := len(v.snapshotEnds) + 1
	v.statusLocked()
	require.Len(t, v.queue, 1)
	require.Equal(t, fmt.Sprint(endSequence+1), v.queue[0].event.Sequence)
	require.Equal(t, v.generation, v.queue[0].event.ViewGeneration)
}

func TestSourceViewSnapshotTransientChunkBoundary(t *testing.T) {
	for _, extra := range []int{0, 1} {
		t.Run(fmt.Sprintf("over-by-%d", extra), func(t *testing.T) {
			v := boundedSourceViewFixture(t, 0, 2)
			arrayCost := 256 + 2*(int(unsafe.Sizeof(sourceMember{}))+32)
			budget := maxSourceTransientBytes - arrayCost
			for i, cost := range []int{budget / 2, budget - budget/2 + extra} {
				key := fmt.Sprint(i)
				member := v.session.members[key]
				member.transient = cost
				require.Positive(t, member.transient)
				v.session.members[key] = member
			}

			v.syncLocked("")
			defer v.close()
			require.True(t, v.synced)
			require.Equal(t, arrayCost, v.snapshotArrayBytes)
			if extra == 0 {
				require.Equal(t, []int{2}, v.snapshotEnds)
			} else {
				require.Equal(t, []int{1, 2}, v.snapshotEnds)
			}
			start := 0
			for _, end := range v.snapshotEnds {
				cost := 0
				for _, member := range v.snapshot[start:end] {
					memberCost, ok := v.snapshotMemberTransient(member)
					require.True(t, ok)
					cost += memberCost
				}
				require.LessOrEqual(t, cost, budget)
				require.True(t, v.transientLedger.reserve(cost))
				v.transientLedger.release(cost)
				start = end
			}
		})
	}
}

func TestSourceViewSnapshotSingleRecordExceedsTransientBudget(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	arrayCost := 256 + int(unsafe.Sizeof(sourceMember{})) + 32
	member := v.session.members["0"]
	member.transient = maxSourceTransientBytes - arrayCost + 1
	v.session.members["0"] = member

	v.syncLocked("")
	defer v.close()
	require.False(t, v.synced)
	require.NotNil(t, v.snapshotStatus)
	require.Equal(t, "failed", v.snapshotStatus.State)
	require.Equal(t, "RESOURCE_LIMIT", v.snapshotStatus.Error.Code)
	require.Equal(t, "Source view record transient exceeds host limits.", v.snapshotStatus.Error.Message)
	require.Empty(t, v.snapshot)
	require.Zero(t, v.snapshotArrayBytes)
}

func TestSourceViewOversizedSnapshotDoesNotResync(t *testing.T) {
	v := boundedSourceViewFixture(t, 6<<20, 1)
	v.syncLocked("")
	require.False(t, v.synced)
	require.NotNil(t, v.snapshotStatus)
	require.Equal(t, "failed", v.snapshotStatus.State)
	require.Equal(t, "RESOURCE_LIMIT", v.snapshotStatus.Error.Code)
	require.Empty(t, v.snapshot)
	generation := v.generation
	v.changesLocked(nil, nil)
	require.Equal(t, generation, v.generation)
	require.Empty(t, v.queue)
}

func TestSourceViewChangesOverflowResnapshots(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	v.syncLocked("")
	oldGeneration := v.generation
	observation, err := materializeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	record := fullTestSourceRecord(observation.Record)
	record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"large": {Kind: "string", String: strings.Repeat("x", 96<<10)}}}
	member, _, err := makeTestSourceMember(resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}, defaultSourceStagingBytes)
	require.NoError(t, err)
	members := make([]sourceMember, 64)
	for i := range members {
		members[i] = member
	}
	v.changesLocked(members, nil)
	require.NotEqual(t, oldGeneration, v.generation)
	require.True(t, v.synced)
	require.NotNil(t, v.control)
	require.Equal(t, "overflow", v.control.Reset.Reason)
	require.Empty(t, v.queue)
	require.Len(t, v.snapshot, 1)
}

func TestSourceViewChangesDeferBodiesUntilDelivery(t *testing.T) {
	v := boundedSourceViewFixture(t, 32<<10, 1)
	defer v.close()
	v.syncLocked("")
	require.True(t, v.synced)
	observation, err := materializeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	record := fullTestSourceRecord(observation.Record)
	members := make([]sourceMember, 16)
	for i := range members {
		record.Reference.Address.ID = fmt.Sprintf("pod-%d", i)
		member, _, err := makeTestSourceMember(resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}, defaultSourceStagingBytes)
		require.NoError(t, err)
		members[i] = member
	}
	v.changesLocked(members, nil)
	require.True(t, v.synced)
	require.Nil(t, v.control)
	require.Len(t, v.queue, 1)
	require.Empty(t, v.queue[0].event.Upserts, "the locked queue stores only immutable member handles")
	require.Len(t, v.queue[0].members, len(members))
	event, err := v.queue[0].materialize(v.owner, v.targetID)
	require.NoError(t, err)
	require.Len(t, event.Upserts, len(members))
	for _, upsert := range event.Upserts {
		require.Equal(t, record.Body, upsert.Record.Body)
		require.Equal(t, record.Representation, upsert.Record.Representation)
	}
}

func TestSourceViewSizeIncludesTaggedNestedValues(t *testing.T) {
	value := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"escaped\nkey": {Kind: "list", List: []resourcev2.Value{
			{Kind: "string", String: strings.Repeat("\x00\"\\<", 4096)},
			{Kind: "map", Map: map[string]resourcev2.Value{
				"nested": {Kind: "string", String: strings.Repeat("\n", 4096)},
			}},
		}},
	}}
	size, ok := sourceViewSize(value, sourceViewQueueBytes)
	require.True(t, ok)
	encoded, err := json.Marshal(value)
	require.NoError(t, err)
	require.GreaterOrEqual(t, size, len(encoded))

	value.Map["large"] = resourcev2.Value{Kind: "string", String: strings.Repeat("\x00", sourceViewQueueBytes/6)}
	_, ok = sourceViewSize(value, sourceViewQueueBytes)
	require.False(t, ok)
}

func TestSourceViewDepth64SnapshotAndChanges(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	observation, err := materializeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	observation.Record.Body = nestedAccountingValue(resourcev2.MaxValueDepth)
	member, _, err := makeTestSourceMember(observation, defaultSourceStagingBytes)
	require.NoError(t, err)
	v.session.members["0"] = member
	require.NoError(t, resourcev2.ValidateValue(observation.Record.Body))

	v.syncLocked("")
	require.True(t, v.synced)
	require.Len(t, v.snapshot, 1)
	require.Len(t, v.snapshotEnds, 1)
	generation := v.generation

	v.changesLocked([]sourceMember{member}, nil)
	require.True(t, v.synced)
	require.Equal(t, generation, v.generation)
	require.Nil(t, v.control)
	require.Len(t, v.queue, 1)
	event, err := v.queue[0].materialize(v.owner, v.targetID)
	require.NoError(t, err)
	require.Len(t, event.Upserts, 1)
	size, ok := sourceViewSize(event, sourceViewQueueBytes)
	require.True(t, ok)
	encoded, err := json.Marshal(event)
	require.NoError(t, err)
	require.GreaterOrEqual(t, size, len(encoded))
}

func TestSourceViewSizeRejectsRecursiveValues(t *testing.T) {
	value := map[string]any{}
	value["self"] = value
	_, ok := sourceViewSize(value, sourceViewQueueBytes)
	require.False(t, ok)
}
