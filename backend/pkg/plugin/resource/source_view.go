package resource

import (
	"context"
	"encoding/json"
	"reflect"
	"strconv"
	"sync"
	"unsafe"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/telemetry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type queuedSourceViewEvent struct {
	event      HostSourceViewEvent
	bytes      int
	transient  int
	members    []sourceMember
	target     resourcev2.ReadTarget
	binding    resourcev2.Representation
	generation string
}
type sourceView struct {
	session             *sourceSession
	ctrl                *controller
	transientLedger     *sourceTransientLedger
	id, owner, targetID string
	mu                  sync.Mutex
	wake                chan struct{}
	queue               []queuedSourceViewEvent
	bytes               int
	control             *HostSourceViewEvent
	generation          string
	sequence            uint64
	closed              bool
	synced              bool
	snapshot            []sourceMember
	snapshotArrayBytes  int
	snapshotOffset      int
	snapshotSequence    uint64
	snapshotEnds        []int
	snapshotStatus      *HostSourceStatus
	snapshotTarget      resourcev2.ReadTarget
	snapshotBinding     resourcev2.Representation
	snapshotGeneration  string
	retryCancel         chan struct{}
	snapshotMode        string
}

func newSourceView(s *sourceSession, id, owner, targetID string) *sourceView {
	return &sourceView{session: s, ctrl: s.coordinator.ctrl, transientLedger: &s.viewTransientLedger, id: id, owner: owner, targetID: targetID, wake: make(chan struct{}, 1)}
}
func sourceReferenceKey(ref resourcev2.ResourceReference) (string, error) {
	return registry.CanonicalAddressKey(ref.Address)
}
func (v *sourceView) signal() {
	select {
	case v.wake <- struct{}{}:
	default:
	}
}
func (v *sourceView) nextLocked(kind string) HostSourceViewEvent {
	v.sequence++
	return HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: strconv.FormatUint(v.sequence, 10), Kind: kind}
}

// sourceViewSize conservatively bounds JSON before serialization.
func sourceViewSize(value any, limit int) (int, bool) {
	size := 0
	valueType := reflect.TypeFor[resourcev2.Value]()
	kindField, _ := valueType.FieldByName("Kind")
	add := func(n int) bool {
		if n < 0 || n > limit-size {
			return false
		}
		size += n
		return true
	}
	text := func(n int) bool {
		return n <= (limit-size)/6 && add(n*6+2)
	}
	var walk func(reflect.Value, int) bool
	walk = func(v reflect.Value, depth int) bool {
		if !v.IsValid() {
			return add(4)
		}
		// Each SDK value level adds a struct and a map or slice. Reserve
		// additional levels for the enclosing view event and its pointers.
		if depth > 2*resourcev2.MaxValueDepth+32 {
			return false
		}
		switch v.Kind() {
		case reflect.Interface, reflect.Pointer:
			if v.IsNil() {
				return add(4)
			}
			return walk(v.Elem(), depth+1)
		case reflect.String:
			return text(v.Len())
		case reflect.Struct:
			// Value.MarshalJSON emits fields tagged json:"-". Count every
			// variant and its tagged wrapper without materializing JSON.
			if v.Type() == valueType {
				if !add(128) {
					return false
				}
				// SDK protobuf decoding canonicalizes timestamps to UTC.
				// Bound that spelling without materializing the body again.
				if v.Field(kindField.Index[0]).String() == "timestamp" && !text(40) {
					return false
				}
				for i := range v.NumField() {
					if !walk(v.Field(i), depth+1) {
						return false
					}
				}
				return true
			}
			if !add(2) {
				return false
			}
			for i := range v.NumField() {
				field := v.Type().Field(i)
				if field.PkgPath != "" || field.Tag.Get("json") == "-" {
					continue
				}
				name := field.Tag.Get("json")
				if name == "" {
					name = field.Name
				}
				if !text(len(name)) || !add(2) || !walk(v.Field(i), depth+1) {
					return false
				}
			}
			return true
		case reflect.Map:
			if v.IsNil() {
				return add(4)
			}
			if !add(2) {
				return false
			}
			iter := v.MapRange()
			for iter.Next() {
				if !walk(iter.Key(), depth+1) || !add(2) || !walk(iter.Value(), depth+1) {
					return false
				}
			}
			return true
		case reflect.Slice, reflect.Array:
			if v.Kind() == reflect.Slice && v.IsNil() {
				return add(4)
			}
			if v.Type().Elem().Kind() == reflect.Uint8 {
				return text(v.Len())
			}
			if !add(2) {
				return false
			}
			for i := range v.Len() {
				if !add(1) || !walk(v.Index(i), depth+1) {
					return false
				}
			}
			return true
		default:
			return add(32)
		}
	}
	ok := walk(reflect.ValueOf(value), 0)
	return size, ok
}

