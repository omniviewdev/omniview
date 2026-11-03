package resource

import (
	"encoding/json"
	"reflect"
	"strconv"
	"sync"
	"unsafe"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type queuedSourceViewEvent struct {
	event     HostSourceViewEvent
	bytes     int
	transient int
}
type sourceView struct {
	session                  *sourceSession
	ctrl                     *controller
	transientLedger          *sourceTransientLedger
	id, owner, targetID      string
	mu                       sync.Mutex
	wake                     chan struct{}
	queue                    []queuedSourceViewEvent
	bytes                    int
	control                  *HostSourceViewEvent
	generation               string
	sequence                 uint64
	closed                   bool
	synced                   bool
	snapshot                 []sourceMember
	snapshotArrayBytes       int
	snapshotOffset           int
	snapshotSequence         uint64
	snapshotEnds             []int
	snapshotStatus           *HostSourceStatus
	snapshotTarget           resourcev2.ReadTarget
	snapshotBinding          resourcev2.Representation
	snapshotBindingTransient int
	snapshotGeneration       string
	retryCancel              chan struct{}
	snapshotMode             string
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
			if v.Type() == reflect.TypeFor[resourcev2.Value]() {
				if !add(128) {
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
	if err != nil || len(b) > sourceViewQueueBytes-v.bytes {
		return false
	}
	v.queue = append(v.queue, queuedSourceViewEvent{event: event, bytes: len(b), transient: transient})
	v.bytes += len(b)
	v.signal()
	return true
}

func (v *sourceView) releaseQueueLocked() {
	for i := range v.queue {
		v.transientLedger.release(v.queue[i].transient)
		v.queue[i] = queuedSourceViewEvent{}
	}
	v.queue = nil
	v.bytes = 0
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
	if member.transient < 0 || v.snapshotBindingTransient < 0 || v.snapshotBindingTransient > maxSourceTransientBytes || member.transient > maxSourceTransientBytes-v.snapshotBindingTransient {
		return 0, false
	}
	return member.transient + v.snapshotBindingTransient, true
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
	observation, err := decodeSourceMember(member)
	if err != nil {
		return 0, "Source view record could not be decoded."
	}
	record, err := envelopeRecord(v.snapshotGeneration, v.owner, v.targetID, v.snapshotTarget, resourcev2.Record{Reference: observation.Record.Reference, Body: observation.Record.Body, Representation: v.snapshotBinding, Coverage: observation.Record.Coverage, SourceRevision: observation.Record.SourceRevision})
	if err != nil {
		return 0, "Source view record could not be enveloped."
	}
	size, ok := sourceViewSize(record, limit)
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
		var err error
		v.snapshotBindingTransient, err = sourceBindingTransientEstimate(v.snapshotBinding)
		if err != nil || v.snapshotBindingTransient < 0 || v.snapshotBindingTransient > maxSourceTransientBytes {
			v.failSnapshotLocked("Source view binding exceeds host limits.")
			return
		}
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
	event.Kind = "reset"
	event.Upserts = nil
	event.Removes = nil
	event.Reset = &HostSourceViewReset{Reason: "resync", Message: message}
	v.releaseQueueLocked()
	v.control = &event
	v.generation = uuid.NewString()
	v.failSnapshotLocked(message)
}

func (v *sourceView) changeTransientEstimate(records []resourcev2.Record, refs []resourcev2.ResourceReference) (int, bool) {
	input, ok := sourceViewSize(struct {
		Records []resourcev2.Record
		Refs    []resourcev2.ResourceReference
	}{records, refs}, sourceViewQueueBytes)
	if !ok {
		return 0, false
	}
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
	if !add(input, 8) || !add(len(records)+len(refs), 512) {
		return 0, false
	}
	for range records {
		if !add(identity, 8) {
			return 0, false
		}
	}
	for range refs {
		if !add(identity, 8) {
			return 0, false
		}
	}
	for _, record := range records {
		scratch, err := sourceBindingTransientEstimate(record.Representation)
		if err != nil || !add(scratch, 1) {
			return 0, false
		}
		member, err := sourceMemberTransientEstimate(resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}, maxSourceTransientBytes)
		if err != nil || !add(member, 1) {
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

func (v *sourceView) changesLocked(records []resourcev2.Record, refs []resourcev2.ResourceReference) {
	overflow := func() bool {
		v.mu.Lock()
		defer v.mu.Unlock()
		if v.closed || !v.synced {
			return false
		}
		event := v.nextLocked("changes")
		if _, ok := sourceViewSize(struct {
			Records []resourcev2.Record
			Refs    []resourcev2.ResourceReference
		}{records, refs}, sourceViewQueueBytes); !ok {
			return true
		}
		transient, ok := v.changeTransientEstimate(records, refs)
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
		for _, record := range records {
			r, err := envelopeRecord(v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target, record)
			if err != nil {
				v.failChangesLocked(event, "Source view record could not be enveloped.")
				return false
			}
			event.Upserts = append(event.Upserts, r)
		}
		for _, ref := range refs {
			key, address, err := rowIdentity(v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target, ref)
			if err != nil {
				v.failChangesLocked(event, "Source view removal could not be enveloped.")
				return false
			}
			event.Removes = append(event.Removes, HostRecordRemoval{Key: key, AddressKey: address})
		}
		if !v.appendReservedLocked(event, transient) {
			return true
		}
		transient = 0
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
		for {
			closed, idle := func() (bool, bool) {
				v.mu.Lock()
				locked := true
				reserved := 0
				defer func() {
					if locked {
						v.mu.Unlock()
					}
					if reserved > 0 {
						v.transientLedger.release(reserved)
					}
				}()
				var event HostSourceViewEvent
				if v.control != nil {
					event = *v.control
					v.control = nil
				} else if v.snapshotStatus != nil {
					v.snapshotSequence++
					event = HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: strconv.FormatUint(v.snapshotSequence, 10)}
					if v.snapshotOffset < len(v.snapshot) {
						end := v.snapshotEnds[0]
						v.snapshotEnds = v.snapshotEnds[1:]
						event.Kind = "snapshot"
						transient := 0
						failed := false
						failureMessage := "Source view transient exceeds host limits."
						contended := false
						for i := v.snapshotOffset; i < end; i++ {
							cost, valid := v.snapshotMemberTransient(v.snapshot[i])
							if !valid || cost > maxSourceTransientBytes-transient {
								failed = true
								break
							}
							transient += cost
						}
						if !failed && v.transientLedger.reserve(transient) {
							reserved = transient
							event.Records = make([]HostRecord, 0, end-v.snapshotOffset)
						} else if !failed {
							contended = true
							failed = true
						}
						for i := v.snapshotOffset; !failed && i < end; i++ {
							member := v.snapshot[i]
							observation, err := decodeSourceMember(member)
							if err != nil {
								failureMessage = "Source view snapshot could not be decoded."
								failed = true
								break
							}
							record, err := envelopeRecord(v.snapshotGeneration, v.owner, v.targetID, v.snapshotTarget, resourcev2.Record{Reference: observation.Record.Reference, Body: observation.Record.Body, Representation: v.snapshotBinding, Coverage: observation.Record.Coverage, SourceRevision: observation.Record.SourceRevision})
							if err != nil {
								failureMessage = "Source view snapshot could not be enveloped."
								failed = true
								break
							}
							event.Records = append(event.Records, record)
							v.snapshot[i].release()
							v.snapshot[i] = sourceMember{}
						}
						if failed {
							event.Kind = "reset"
							event.Records = nil
							event.Reset = &HostSourceViewReset{Reason: "resync", Message: failureMessage}
							v.releaseQueueLocked()
							v.generation = uuid.NewString()
							if contended {
								v.retrySnapshotLocked(v.snapshotArrayBytes + transient)
							} else {
								v.failSnapshotLocked(failureMessage)
							}
						} else {
							v.snapshotOffset = end
						}
					} else {
						event.Kind = "snapshotEnd"
						event.Status = v.snapshotStatus
						v.releaseSnapshotLocked()
						v.snapshotBinding = resourcev2.Representation{}
						v.snapshotTarget = resourcev2.ReadTarget{}
						v.snapshotStatus = nil
					}
				} else if len(v.queue) > 0 {
					item := v.queue[0]
					v.queue[0] = queuedSourceViewEvent{}
					v.queue = v.queue[1:]
					v.bytes -= item.bytes
					event = item.event
					reserved = item.transient
				} else {
					return v.closed, true
				}
				v.mu.Unlock()
				locked = false
				if emitter := v.ctrl.emitter; emitter != nil {
					emitter.Emit("resource/source-view/"+v.id, event)
				}
				return false, false
			}()
			if closed {
				return
			}
			if idle {
				break
			}
		}
	}
}
