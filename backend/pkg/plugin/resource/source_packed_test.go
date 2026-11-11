package resource

import (
	"fmt"
	"math"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func makeTestSourceMember(o resourcev2.SourceObservation, limit int) (sourceMember, string, error) {
	size, err := sourceMemberEstimate(o, limit)
	if err != nil {
		return sourceMember{}, "", err
	}
	transient, err := sourceMemberTransientEstimate(o, maxSourceTransientBytes)
	if err != nil {
		return sourceMember{}, "", err
	}
	return makeSourceMember(o, sourceMemberCost{retained: size, transient: transient})
}

func materializeSourceMember(member sourceMember) (resourcev2.SourceObservation, error) {
	record, err := materializeSourceRecord(member)
	if err != nil {
		return resourcev2.SourceObservation{}, err
	}
	return resourcev2.SourceObservation{
		Record: record, Metadata: cloneSourceMetadata(member.metadata), DisplayName: cloneSourceToken(member.header.displayName),
		DocumentCoverage: cloneSourceDocumentCoverage(member.header.documentCoverage),
	}, nil
}

func fullTestSourceRecord(record resourcev2.SourceRecord) resourcev2.Record {
	return resourcev2.Record{
		Reference: record.Reference, Body: record.Body, Representation: record.Representation,
		Coverage: record.Coverage, SourceRevision: record.SourceRevision,
	}
}

func TestSourcePackedRoundTripAndOwnership(t *testing.T) {
	o := accountingObservation()
	o.Record.Body.Map["items"] = resourcev2.Value{Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "original"}}}
	o.Record.Body.Map["int64"] = resourcev2.Value{Kind: "int64", Int: "-9223372036854775808"}
	o.Record.Body.Map["uint64"] = resourcev2.Value{Kind: "uint64", Uint: "18446744073709551615"}
	o.Record.Body.Map["negativeZero"] = resourcev2.Value{Kind: "double", Double: math.Copysign(0, -1)}
	o.Record.Body.Map["timestamp"] = resourcev2.Value{Kind: "timestamp", Timestamp: "2026-11-10T12:34:56.123456789Z"}
	o.Record.Body.Map["null"] = resourcev2.Value{Kind: "null"}
	o.Record.Body.Map["emptyMap"] = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{}}
	o.Record.Body.Map["emptyList"] = resourcev2.Value{Kind: "list", List: []resourcev2.Value{}}
	o.Record.Reference.Address.ID = "opaque/子::%00"
	o.Record.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "account", Value: "one"}, {Dimension: "region", Value: "two"}}
	incarnation, sourceRevision := "incarnation", "source-revision"
	o.Record.Reference.Incarnation = &incarnation
	o.Record.SourceRevision = &sourceRevision
	name, missing, items := "display", "missing", "items"
	index := uint32(1)
	created := time.Unix(123, 456).UTC()
	o.DisplayName = &name
	o.Metadata = &resourcev2.ResourceMetadata{Labels: map[string]string{"label": "original"}, CreatedAt: &created}
	o.DocumentCoverage = resourcev2.DocumentCoverage{KnownAbsent: []resourcev2.DocumentFieldPath{
		{Segments: []resourcev2.FieldPathSegment{{Member: &missing}}},
		{Segments: []resourcev2.FieldPathSegment{{Member: &items}, {Index: &index}}},
	}}
	member, key, err := makeTestSourceMember(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	want, err := materializeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, o, want)
	require.True(t, math.Signbit(want.Record.Body.Map["negativeZero"].Double))
	o.Record.Body.Map["items"] = resourcev2.Value{Kind: "null"}
	o.Metadata.Labels["label"] = "changed"
	name = "changed"
	missing = "changed"
	created = time.Time{}
	incarnation, sourceRevision = "changed", "changed"
	o.Record.Reference.Address.Scope[0].Value = "changed"
	index = 42
	got, err := materializeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, want, got)
	got.Metadata.Labels["label"] = "decoded mutation"
	got.Record.Body.Map["items"] = resourcev2.Value{Kind: "null"}
	got.Record.Reference.Address.Scope[0].Value = "decoded mutation"
	*got.Record.Reference.Incarnation = "decoded mutation"
	*got.Record.SourceRevision = "decoded mutation"
	got.Record.Representation.Revision = "decoded mutation"
	*got.DocumentCoverage.KnownAbsent[1].Segments[1].Index = 99
	again, err := materializeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, want, again)
	require.NotEmpty(t, key)
}

func TestSourcePackedSmallMapsAndLimits(t *testing.T) {
	o := accountingObservation()
	o.Record.Body.Map = make(map[string]resourcev2.Value)
	for i := range 100 {
		o.Record.Body.Map[fmt.Sprintf("key-%d", i)] = resourcev2.Value{Kind: "string", String: "value"}
	}
	estimate, err := sourceMemberEstimate(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	member, _, err := makeTestSourceMember(o, estimate)
	require.NoError(t, err)
	require.Equal(t, estimate, member.size)
	require.Greater(t, member.transient, member.size)
	decoded, err := materializeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, o, decoded)
	_, err = sourceMemberEstimate(o, estimate-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	_, _, err = makeTestSourceMember(o, estimate-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
}

func TestSourcePackedCostPreservesReservationGuards(t *testing.T) {
	o := accountingObservation()
	member, _, err := makeTestSourceMember(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	require.NotEmpty(t, member.body)
	exact := len(member.body) + member.retainedHeaderBytes()
	for _, retained := range []int{len(member.body) - 1, exact - 1} {
		_, _, err := makeSourceMember(o, sourceMemberCost{retained: retained, transient: member.transient})
		require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	}
	packed, _, err := makeSourceMember(o, sourceMemberCost{retained: exact, transient: member.transient})
	require.NoError(t, err)
	require.Equal(t, member.body, packed.body)
	require.Equal(t, exact, packed.size)
}

func TestSourcePackedCostPreservesWholeObservationValidation(t *testing.T) {
	o := accountingObservation()
	member, _, err := makeTestSourceMember(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	invalidCreatedAt := time.Date(10000, time.January, 1, 0, 0, 0, 0, time.UTC)
	o.Metadata = &resourcev2.ResourceMetadata{CreatedAt: &invalidCreatedAt}
	_, validationErr := resourcev2.SourceObservationWireSize(o)
	require.Error(t, validationErr)
	_, _, err = makeSourceMember(o, sourceMemberCost{retained: member.size, transient: member.transient})
	require.Equal(t, resourcev2.ErrorCode(validationErr), resourcev2.ErrorCode(err))
}
