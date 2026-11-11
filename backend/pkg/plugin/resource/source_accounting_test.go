package resource

import (
	"context"
	"fmt"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

func accountingObservation() resourcev2.SourceObservation {
	record := sourceTestRecord(resourcev2.ReadTarget{Provider: "p", Authority: "a", Type: "t"}, "id", "")
	return resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
}

func accountingStagingSession() *sourceSession {
	return &sourceSession{
		staging: make(map[string]sourceMember),
		ctx:     context.WithValue(context.Background(), sourceBindingKey{}, sourceBinding{Representation: canonicalTestRepresentation()}),
	}
}

func nestedAccountingValue(depth int) resourcev2.Value {
	value := resourcev2.Value{Kind: "string", String: "leaf"}
	for i := range depth {
		if i%2 == 0 && i != depth-1 {
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
			_, err := sourceMemberEstimate(observation, defaultSourceStagingBytes)
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

func TestSourceAccountingIncludesMetadataAndIgnoresSpareCapacity(t *testing.T) {
	base := accountingObservation()
	base.Record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"list": {Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "value"}}}}}
	baseSize, err := sourceMemberEstimate(base, defaultSourceStagingBytes)
	require.NoError(t, err)

	withCapacity := base
	list := make([]resourcev2.Value, 1, 100)
	list[0] = base.Record.Body.Map["list"].List[0]
	withCapacity.Record.Body.Map = map[string]resourcev2.Value{"list": {Kind: "list", List: list}}
	size, err := sourceMemberEstimate(withCapacity, defaultSourceStagingBytes)
	require.NoError(t, err)
	require.Equal(t, baseSize, size)
	baseTransient, err := sourceMemberTransientEstimate(base, maxSourceTransientBytes)
	require.NoError(t, err)
	capacityTransient, err := sourceMemberTransientEstimate(withCapacity, maxSourceTransientBytes)
	require.NoError(t, err)
	require.GreaterOrEqual(t, capacityTransient-baseTransient, 99*256)
	_, err = sourceMemberTransientEstimate(withCapacity, capacityTransient-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))

	withMetadata := base
	withMetadata.Metadata = &resourcev2.ResourceMetadata{Labels: map[string]string{"key": strings.Repeat("x", 100)}}
	size, err = sourceMemberEstimate(withMetadata, defaultSourceStagingBytes)
	require.NoError(t, err)
	require.Greater(t, size, baseSize)
	_, err = sourceMemberEstimate(withMetadata, size-1)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	member, _, err := makeTestSourceMember(withMetadata, defaultSourceStagingBytes)
	require.NoError(t, err)
	decoded, err := materializeSourceMember(member)
	require.NoError(t, err)
	require.Equal(t, withMetadata, decoded)
}

func podAccountingObservation(i int) resourcev2.SourceObservation {
	o := accountingObservation()
	o.Record.Reference.Address.ID = fmt.Sprintf("pod-%d", i)
	o.Record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"apiVersion": {Kind: "string", String: "v1"},
		"kind":       {Kind: "string", String: "Pod"},
		"metadata": {Kind: "map", Map: map[string]resourcev2.Value{
			"name":      {Kind: "string", String: fmt.Sprintf("pod-%d", i)},
			"namespace": {Kind: "string", String: "default"},
			"labels": {Kind: "map", Map: map[string]resourcev2.Value{
				"app": {Kind: "string", String: "example"},
			}},
			"managedFields": {Kind: "list", List: []resourcev2.Value{{Kind: "map", Map: map[string]resourcev2.Value{
				"manager": {Kind: "string", String: "controller"},
				"fieldsV1": {Kind: "map", Map: map[string]resourcev2.Value{
					"f:metadata": {Kind: "map", Map: map[string]resourcev2.Value{
						"f:labels": {Kind: "map", Map: map[string]resourcev2.Value{"f:app": {Kind: "map"}}},
					}},
				}},
			}}}},
		}},
		"spec": {Kind: "map", Map: map[string]resourcev2.Value{
			"containers": {Kind: "list", List: []resourcev2.Value{
				{Kind: "map", Map: map[string]resourcev2.Value{
					"name":  {Kind: "string", String: "app"},
					"image": {Kind: "string", String: "example/app:latest"},
				}},
			}},
		}},
		"status": {Kind: "map", Map: map[string]resourcev2.Value{
			"phase": {Kind: "string", String: "Running"},
		}},
	}}
	return o
}