func (v *sourceView) appendLocked(event HostSourceViewEvent) bool {
	return v.appendReservedLocked(event, 0)
}

func (v *sourceView) appendReservedLocked(event HostSourceViewEvent, transient int) bool {
	if len(v.queue) >= sourceViewQueueItems {
		return false
	}
	if _, ok := sourceViewSize(event, sourceViewQueueBytes-v.bytes); !ok {
		return false
	}
	b, err := json.Marshal(event)
	if err != nil {
		if v.ctrl != nil && v.ctrl.logger != nil {
			v.ctrl.logger.Warnw(
				context.Background(),
				"source view event encoding failed",
				"pluginID",
				v.session.pluginID,
				"errorClass",
				telemetryutil.ErrorClass(err),
			)
		}
		return false
	}
	if len(b) > sourceViewQueueBytes-v.bytes {
		return false
	}
	v.queue = append(v.queue, queuedSourceViewEvent{event: event, bytes: len(b), transient: transient})
	v.bytes += len(b)
	v.signal()
	return true
}

func (v *sourceView) releaseQueueLocked() {
	for i := range v.queue {
		v.queue[i].release(v.transientLedger)
		v.queue[i] = queuedSourceViewEvent{}
	}
	v.queue = nil
	v.bytes = 0
}

func (item queuedSourceViewEvent) release(ledger *sourceTransientLedger) {
	for _, member := range item.members {
		member.release()
	}
	ledger.release(item.transient)
}

// Only the delivery worker materializes bodies. Captured immutable handles and
// all decode/output scratch remain charged through synchronous delivery.
func (item queuedSourceViewEvent) materialize(owner, targetID string) (HostSourceViewEvent, error) {
	event := item.event
	if len(item.members) == 0 {
		return event, nil
	}
	records := make([]HostRecord, 0, len(item.members))
	for _, member := range item.members {
		record, err := materializeSourceRecord(member)
		if err != nil {
			return event, err
		}
		envelope, err := envelopeRecord(item.generation, owner, targetID, item.target, resourcev2.Record{
			Reference: record.Reference, Body: record.Body, Representation: item.binding,
			Coverage: record.Coverage, SourceRevision: record.SourceRevision,
		})
		if err != nil {
			return event, err
		}
		records = append(records, envelope)
	}
	if event.Kind == "snapshot" {
		event.Records = records
	} else {
		event.Upserts = records
	}
	return event, nil
}

// releaseSnapshotLocked drops the view's references to un-emitted members.
func (v *sourceView) releaseSnapshotLocked() {
	for i := range v.snapshot {
		v.snapshot[i].release()
	}
	v.snapshot = nil
	v.snapshotEnds = nil
	if v.snapshotArrayBytes > 0 {
		v.transientLedger.release(v.snapshotArrayBytes)
		v.snapshotArrayBytes = 0
	}
}

// retrySnapshotLocked schedules a bounded view resynchronization without
// waiting under either the session or view lock. The full required capacity
// includes the array released here, avoiding self-wakeup retry loops.
func (v *sourceView) retrySnapshotLocked(required int) {
	v.releaseSnapshotLocked()
	v.snapshotBinding = resourcev2.Representation{}
	v.snapshotTarget = resourcev2.ReadTarget{}
	v.snapshotStatus = nil
	v.synced = false
	if v.retryCancel != nil {
		close(v.retryCancel)
	}
	cancel := make(chan struct{})
	v.retryCancel = cancel
	generation := v.generation
	go func() {
		for {
			changed := v.transientLedger.whenAvailable(required)
			if changed == nil {
				break
			}
			select {
			case <-changed:
			case <-cancel:
				return
			}
		}
		v.session.mu.Lock()
		defer v.session.mu.Unlock()
		v.mu.Lock()
		if v.closed || v.retryCancel != cancel || v.generation != generation {
			v.mu.Unlock()
			return
		}
		v.retryCancel = nil
		v.mu.Unlock()
		v.syncLocked("")
	}()
}

