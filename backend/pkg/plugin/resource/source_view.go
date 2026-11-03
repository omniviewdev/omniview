package resource

import (
	"encoding/json"
	"strconv"
	"sync"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type queuedSourceViewEvent struct {
	event HostSourceViewEvent
	bytes int
}
type sourceView struct {
	session             *sourceSession
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
	snapshot            []HostRecord
	snapshotOffset      int
	snapshotSequence    uint64
	snapshotStatus      *HostSourceStatus
}

func newSourceView(s *sourceSession, id, owner, targetID string) *sourceView {
	return &sourceView{session: s, id: id, owner: owner, targetID: targetID, wake: make(chan struct{}, 1)}
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
func (v *sourceView) appendLocked(event HostSourceViewEvent) bool {
	b, _ := json.Marshal(event)
	if len(v.queue) >= sourceViewQueueItems || v.bytes+len(b) > sourceViewQueueBytes {
		return false
	}
	v.queue = append(v.queue, queuedSourceViewEvent{event: event, bytes: len(b)})
	v.bytes += len(b)
	v.signal()
	return true
}
func (v *sourceView) resetLocked(reason, message string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return
	}
	if v.generation == "" {
		v.generation = uuid.NewString()
	}
	event := v.nextLocked("reset")
	event.Reset = &HostSourceViewReset{Reason: reason, Message: message}
	v.queue = nil
	v.bytes = 0
	v.snapshot = nil
	v.snapshotStatus = nil
	v.control = &event
	v.synced = false
	v.signal()
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
	v.generation = uuid.NewString()
	v.sequence = 0
	v.synced = true
	v.queue = nil
	v.bytes = 0
	v.snapshot = make([]HostRecord, 0, len(v.session.members))
	for _, member := range v.session.members {
		record, err := envelopeRecord(v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target, v.session.fullSourceRecord(member.observation.Record))
		if err == nil {
			v.snapshot = append(v.snapshot, record)
		}
	}
	status := v.session.status
	v.snapshotStatus = &status
	v.snapshotOffset = 0
	v.snapshotSequence = 0
	v.sequence = uint64((len(v.snapshot)+sourceViewChunkRecords-1)/sourceViewChunkRecords + 1)
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
func (v *sourceView) changesLocked(records []resourcev2.Record, refs []resourcev2.ResourceReference) {
	v.mu.Lock()
	if v.closed || !v.synced {
		v.mu.Unlock()
		return
	}
	event := v.nextLocked("changes")
	for _, record := range records {
		r, err := envelopeRecord(v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target, record)
		if err == nil {
			event.Upserts = append(event.Upserts, r)
		}
	}
	for _, ref := range refs {
		key, address, err := rowIdentity(v.session.pluginGeneration.generationID, v.owner, v.targetID, v.session.target, ref)
		if err == nil {
			event.Removes = append(event.Removes, HostRecordRemoval{Key: key, AddressKey: address})
		}
	}
	if !v.appendLocked(event) {
		v.mu.Unlock()
		v.resetLocked("overflow", "Source view queue overflowed.")
		v.syncLocked("")
		return
	}
	v.mu.Unlock()
}
func (v *sourceView) close() {
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return
	}
	if v.generation == "" {
		v.generation = uuid.NewString()
	}
	event := v.nextLocked("reset")
	event.Reset = &HostSourceViewReset{Reason: "closed", Message: "Source view closed."}
	v.queue = nil
	v.bytes = 0
	v.snapshot = nil
	v.snapshotStatus = nil
	v.control = &event
	v.closed = true
	v.signal()
	v.mu.Unlock()
}
func (v *sourceView) emitLoop() {
	for {
		<-v.wake
		for {
			v.mu.Lock()
			var event HostSourceViewEvent
			if v.control != nil {
				event = *v.control
				v.control = nil
			} else if v.snapshotStatus != nil {
				v.snapshotSequence++
				event = HostSourceViewEvent{ViewID: v.id, ViewGeneration: v.generation, Sequence: strconv.FormatUint(v.snapshotSequence, 10)}
				if v.snapshotOffset < len(v.snapshot) {
					end := v.snapshotOffset + sourceViewChunkRecords
					if end > len(v.snapshot) {
						end = len(v.snapshot)
					}
					event.Kind = "snapshot"
					event.Records = v.snapshot[v.snapshotOffset:end]
					v.snapshotOffset = end
				} else {
					event.Kind = "snapshotEnd"
					event.Status = v.snapshotStatus
					v.snapshot = nil
					v.snapshotStatus = nil
				}
			} else if len(v.queue) > 0 {
				item := v.queue[0]
				v.queue[0] = queuedSourceViewEvent{}
				v.queue = v.queue[1:]
				v.bytes -= item.bytes
				event = item.event
			} else {
				closed := v.closed
				v.mu.Unlock()
				if closed {
					return
				}
				break
			}
			v.mu.Unlock()
			if emitter := v.session.coordinator.ctrl.emitter; emitter != nil {
				emitter.Emit("resource/source-view/"+v.id, event)
			}
		}
	}
}