func TestSourceStagingPodShapedCapacity(t *testing.T) {
	s := accountingStagingSession()
	for i := range 700 {
		o := podAccountingObservation(i)
		_, err := s.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{o}}})
		require.NoError(t, err)
	}
	require.Len(t, s.staging, 700)
	require.LessOrEqual(t, s.stagingBytes, defaultSourceStagingBytes)
}

func TestSourceLedgerReleaseNotifications(t *testing.T) {
	var ledger sourceMemberLedger
	require.True(t, ledger.reserve(10))
	first := ledger.changes()
	require.Equal(t, first, ledger.changes())
	ledger.release(0)
	select {
	case <-first:
		t.Fatal("zero release notified waiters")
	default:
	}
	ledger.release(5)
	select {
	case <-first:
	default:
		t.Fatal("positive release did not notify waiters")
	}
	second := ledger.changes()
	require.NotEqual(t, first, second)
	ledger.release(5)
	select {
	case <-second:
	default:
		t.Fatal("next release did not notify new waiters")
	}
}

func TestSourceTransientLedgerAvailability(t *testing.T) {
	var ledger sourceTransientLedger
	require.Nil(t, ledger.whenAvailable(maxSourceTransientBytes))
	require.True(t, ledger.reserve(maxSourceTransientBytes))
	wait := ledger.whenAvailable(1)
	require.NotNil(t, wait)
	ledger.release(1)
	select {
	case <-wait:
	default:
		t.Fatal("release did not notify availability waiter")
	}
	require.Nil(t, ledger.whenAvailable(1))
	ledger.release(maxSourceTransientBytes - 1)
}

func TestSourcePackedPodFrameAdmission(t *testing.T) {
	observations := make([]resourcev2.SourceObservation, defaultSourceMaxBatchItems)
	for i := range observations {
		observations[i] = podAccountingObservation(i)
		// Mix large and medium anonymous managedFields trees so the full
		// negotiated batch exercises dense, nonempty ownership maps.
		fieldCount := 500
		if i < len(observations)/2 {
			fieldCount = 1000
		}
		fields := make(map[string]resourcev2.Value, fieldCount)
		for field := range fieldCount {
			fields[fmt.Sprintf("f:field-%03d", field)] = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
				"f:name":    {Kind: "string", String: "anonymous"},
				"f:enabled": {Kind: "bool", Bool: true},
				"f:version": {Kind: "string", String: "revision"},
			}}
		}
		metadata := observations[i].Record.Body.Map["metadata"]
		metadata.Map["managedFields"].List[0].Map["fieldsV1"].Map["f:spec"] = resourcev2.Value{Kind: "map", Map: fields}
		_, err := resourcev2.SourceObservationWireSize(observations[i])
		require.NoError(t, err)
	}
	frame := resourcev2.SourceFrame{SessionID: "session", Generation: "generation", Sequence: 1, Snapshot: &resourcev2.SourceSnapshot{Observations: observations}}
	wire, err := resourcev2.ToProtoSourceFrame(frame)
	require.NoError(t, err)
	encoded, err := proto.Marshal(wire)
	require.NoError(t, err)
	require.LessOrEqual(t, len(encoded), resourcev2.MaxSourceFrameBytes)
	require.NoError(t, resourceplugin.ValidateWire(encoded, wire.ProtoReflect().Descriptor()))
	decoded, err := resourcev2.FromProtoSourceFrame(wire)
	require.NoError(t, err)
	require.NoError(t, sourceFramePreflight(decoded))
	frameCost, err := sourceFrameTransientEstimate(decoded, maxSourceTransientBytes)
	require.NoError(t, err)
	maxMember := 0
	for _, observation := range decoded.Snapshot.Observations {
		cost, err := sourceMemberTransientEstimate(observation, maxSourceTransientBytes)
		require.NoError(t, err)
		if cost > maxMember {
			maxMember = cost
		}
	}
	require.Less(t, frameCost+maxMember, maxSourceTransientBytes*9/10)
	s := accountingStagingSession()
	_, err = s.applyLocked(decoded)
	require.NoError(t, err)
	require.Len(t, s.staging, len(observations))
}

