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
		coordinator: ctrl.sources,
		pluginGeneration: &pluginState{generationID: "generation"},
		target: target.Target,
		ctx: context.WithValue(context.Background(), sourceBindingKey{}, sourceBinding{Representation: representation}),
		hasSnapshot: true,
		members: make(map[string]sourceMember),
	}
	for i := range count {
		r := sourceTestRecord(target.Target, fmt.Sprint(i), "")
		s.members[fmt.Sprint(i)] = sourceMember{observation: resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(r)}}
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
		event := HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: fmt.Sprint(i + 1), Kind: "snapshot", Records: v.snapshot[start:end]}
		encoded, err := json.Marshal(event)
		require.NoError(t, err)
		require.LessOrEqual(t, len(encoded), sourceViewQueueBytes)
		for _, record := range event.Records {
			require.Len(t, record.Record.Representation.Schema.Document, (1<<20)+2)
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
	v := boundedSourceViewFixture(t, 1<<20, 1)
	v.syncLocked("")
	oldGeneration := v.generation
	record := v.session.fullSourceRecord(v.session.members["0"].observation.Record)
	records := make([]resourcev2.Record, 8)
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