func (v *sourceView) cancelRetryLocked() {
	if v.retryCancel != nil {
		close(v.retryCancel)
		v.retryCancel = nil
	}
}

func (v *sourceView) resetLocked(reason, message string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return
	}
	if reason == "overflow" {
		ctx := v.session.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		telemetry.RecordPluginStreamEvent(ctx, v.session.pluginID, "source", "overflow")
		if v.ctrl != nil && v.ctrl.logger != nil {
			v.ctrl.logger.Warnw(ctx, "source view queue overflow", "pluginID", v.session.pluginID)
		}
	}
	v.cancelRetryLocked()
	if v.generation == "" {
		v.generation = uuid.NewString()
	}
	event := v.nextLocked("reset")
	event.Reset = &HostSourceViewReset{Reason: reason, Message: message}
	v.releaseQueueLocked()
	v.releaseSnapshotLocked()
	v.snapshotEnds = nil
	v.snapshotBinding = resourcev2.Representation{}
	v.snapshotTarget = resourcev2.ReadTarget{}
	v.snapshotStatus = nil
	v.control = &event
	v.synced = false
	v.signal()
}

// failSnapshotLocked emits a terminal, empty snapshot rather than repeatedly
// resynchronizing an envelope that can never fit.
func (v *sourceView) failSnapshotLocked(message string) {
	if v.ctrl != nil && v.ctrl.logger != nil {
		v.ctrl.logger.Warnw(
			context.Background(),
			"source view snapshot failed",
			"pluginID",
			v.session.pluginID,
			"errorClass",
			"other",
		)
	}
	v.cancelRetryLocked()
	v.releaseSnapshotLocked()
	v.snapshotBinding = resourcev2.Representation{}
	v.snapshotTarget = resourcev2.ReadTarget{}
	v.snapshotEnds = nil
	v.snapshotOffset = 0
	v.snapshotSequence = 0
	v.sequence = 1
	v.snapshotStatus = &HostSourceStatus{
		State: "failed",
		Mode:  v.snapshotMode,
		Error: &resourcev2.ResourceOperationError{Code: "RESOURCE_LIMIT", Message: message},
	}
	v.synced = false
	v.signal()
}
func (v *sourceView) snapshotMemberTransient(member sourceMember) (int, bool) {
	return member.transient, member.transient >= 0 && member.transient <= maxSourceTransientBytes
}

func sourceViewRecordSize(member sourceMember, binding resourcev2.Representation, target resourcev2.ReadTarget, targetID string, limit int) (int, bool) {
	h := member.header
	if h == nil || member.bodyOutput < 0 || member.bodyOutput > limit {
		return 0, false
	}
	// Row digests have a fixed length. The canonical address key is admitted
	// once; no body reconstruction or view-specific key is needed for sizing.
	record := HostRecord{
		Key:        "row:" + "0000000000000000000000000000000000000000000000000000000000000000",
		AddressKey: h.key, TargetID: targetID, Route: target.Route,
		Record: resourcev2.Record{
			Reference: h.reference, Representation: binding,
			Coverage: h.coverage, SourceRevision: h.sourceRevision,
		},
	}
	size, ok := sourceViewSize(record, limit-member.bodyOutput)
	return size + member.bodyOutput, ok
}

func (v *sourceView) logError(stage string, err error) {
	if v.ctrl != nil && v.ctrl.logger != nil {
		v.ctrl.logger.Debugw(
			context.Background(),
			"source view processing failed",
			"pluginID",
			v.session.pluginID,
			"stage",
			stage,
			"errorClass",
			telemetryutil.ErrorClass(err),
		)
	}
}

func (v *sourceView) snapshotRecordSize(member sourceMember, limit int) (int, string) {
	cost, ok := v.snapshotMemberTransient(member)
	if !ok {
		return 0, "Source view record exceeds host limits."
	}
	if !v.transientLedger.reserve(cost) {
		return 0, "Source view transient exceeds host limits."
	}
	defer v.transientLedger.release(cost)
	size, ok := sourceViewRecordSize(member, v.snapshotBinding, v.snapshotTarget, v.targetID, limit)
	if !ok {
		return 0, "Source view record exceeds host limits."
	}
	return size, ""
}

