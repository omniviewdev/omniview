package resource

import (
	"fmt"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestSourcePackedRoundTripAndOwnership(t *testing.T) {
	o := accountingObservation()
	o.Record.Body.Map["items"] = resourcev2.Value{Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "original"}}}
	name, missing, items := "display", "missing", "items"
	index := uint32(1)
	created := time.Unix(123, 456).UTC()
	o.DisplayName = &name
	o.Metadata = &resourcev2.ResourceMetadata{Labels: map[string]string{"label": "original"}, CreatedAt: &created}
	o.DocumentCoverage = resourcev2.DocumentCoverage{KnownAbsent: []resourcev2.DocumentFieldPath{
		{Segments: []resourcev2.FieldPathSegment{{Member: &missing}}},
		{Segments: []resourcev2.FieldPathSegment{{Member: &items}, {Index: &index}}},
	}}
	member, key, err := makeSourceMember(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	want, err := decodeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, o, want)
	o.Record.Body.Map["items"] = resourcev2.Value{Kind: "null"}
	o.Metadata.Labels["label"] = "changed"
	name = "changed"
	missing = "changed"
	created = time.Time{}
	got, err := decodeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, want, got)
	got.Metadata.Labels["label"] = "decoded mutation"
	again, err := decodeSourceMember(member)
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
	member, key, err := makeSourceMember(o, estimate)
	require.NoError(t, err)
	require.Equal(t, estimate, member.size)
	require.GreaterOrEqual(t, estimate, len(member.wire)+len(key))
	require.Greater(t, member.transient, member.size)
	decoded, err := decodeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, o, decoded)
	_, err = sourceMemberEstimate(o, estimate-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	_, _, err = makeSourceMember(o, estimate-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
}