func TestSourceDenseWireValidFrameHitsTransientSafetyLimit(t *testing.T) {
	o := accountingObservation()
	values := make([]resourcev2.Value, 220000)
	for i := range values {
		values[i] = resourcev2.Value{Kind: "bool"}
	}
	o.Record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"items": {Kind: "list", List: values},
	}}
	require.NoError(t, resourcev2.ValidateSourceObservation(
		resourcev2.ReadTarget{Provider: "p", Authority: "a", Type: "t", Representation: "native"},
		"native", o,
	))
	frame := resourcev2.SourceFrame{SessionID: "session", Generation: "generation", Sequence: 1, Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{o}}}
	wire, err := resourcev2.ToProtoSourceFrame(frame)
	require.NoError(t, err)
	encoded, err := proto.Marshal(wire)
	require.NoError(t, err)
	require.LessOrEqual(t, len(encoded), resourcev2.MaxSourceFrameBytes)
	require.NoError(t, resourceplugin.ValidateWire(encoded, wire.ProtoReflect().Descriptor()))
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(frame)))
	s := &sourceSession{staging: make(map[string]sourceMember)}
	_, err = s.applyLocked(frame)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.Empty(t, s.staging)
}

func TestSourceMemberLedgerRetainsSnapshotUntilRelease(t *testing.T) {
	member, _, err := makeTestSourceMember(accountingObservation(), maxSourceSessionBytes)
	require.NoError(t, err)
	var ledger sourceMemberLedger
	require.True(t, ledger.reserve(member.size))
	member.attachReserved(&ledger)
	member.retain()  // A lazy view snapshot holds the old blob.
	member.release() // Membership is replaced.
	require.False(t, ledger.reserve(maxSourceSessionBytes-member.size+1))
	member.release() // The snapshot is emitted or retired.
	require.True(t, ledger.reserve(maxSourceSessionBytes))
	ledger.release(maxSourceSessionBytes)
}

func TestSourceViewSnapshotKeepsRemovedMemberCharged(t *testing.T) {
	for _, retire := range []string{"reset", "close"} {
		t.Run(retire, func(t *testing.T) {
			v := boundedSourceViewFixture(t, 0, 1)
			s := v.session
			s.pluginID = "p1"
			s.pluginGeneration = s.coordinator.ctrl.plugins["p1"]
			observation, err := materializeSourceMember(s.members["0"])
			require.NoError(t, err)
			member, key, err := makeTestSourceMember(observation, maxSourceSessionBytes)
			require.NoError(t, err)
			require.True(t, s.memberLedger.reserve(member.size))
			member.attachReserved(&s.memberLedger)
			s.members = map[string]sourceMember{key: member}
			s.memberBytes = member.size

			v.syncLocked("")
			require.True(t, v.synced)
			require.Len(t, v.snapshot, 1)
			ref := observation.Record.Reference
			change := resourcev2.SourceChange{Kind: resourcev2.SourceChangeRemove, Reference: &ref}
			descriptor := canonicalTestCatalog("p1", s.target.Type).Types[0]
			_, err = s.applyLocked(resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{change}}}, sourceFrameContext{ctx: s.ctx, target: s.target, descriptor: &descriptor})
			require.NoError(t, err)
			require.Empty(t, s.members)
			require.Zero(t, s.memberBytes)
			require.False(t, s.memberLedger.reserve(maxSourceSessionBytes-member.size+1))

			if retire == "reset" {
				v.resetLocked("test", "retire snapshot")
			} else {
				v.close()
			}
			require.True(t, s.memberLedger.reserve(maxSourceSessionBytes))
			s.memberLedger.release(maxSourceSessionBytes)
		})
	}
}

func TestSourceFramePreflightAccountsForRemovalAndEnvelope(t *testing.T) {
	large := strings.Repeat("x", maxSourceSessionBytes/8)
	ref := resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{ID: large}}
	frame := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Reference: &ref}}}}
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(frame)))
	frame = resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Message: large}}
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(sourceFramePreflight(frame)))
}