func (v *sourceView) syncLocked(reason string) {
	// No source membership is authoritative before the first snapshot boundary.
	// Keep an established snapshot available while a refresh is in progress.
	if !v.session.hasSnapshot && v.session.status.State != "failed" && v.session.status.State != "finished" {
		return
	}
	v.mu.Lock()
	already := v.synced
	v.mu.Unlock()
	if reason != "" && already {
		v.resetLocked(reason, "Source view resynchronized.")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return
	}
	v.cancelRetryLocked()
	v.generation = uuid.NewString()
	v.sequence = 0
	v.synced = true
	v.releaseQueueLocked()
	v.releaseSnapshotLocked()
	v.snapshotMode = v.session.mode
	count := len(v.session.members)
	if count > 0 {
		perMember := int(unsafe.Sizeof(sourceMember{})) + 32
		if count > (maxSourceTransientBytes-256)/perMember {
			v.failSnapshotLocked("Source view snapshot exceeds host limits.")
			return
		}
		bytes := 256 + count*perMember
		if !v.transientLedger.reserve(bytes) {
			v.retrySnapshotLocked(bytes)
			return
		}
		v.snapshotArrayBytes = bytes
	}
	v.snapshot = make([]sourceMember, 0, count)
	v.snapshotTarget = v.session.target
	v.snapshotGeneration = v.session.pluginGeneration.generationID
	if len(v.session.members) > 0 {
		v.snapshotBinding = v.session.ctx.Value(sourceBindingKey{}).(sourceBinding).Representation
	}
	base := HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: "18446744073709551615", Kind: "snapshot"}
	baseBytes, ok := sourceViewSize(base, sourceViewQueueBytes)
	chunkBytes := baseBytes
	chunkTransient := 0
	chunkTransientLimit := maxSourceTransientBytes - v.snapshotArrayBytes
	chunkStart := 0
	for _, member := range v.session.members {
		cost, valid := v.snapshotMemberTransient(member)
		if !valid || cost > chunkTransientLimit {
			v.failSnapshotLocked("Source view record transient exceeds host limits.")
			return
		}
		size, failure := v.snapshotRecordSize(member, sourceViewQueueBytes-baseBytes-1)
		if failure == "Source view transient exceeds host limits." {
			v.retrySnapshotLocked(v.snapshotArrayBytes + cost)
			return
		}
		if !ok || failure != "" {
			if failure == "" {
				failure = "Source view record exceeds host limits."
			}
			v.failSnapshotLocked(failure)
			return
		}
		if len(v.snapshot)-chunkStart == sourceViewChunkRecords || size+1 > sourceViewQueueBytes-chunkBytes || cost > chunkTransientLimit-chunkTransient {
			v.snapshotEnds = append(v.snapshotEnds, len(v.snapshot))
			chunkStart = len(v.snapshot)
			chunkBytes = baseBytes
			chunkTransient = 0
		}
		member.retain()
		v.snapshot = append(v.snapshot, member)
		chunkBytes += size + 1
		chunkTransient += cost
	}
	if len(v.snapshot) > chunkStart {
		v.snapshotEnds = append(v.snapshotEnds, len(v.snapshot))
	}
	status := v.session.status
	end := HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: "18446744073709551615", Kind: "snapshotEnd", Status: &status}
	if _, ok := sourceViewSize(end, sourceViewQueueBytes); !ok {
		v.failSnapshotLocked("Source view status exceeds host limits.")
		return
	}
	v.snapshotStatus = &status
	v.snapshotOffset = 0
	v.snapshotSequence = 0
	v.sequence = uint64(len(v.snapshotEnds) + 1)
	v.signal()
}
func (v *sourceView) statusLocked() {
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return
	}
	if !v.synced {
		v.mu.Unlock()
		if v.session.status.State == "failed" {
			v.syncLocked("")
		}
		return
	}
	event := v.nextLocked("status")
	status := v.session.status
	event.Status = &status
	if !v.appendLocked(event) {
		v.mu.Unlock()
		v.resetLocked("overflow", "Source view queue overflowed.")
		v.syncLocked("")
		return
	}
	v.mu.Unlock()
}
func (v *sourceView) failChangesLocked(event HostSourceViewEvent, message string) {
	if v.ctrl != nil && v.ctrl.logger != nil {
		v.ctrl.logger.Warnw(
			context.Background(),
			"source view change publication failed",
			"pluginID",
			v.session.pluginID,
			"errorClass",
			"other",
		)
	}
	event.Kind = "reset"
	event.Upserts = nil
	event.Removes = nil
	event.Reset = &HostSourceViewReset{Reason: "resync", Message: message}
	v.releaseQueueLocked()
	v.control = &event
	v.generation = uuid.NewString()
	v.failSnapshotLocked(message)
}

