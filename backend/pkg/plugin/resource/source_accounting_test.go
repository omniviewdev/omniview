package resource

import (
	"fmt"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func accountingObservation() resourcev2.SourceObservation {
	record := sourceTestRecord(resourcev2.ReadTarget{Provider: "p", Authority: "a", Type: "t"}, "id", "")
	return resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
}

func nestedAccountingValue(depth int) resourcev2.Value {
	value := resourcev2.Value{Kind: "string", String: "leaf"}
	for i := range depth {
		if i%2 == 0 {
			value = resourcev2.Value{Kind: "list", List: []resourcev2.Value{value}}
		} else {
			value = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"child": value}}
		}
	}
	return value
}

func TestSourceAccountingValueDepth(t *testing.T) {
	for _, depth := range []int{resourcev2.MaxValueDepth, resourcev2.MaxValueDepth + 1} {
		t.Run(fmt.Sprint(depth), func(t *testing.T) {
			observation := accountingObservation()
			observation.Record.Body = nestedAccountingValue(depth)
			validationErr := resourcev2.ValidateValue(observation.Record.Body)
			_, err := sourceMemberSize(observation, defaultSourceStagingBytes)
			snapshot := resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{observation}}}
			changes := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Observation: &observation}}}}
			if depth == resourcev2.MaxValueDepth {
				require.NoError(t, validationErr)
				require.NoError(t, err)
				require.NoError(t, sourceFramePreflight(snapshot))
				require.NoError(t, sourceFramePreflight(changes))
			} else {
				require.Error(t, validationErr)
				require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
				require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(snapshot)))
				require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(changes)))
			}
		})
	}
}

func TestSourceAccountingIncludesOwnedCapacityAndMetadata(t *testing.T) {
	base := accountingObservation()
	baseSize, err := sourceMemberSize(base, defaultSourceStagingBytes)
	require.NoError(t, err)

	withCapacity := base
	withCapacity.Record.Body.List = make([]resourcev2.Value, 0, 10)
	size, err := sourceMemberSize(withCapacity, defaultSourceStagingBytes)
	require.NoError(t, err)
	require.GreaterOrEqual(t, size-baseSize, 10*256)

	withMetadata := base
	withMetadata.Metadata = &resourcev2.ResourceMetadata{Labels: map[string]string{"key": strings.Repeat("x", 100)}}
	size, err = sourceMemberSize(withMetadata, defaultSourceStagingBytes)
	require.NoError(t, err)
	require.GreaterOrEqual(t, size-baseSize, 256+8*103)
	_, err = sourceMemberSize(withMetadata, size-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
}

func TestSourceFramePreflightAccountsForRemovalAndEnvelope(t *testing.T) {
	large := strings.Repeat("x", maxSourceSessionBytes/8)
	ref := resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{ID: large}}
	frame := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Reference: &ref}}}}
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(frame)))
	frame = resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Message: large}}
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(frame)))
}

func TestSourceStagingDuplicateReplacementAtLimit(t *testing.T) {
	o := accountingObservation()
	member, key, err := makeSourceMember(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	s := &sourceSession{staging: map[string]sourceMember{key: member}, stagingBytes: defaultSourceStagingBytes}
	_, err = s.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{o}}})
	require.NoError(t, err)
	require.Equal(t, defaultSourceStagingBytes, s.stagingBytes)
	require.Len(t, s.staging, 1)
}

func TestSourceSnapshotRetainedLimitCheckedBeforeApply(t *testing.T) {
	s := &sourceSession{staging: make(map[string]sourceMember), stagingBytes: maxSourceSessionBytes + 1}
	_, err := s.applyLocked(resourcev2.SourceFrame{SnapshotEnd: &resourcev2.SourceSnapshotEnd{}})
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.False(t, s.hasSnapshot)
}