func TestSourceApplyUsesSDKBatchBound(t *testing.T) {
	for _, snapshot := range []bool{true, false} {
		for _, count := range []int{resourcev2.MaxSourceBatchItems, resourcev2.MaxSourceBatchItems + 1} {
			t.Run(fmt.Sprintf("snapshot=%t/count=%d", snapshot, count), func(t *testing.T) {
				v := boundedSourceViewFixture(t, 0, 0)
				s := v.session
				s.pluginID = "p1"
				s.pluginGeneration = s.coordinator.ctrl.plugins["p1"]
				s.staging = make(map[string]sourceMember)
				observations := make([]resourcev2.SourceObservation, count)
				changes := make([]resourcev2.SourceChange, count)
				for i := range observations {
					record := sourceTestRecord(s.target, fmt.Sprintf("member-%d", i), "")
					observations[i] = resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
					changes[i] = resourcev2.SourceChange{Kind: resourcev2.SourceChangeUpsert, Observation: &observations[i]}
				}
				frame := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: changes}}
				if snapshot {
					frame = resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}}
				}
				descriptor := canonicalTestCatalog("p1", s.target.Type).Types[0]
				_, err := s.applyLocked(frame, sourceFrameContext{ctx: s.ctx, target: s.target, descriptor: &descriptor})
				if count > resourcev2.MaxSourceBatchItems {
					require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
					require.Empty(t, s.staging)
					require.Empty(t, s.members)
					require.Zero(t, s.stagingBytes)
					require.Zero(t, s.memberBytes)
					return
				}
				require.NoError(t, err)
				if snapshot {
					require.Len(t, s.staging, count)
				} else {
					require.Len(t, s.members, count)
					for _, member := range s.members {
						member.release()
					}
				}
			})
		}
	}
}

func TestSourceApplyRejectsMultipleMemberPayloadsBeforePacking(t *testing.T) {
	s := accountingStagingSession()
	o := accountingObservation()
	frame := resourcev2.SourceFrame{
		Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{o}},
		Changes:  &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Observation: &o}}},
	}
	_, err := s.applyLocked(frame)
	require.Error(t, err)
	require.Empty(t, s.staging)
	require.Zero(t, s.stagingBytes)
	require.Zero(t, s.memberBytes)
}

func TestSourceStagingDuplicateReplacementRequiresCoexistenceHeadroom(t *testing.T) {
	o := accountingObservation()
	member, key, err := makeTestSourceMember(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	estimate, err := sourceMemberEstimate(o, defaultSourceStagingBytes)
	require.NoError(t, err)
	for _, tc := range []struct {
		name         string
		stagingBytes int
		wantError    bool
	}{
		{name: "exact headroom", stagingBytes: defaultSourceStagingBytes - estimate},
		{name: "one byte short", stagingBytes: defaultSourceStagingBytes - estimate + 1, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := accountingStagingSession()
			s.staging, s.stagingBytes, s.memberBytes = map[string]sourceMember{key: member}, tc.stagingBytes, maxSourceSessionBytes
			_, err := s.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{o}}})
			if tc.wantError {
				require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, tc.stagingBytes, s.stagingBytes)
			require.Len(t, s.staging, 1)
			decoded, err := materializeSourceMember(s.staging[key])
			require.NoError(t, err)
			require.Equal(t, o, decoded)
		})
	}
}

func TestSourceChangesDuplicateBatchCountsCoexistingMembers(t *testing.T) {
	o := accountingObservation()
	member, key, err := makeTestSourceMember(o, maxSourceSessionBytes)
	require.NoError(t, err)
	initialBytes := maxSourceSessionBytes - 2*member.size + 1
	s := &sourceSession{members: map[string]sourceMember{key: member}, memberBytes: initialBytes}
	change := resourcev2.SourceChange{Kind: resourcev2.SourceChangeUpsert, Observation: &o}
	_, err = s.applyLocked(resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{change, change}}})
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.Equal(t, initialBytes, s.memberBytes)
	require.Len(t, s.members, 1)
	decoded, err := materializeSourceMember(s.members[key])
	require.NoError(t, err)
	require.Equal(t, o, decoded)
}