func (v *sourceView) changeOutputSize(event HostSourceViewEvent, members []sourceMember) (int, bool) {
	size, ok := sourceViewSize(event, sourceViewQueueBytes)
	if !ok {
		return 0, false
	}
	binding := v.session.ctx.Value(sourceBindingKey{}).(sourceBinding).Representation
	for _, member := range members {
		record, ok := sourceViewRecordSize(member, binding, v.session.target, v.targetID, sourceViewQueueBytes-size-1)
		if !ok {
			return 0, false
		}
		size += record + 1
	}
	return size, true
}

func (v *sourceView) changeTransientEstimate(members []sourceMember, refs []resourcev2.ResourceReference, input int) (int, bool) {
	identity, ok := sourceViewSize(struct {
		Generation, Owner, TargetID string
		Target                      resourcev2.ReadTarget
	}{v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target}, sourceViewQueueBytes)
	if !ok {
		return 0, false
	}
	size := 0
	add := func(n, multiplier int) bool {
		if n < 0 || multiplier <= 0 || n > (maxSourceTransientBytes-size)/multiplier {
			return false
		}
		size += n * multiplier
		return true
	}
	// Account for decoded input, canonical addresses, envelope keys, JSON scratch,
	// and slice growth before any envelope or removal is constructed.
	if !add(input, 8) || !add(len(members)+len(refs), 512) {
		return 0, false
	}
	for range members {
		if !add(identity, 8) {
			return 0, false
		}
	}
	for range refs {
		if !add(identity, 8) {
			return 0, false
		}
	}
	for _, member := range members {
		if !add(member.transient, 1) {
			return 0, false
		}
	}
	for _, ref := range refs {
		member, err := sourceMemberTransientEstimate(resourcev2.SourceObservation{Record: resourcev2.SourceRecord{Reference: ref}}, maxSourceTransientBytes)
		if err != nil || !add(member, 1) {
			return 0, false
		}
	}
	return size, true
}

