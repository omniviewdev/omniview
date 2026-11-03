package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func boundedSourceViewFixture(t *testing.T, schemaBytes, count int) *sourceView {
	t.Helper()
	ctrl, _, _, target := sourceTestFixture(t)
	representation := canonicalTestRepresentation()
	revision := "schema-revision"
	representation.Schema = resourcev2.SchemaBinding{
		State: "available", Revision: &revision, Dialect: resourcev2.DialectJSONSchema202012,
		Document: json.RawMessage(`"` + strings.Repeat("x", schemaBytes) + `"`),
	}
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
		member, _, err := makeSourceMember(resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(r)}, defaultSourceStagingBytes)
		require.NoError(t, err)
		s.members[fmt.Sprint(i)] = member
	}
	return newSourceView(s, "view", "owner", "target")
}

func TestSourceViewSnapshotByteChunksAndSequence(t *testing.T) {
	v := boundedSourceViewFixture(t, 128<<10, 8)
	v.syncLocked("")
	require.True(t, v.synced)
	require.Greater(t, len(v.snapshotEnds), 1)
	require.Len(t, v.snapshot, 8)
	start := 0
	for i, end := range v.snapshotEnds {
		records := make([]HostRecord, 0, end-start)
		for _, member := range v.snapshot[start:end] {
			observation, err := decodeSourceMember(member)
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
			require.Len(t, record.Record.Representation.Schema.Document, (128<<10)+2)
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
	observation, err := decodeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	record := v.session.fullSourceRecord(observation.Record)
	record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"large": {Kind: "string", String: strings.Repeat("x", 96<<10)}}}
	records := make([]resourcev2.Record, 64)
	for i := range records {
		records[i] = record
	}
	v.changesLocked(records, nil)
	require.NotEqual(t, oldGeneration, v.generation)
	require.True(t, v.synced)
	require.NotNil(t, v.control)
	require.Equal(t, "overflow", v.control.Reset.Reason)
	require.Empty(t, v.queue)
	require.Len(t, v.snapshot, 1)
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
	observation, err := decodeSourceMember(v.session.members["0"])
	require.NoError(t, err)
	observation.Record.Body = nestedAccountingValue(resourcev2.MaxValueDepth)
	member, _, err := makeSourceMember(observation, defaultSourceStagingBytes)
	require.NoError(t, err)
	v.session.members["0"] = member
	require.NoError(t, resourcev2.ValidateValue(observation.Record.Body))

	v.syncLocked("")
	require.True(t, v.synced)
	require.Len(t, v.snapshot, 1)
	require.Len(t, v.snapshotEnds, 1)
	generation := v.generation

	record := v.session.fullSourceRecord(observation.Record)
	v.changesLocked([]resourcev2.Record{record}, nil)
	require.True(t, v.synced)
	require.Equal(t, generation, v.generation)
	require.Nil(t, v.control)
	require.Len(t, v.queue, 1)
	event := v.queue[0].event
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