func TestSourceChangesRejectMembershipBeyondSnapshotLimit(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	s := v.session
	s.pluginID = "p1"
	s.pluginGeneration = s.coordinator.ctrl.plugins["p1"]
	original, err := materializeSourceMember(s.members["0"])
	require.NoError(t, err)
	member, key, err := makeTestSourceMember(original, maxSourceSessionBytes)
	require.NoError(t, err)
	s.members = map[string]sourceMember{key: member}
	s.memberBytes = defaultSourceStagingBytes
	require.True(t, s.memberLedger.reserve(s.memberBytes))

	added := original
	added.Record.Reference.Address.ID = "added"
	frame := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{
		{Kind: resourcev2.SourceChangeUpsert, Observation: &added},
	}}}
	descriptor := canonicalTestCatalog("p1", s.target.Type).Types[0]
	require.NoError(t, s.validateFrameObservation(sourceFrameContext{ctx: s.ctx, target: s.target, descriptor: &descriptor}, added))
	_, err = s.applyLocked(frame, sourceFrameContext{ctx: s.ctx, target: s.target, descriptor: &descriptor})
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.Equal(t, defaultSourceStagingBytes, s.memberBytes)
	require.Len(t, s.members, 1)
}

func TestSourceSnapshotInvalidLaterObservationLeavesMembershipAndAccountingUntouched(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	t.Cleanup(func() { require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)) })
	firstOpen := sourceNextOpen(t, provider)
	original := sourceTestRecord(target.Target, "original", "original-incarnation")
	sourceSend(firstOpen.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(original)}}}})
	sourceSend(firstOpen.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
	current, err := ctrl.sourceView(testInvocationContext(), "p1", view.ViewID, "resource.SyncSourceView")
	require.NoError(t, err)
	session := current.session
	session.mu.Lock()
	retained := session.memberBytes
	session.mu.Unlock()

	require.NoError(t, ctrl.RefreshSourceView(testInvocationContext(), "p1", view.ViewID))
	refresh := sourceNextOpen(t, provider)
	valid := sourceTestRecord(target.Target, "valid-prefix", "")
	sourceSend(refresh.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(valid)}}}})
	invalid := sourceTestRecord(target.Target, "invalid-later", "")
	invalid.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"present": {Kind: "string", String: "value"}}}
	present := "present"
	sourceSend(refresh.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{
		Record:           resourcev2.CompactSourceRecord(invalid),
		DocumentCoverage: resourcev2.DocumentCoverage{KnownAbsent: []resourcev2.DocumentFieldPath{{Segments: []resourcev2.FieldPathSegment{{Member: &present}}}}},
	}}}})
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Status != nil && event.Status.State == "failed"
	})
	session.mu.Lock()
	defer session.mu.Unlock()
	require.Len(t, session.members, 1)
	originalKey, err := sourceReferenceKey(original.Reference)
	require.NoError(t, err)
	require.Contains(t, session.members, originalKey)
	for _, reference := range []resourcev2.ResourceReference{valid.Reference, invalid.Reference} {
		key, err := sourceReferenceKey(reference)
		require.NoError(t, err)
		require.NotContains(t, session.members, key, "a rejected snapshot must not publish its valid prefix")
	}
	require.Empty(t, session.staging)
	require.Zero(t, session.stagingBytes)
	require.Equal(t, retained, session.memberBytes)
	require.False(t, session.memberLedger.reserve(maxSourceSessionBytes-retained+1))
}