func (v *sourceView) changesLocked(members []sourceMember, refs []resourcev2.ResourceReference) {
	overflow := func() bool {
		v.mu.Lock()
		defer v.mu.Unlock()
		if v.closed || !v.synced {
			return false
		}
		event := v.nextLocked("changes")
		input, ok := v.changeOutputSize(event, members)
		if !ok {
			return true
		}
		referenceBytes, ok := sourceViewSize(refs, sourceViewQueueBytes-input)
		if !ok {
			return true
		}
		transient, ok := v.changeTransientEstimate(members, refs, input+referenceBytes)
		if !ok {
			v.failChangesLocked(event, "Source view transient exceeds host limits.")
			return false
		}
		if !v.transientLedger.reserve(transient) {
			return true
		}
		defer func() {
			if transient > 0 {
				v.transientLedger.release(transient)
			}
		}()
		for _, ref := range refs {
			key, address, err := rowIdentity(v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target, ref)
			if err != nil {
				v.logError("removal_identity", err)
				v.failChangesLocked(event, "Source view removal could not be enveloped.")
				return false
			}
			event.Removes = append(event.Removes, HostRecordRemoval{Key: key, AddressKey: address})
		}
		size, ok := v.changeOutputSize(event, members)
		if !ok || len(v.queue) >= sourceViewQueueItems || size > sourceViewQueueBytes-v.bytes {
			return true
		}
		owned := append([]sourceMember(nil), members...)
		for _, member := range owned {
			member.retain()
		}
		v.queue = append(v.queue, queuedSourceViewEvent{
			event: event, bytes: size, transient: transient, members: owned,
			target: v.session.target, binding: v.session.ctx.Value(sourceBindingKey{}).(sourceBinding).Representation,
			generation: v.session.pluginGeneration.generationID,
		})
		v.bytes += size
		transient = 0
		v.signal()
		return false
	}()
	if overflow {
		v.resetLocked("overflow", "Source view queue overflowed.")
		v.syncLocked("")
	}
}
func (v *sourceView) close() {
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return
	}
	v.cancelRetryLocked()
	if v.generation == "" {
		v.generation = uuid.NewString()
	}
	event := v.nextLocked("reset")
	event.Reset = &HostSourceViewReset{Reason: "closed", Message: "Source view closed."}
	v.releaseQueueLocked()
	v.releaseSnapshotLocked()
	v.snapshotEnds = nil
	v.snapshotBinding = resourcev2.Representation{}
	v.snapshotTarget = resourcev2.ReadTarget{}
	v.snapshotStatus = nil
	v.control = &event
	v.closed = true
	v.signal()
	v.mu.Unlock()
}
func (v *sourceView) emitLoop() {
	defer func() {
		v.mu.Lock()
		defer v.mu.Unlock()
		v.cancelRetryLocked()
		v.releaseQueueLocked()
		v.closed = true
		v.control = nil
		v.snapshotStatus = nil
		v.snapshotBinding = resourcev2.Representation{}
		v.snapshotTarget = resourcev2.ReadTarget{}
		v.releaseSnapshotLocked()
	}()
	for {
		<-v.wake
	drain:
		for {
			v.mu.Lock()
			var item queuedSourceViewEvent
			switch {
			case v.control != nil:
				item.event = *v.control
				v.control = nil
			case v.snapshotStatus != nil:
				v.snapshotSequence++
				item.event = HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: strconv.FormatUint(v.snapshotSequence, 10)}
				if v.snapshotOffset < len(v.snapshot) {
					end := v.snapshotEnds[0]
					transient, valid := 0, true
					for i := v.snapshotOffset; i < end; i++ {
						cost, ok := v.snapshotMemberTransient(v.snapshot[i])
						if !ok || cost > maxSourceTransientBytes-transient {
							valid = false
							break
						}
						transient += cost
					}
					reserved := valid && v.transientLedger.reserve(transient)
					if !reserved {
						item.event.Kind = "reset"
						item.event.Reset = &HostSourceViewReset{Reason: "resync", Message: "Source view transient exceeds host limits."}
						v.releaseQueueLocked()
						v.generation = uuid.NewString()
						if valid {
							v.retrySnapshotLocked(v.snapshotArrayBytes + transient)
						} else {
							v.failSnapshotLocked("Source view transient exceeds host limits.")
						}
					} else {
						item.event.Kind = "snapshot"
						item.transient = transient
						item.target, item.binding, item.generation = v.snapshotTarget, v.snapshotBinding, v.snapshotGeneration
						// Transfer references into a bounded chunk. A concurrent reset
						// cannot release these handles or retain the full snapshot array.
						item.members = append([]sourceMember(nil), v.snapshot[v.snapshotOffset:end]...)
						for i := v.snapshotOffset; i < end; i++ {
							v.snapshot[i] = sourceMember{}
						}
						v.snapshotOffset = end
						v.snapshotEnds = v.snapshotEnds[1:]
					}
				} else {
					item.event.Kind = "snapshotEnd"
					item.event.Status = v.snapshotStatus
					v.releaseSnapshotLocked()
					v.snapshotBinding = resourcev2.Representation{}
					v.snapshotTarget = resourcev2.ReadTarget{}
					v.snapshotStatus = nil
				}
			case len(v.queue) > 0:
				item = v.queue[0]
				v.queue[0] = queuedSourceViewEvent{}
				v.queue = v.queue[1:]
				v.bytes -= item.bytes
			default:
				closed := v.closed
				v.mu.Unlock()
				if closed {
					return
				}
				break drain
			}
			v.mu.Unlock()
			func() {
				defer item.release(v.transientLedger)
				event, err := item.materialize(v.owner, v.targetID)
				if err != nil {
					v.logError("materialize", err)
					event.Kind = "reset"
					event.Records, event.Upserts, event.Removes = nil, nil, nil
					event.Reset = &HostSourceViewReset{Reason: "resync", Message: "Source view record could not be decoded."}
					v.mu.Lock()
					if !v.closed && v.generation == event.ViewGeneration {
						v.releaseQueueLocked()
						v.generation = uuid.NewString()
						v.failSnapshotLocked("Source view record could not be decoded.")
					}
					v.mu.Unlock()
				}
				if emitter := v.ctrl.emitter; emitter != nil {
					emitter.Emit("resource/source-view/"+v.id, event)
				}
			}()
		}
	}
}