func TestSourceChangesInvalidSecondLeavesMembershipAndAccountingUntouched(t *testing.T) {
	v := boundedSourceViewFixture(t, 0, 1)
	s := v.session
	s.pluginID = "p1"
	s.pluginGeneration = s.coordinator.ctrl.plugins["p1"]
	original, err := materializeSourceMember(s.members["0"])
	require.NoError(t, err)
	member, key, err := makeTestSourceMember(original, maxSourceSessionBytes)
	require.NoError(t, err)
	require.True(t, s.memberLedger.reserve(member.size))
	member.attachReserved(&s.memberLedger)
	s.members = map[string]sourceMember{key: member}
	s.memberBytes = member.size

	first := original
	first.Record.Reference.Address.ID = "first"
	second := original
	second.Record.Reference.Address.ID = "second"
	second.Record.Reference.Address.Provider = "other"
	frame := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{
		{Kind: resourcev2.SourceChangeUpsert, Observation: &first},
		{Kind: resourcev2.SourceChangeUpsert, Observation: &second},
	}}}
	descriptor := canonicalTestCatalog("p1", s.target.Type).Types[0]
	_, err = s.applyLocked(frame, sourceFrameContext{ctx: s.ctx, target: s.target, descriptor: &descriptor})
	require.Error(t, err)
	require.Len(t, s.members, 1)
	require.Equal(t, member.size, s.memberBytes)
	require.Contains(t, s.members, key)
	firstKey, err := sourceReferenceKey(first.Record.Reference)
	require.NoError(t, err)
	require.NotContains(t, s.members, firstKey)
	retained, err := materializeSourceRecord(s.members[key])
	require.NoError(t, err)
	require.Equal(t, original.Record, retained)
	require.False(t, s.memberLedger.reserve(maxSourceSessionBytes-member.size+1))
}

func TestSourceSnapshotRetainedLimitCheckedBeforeApply(t *testing.T) {
	s := &sourceSession{staging: make(map[string]sourceMember), stagingBytes: maxSourceSessionBytes + 1}
	_, err := s.applyLocked(resourcev2.SourceFrame{SnapshotEnd: &resourcev2.SourceSnapshotEnd{}})
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.False(t, s.hasSnapshot)
}

func TestSourceDenseSnapshotUsesPackedRetentionBudget(t *testing.T) {
	ctrl, _, _, target := sourceTestFixture(t)
	admitted, err := ctrl.admit(testInvocationContext(), "resource.OpenSourceView", readTarget("p1", target.Target))
	require.NoError(t, err)
	_, generation, ctx, cancel, mode, owner, err := ctrl.sources.prepare(admitted, "p1", target.Target, "none")
	require.NoError(t, err)
	t.Cleanup(cancel)
	binding := ctx.Value(sourceBindingKey{}).(sourceBinding)
	session := &sourceSession{
		coordinator: ctrl.sources, pluginID: "p1", owner: owner, target: target.Target,
		pluginGeneration: generation, ctx: ctx, cancel: cancel, mode: mode,
		staging: make(map[string]sourceMember),
	}
	frameContext := sourceFrameContext{ctx: ctx, target: target.Target, descriptor: &binding.Descriptor}
	body := resourcev2.Value{Kind: "map", Map: make(map[string]resourcev2.Value)}
	for i := range 256 {
		body.Map[fmt.Sprintf("condition-%03d", i)] = resourcev2.Value{Kind: "bool", Bool: i%2 == 0}
	}
	body.Map["counter"] = resourcev2.Value{Kind: "uint64", Uint: "18446744073709551615"}
	body.Map["message"] = resourcev2.Value{Kind: "string", String: "retained 雪\n\"exact\""}
	const count = 5_120
	for start := 0; start < count; start += 16 {
		observations := make([]resourcev2.SourceObservation, 0, 16)
		for i := start; i < start+16; i++ {
			record := sourceTestRecord(target.Target, fmt.Sprintf("dense-%05d", i), "")
			observation := resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
			observation.Record.Body = body
			observations = append(observations, observation)
		}
		_, err := session.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}}, frameContext)
		require.NoError(t, err)
	}
	_, err = session.applyLocked(sourceBoundary(resourcev2.EnumerationExhausted), frameContext)
	require.NoError(t, err)
	require.True(t, session.hasSnapshot)
	require.Len(t, session.members, count)
	samples := map[string]bool{"dense-00000": false, fmt.Sprintf("dense-%05d", count-1): false}
	for _, member := range session.members {
		id := member.header.reference.Address.ID
		if _, wanted := samples[id]; wanted {
			observation, err := materializeSourceMember(member)
			require.NoError(t, err)
			require.Equal(t, body, observation.Record.Body)
			samples[id] = true
		}
	}
	for id, found := range samples {
		require.True(t, found, "missing admitted identity %s", id)
	}
}
