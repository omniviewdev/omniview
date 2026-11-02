package resource

import (
	"context"
	"errors"
	"io"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type sourceSession struct {
	coordinator          *sourceCoordinator
	key, pluginID, owner string
	target               resourcev2.ReadTarget
	mode                 string
	opener               resourcev2.SourceStreamOpener
	pluginGeneration     *pluginState
	ctx                  context.Context
	cancel               context.CancelFunc
	mu                   sync.Mutex
	closed               bool
	inventory            bool
	reservations         int
	views                map[string]*sourceView
	members              map[string]sourceMember
	hasSnapshot          bool
	memberBytes          int
	staging              map[string]sourceMember
	stagingBytes         int
	status               HostSourceStatus
	generation           string
	generationCancel     context.CancelFunc
	stream               resourcev2.SourceStream
	done                 chan struct{}
	attempts             []time.Time
}

func (s *sourceSession) updateCount() {
	count := strconv.Itoa(len(s.members))
	s.status.Count = resourcev2.Count{Kind: "exact", Value: &count}
}
func (s *sourceSession) emitStateLocked() {
	s.updateCount()
	event := HostSourceStateEvent{PluginID: s.pluginID, Route: s.target.Route, Type: s.target.Type, Status: s.status}
	emitter := s.coordinator.ctrl.emitter
	if emitter != nil {
		emitter.Emit(s.pluginID+"/"+s.target.Route.Connection+"/source/STATE", event)
		emitter.Emit(EventSourceState, event)
	}
}
func (s *sourceSession) statusLocked(state string, err error) {
	s.status.State = state
	s.status.Error = nil
	if err != nil {
		var e *resourcev2.ResourceOperationError
		if errors.As(err, &e) {
			copy := *e
			s.status.Error = &copy
		} else {
			s.status.Error = &resourcev2.ResourceOperationError{Code: resourcev2.ErrorCode(err), Message: "Source session failed."}
		}
	}
	s.emitStateLocked()
	for _, v := range s.views {
		v.statusLocked()
	}
}
func (s *sourceSession) run() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.startLocked()
	s.mu.Unlock()
}
func (s *sourceSession) startLocked() {
	if s.closed {
		return
	}
	generation := uuid.NewString()
	s.generation = generation
	s.staging = make(map[string]sourceMember)
	s.stagingBytes = 0
	ctx, cancel := context.WithCancel(s.ctx)
	s.generationCancel = cancel
	done := make(chan struct{})
	s.done = done
	s.status.Continuity = ""
	s.status.Coverage = nil
	s.statusLocked("opening", nil)
	req := resourcev2.SourceOpenRequest{SessionID: uuid.NewString(), Generation: generation, Target: s.target, Mode: s.mode, Acquisition: resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate}, Limits: resourcev2.SourceLimits{MaxFrameBytes: defaultSourceMaxFrameBytes, MaxBatchItems: defaultSourceMaxBatchItems}}
	go s.receive(ctx, req, done)
}
func (s *sourceSession) receive(ctx context.Context, request resourcev2.SourceOpenRequest, done chan struct{}) {
	defer close(done)
	stream, err := s.opener.OpenSourceStream(ctx, request)
	if err != nil {
		s.receiveError(request.Generation, err)
		return
	}
	s.mu.Lock()
	if s.closed || s.generation != request.Generation {
		s.mu.Unlock()
		stream.Close()
		return
	}
	s.stream = stream
	s.mu.Unlock()
	defer stream.Close()
	for {
		frame, err := stream.Recv()
		if err != nil {
			s.receiveError(request.Generation, err)
			return
		}
		s.mu.Lock()
		if s.closed || s.generation != request.Generation {
			s.mu.Unlock()
			return
		}
		terminal, err := s.applyLocked(frame)
		if err != nil {
			s.statusLocked("failed", err)
		}
		s.mu.Unlock()
		if err != nil || terminal {
			return
		}
	}
}
func (s *sourceSession) receiveError(generation string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.generation != generation {
		return
	}
	if errors.Is(err, io.EOF) && s.status.State == "finished" {
		return
	}
	if resourcev2.ErrorCode(err) == "RESET_REQUIRED" || errors.Is(err, io.EOF) {
		s.resetLocked("Source continuity lost.")
		return
	}
	if errors.Is(err, context.Canceled) && s.ctx.Err() != nil {
		return
	}
	s.statusLocked("failed", err)
}
func (s *sourceSession) resetLocked(message string) {
	s.staging = nil
	s.stagingBytes = 0
	s.statusLocked("resetRequired", nil)
	for _, v := range s.views {
		v.resetLocked("sourceReset", message)
		v.syncLocked("")
	}
	now := s.coordinator.now()
	recent := s.attempts[:0]
	for _, t := range s.attempts {
		if now.Sub(t) < sourceReopenWindow {
			recent = append(recent, t)
		}
	}
	s.attempts = recent
	if len(s.attempts) >= len(sourceReopenBackoff) {
		s.statusLocked("failed", resourcev2.NewError("RESET_REQUIRED", "Source reconnect limit reached."))
		return
	}
	delay := sourceReopenBackoff[len(s.attempts)]
	s.attempts = append(s.attempts, now)
	generation := s.generation
	go func() {
		select {
		case <-s.coordinator.after(delay):
		case <-s.ctx.Done():
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if !s.closed && s.generation == generation {
			s.startLocked()
		}
	}()
}
func (s *sourceSession) refresh() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.attempts = nil
	if s.generationCancel != nil {
		s.generationCancel()
	}
	if s.stream != nil {
		s.stream.Close()
		s.stream = nil
	}
	for _, v := range s.views {
		v.resetLocked("sourceReset", "Source refreshed.")
		v.syncLocked("")
	}
	s.startLocked()
}
func (s *sourceSession) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.cancel()
	if s.generationCancel != nil {
		s.generationCancel()
	}
	stream := s.stream
	done := s.done
	s.members = nil
	s.staging = nil
	s.memberBytes = 0
	s.stagingBytes = 0
	s.status.State = "closed"
	s.emitStateLocked()
	for _, v := range s.views {
		v.close()
	}
	s.views = nil
	s.mu.Unlock()
	if stream != nil {
		stream.Close()
	}
	if done != nil {
		select {
		case <-done:
		case <-time.After(sourceCloseJoinTimeout):
		}
	}
}
func sameIncarnation(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func (s *sourceSession) applyLocked(frame resourcev2.SourceFrame) (bool, error) {
	switch {
	case frame.Begin != nil:
		s.statusLocked("snapshotting", nil)
	case frame.Snapshot != nil:
		for _, o := range frame.Snapshot.Observations {
			member, key, err := makeSourceMember(o)
			if err != nil {
				return true, err
			}
			old := s.staging[key]
			size := s.stagingBytes - old.size + member.size
			if len(s.staging)+boolInt(old.size == 0) > maxSourceSessionMembers || size > maxSourceSessionBytes {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot exceeds host limits.")
			}
			s.staging[key] = member
			s.stagingBytes = size
		}
	case frame.SnapshotEnd != nil:
		for _, member := range s.staging {
			if err := s.coordinator.ctrl.observeSourceRecord(s.ctx, s.pluginID, s.pluginGeneration, s.target.Route, member.observation.Record, member.observation.Metadata); err != nil {
				return true, err
			}
		}
		if frame.SnapshotEnd.Coverage.Enumeration == resourcev2.EnumerationExhausted {
			for key, member := range s.members {
				if _, ok := s.staging[key]; !ok {
					s.deleteRecord(member.observation.Record.Reference)
				}
			}
		}
		s.members = s.staging
		s.memberBytes = s.stagingBytes
		s.staging = nil
		s.stagingBytes = 0
		s.hasSnapshot = true
		coverage := frame.SnapshotEnd.Coverage
		s.status.Coverage = &coverage
		s.status.Continuity = frame.SnapshotEnd.Continuity
		if s.mode == resourcev2.SourceModeSnapshot {
			s.statusLocked("finished", nil)
		} else {
			s.statusLocked("following", nil)
		}
		for _, v := range s.views {
			v.syncLocked("resync")
		}
		return s.mode == resourcev2.SourceModeSnapshot, nil
	case frame.Changes != nil:
		nextCount := len(s.members)
		nextBytes := s.memberBytes
		touched := make(map[string]*sourceMember, len(frame.Changes.Changes))
		for _, change := range frame.Changes.Changes {
			var key string
			var next *sourceMember
			if change.Observation != nil {
				member, k, err := makeSourceMember(*change.Observation)
				if err != nil {
					return true, err
				}
				key = k
				next = &member
			} else if change.Reference != nil {
				k, err := sourceReferenceKey(*change.Reference)
				if err != nil {
					return true, err
				}
				key = k
			} else {
				continue
			}
			previous, seen := touched[key]
			if !seen {
				if member, ok := s.members[key]; ok {
					copy := member
					previous = &copy
				}
			}
			if change.Reference != nil && previous != nil && !sameIncarnation(change.Reference.Incarnation, previous.observation.Record.Reference.Incarnation) {
				continue
			}
			if previous != nil {
				nextCount--
				nextBytes -= previous.size
			}
			if next != nil {
				nextCount++
				nextBytes += next.size
			}
			touched[key] = next
		}
		if nextCount > maxSourceSessionMembers || nextBytes > maxSourceSessionBytes {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source membership exceeds host limits.")
		}
		var upserts []resourcev2.Record
		var removes []resourcev2.ResourceReference
		for key, next := range touched {
			old, existed := s.members[key]
			if existed && (next == nil || !sameIncarnation(old.observation.Record.Reference.Incarnation, next.observation.Record.Reference.Incarnation)) {
				removes = append(removes, old.observation.Record.Reference)
			}
			if next == nil {
				if existed {
					s.deleteRecord(old.observation.Record.Reference)
					delete(s.members, key)
				}
			} else {
				if err := s.coordinator.ctrl.observeSourceRecord(s.ctx, s.pluginID, s.pluginGeneration, s.target.Route, next.observation.Record, next.observation.Metadata); err != nil {
					return true, err
				}
				s.members[key] = *next
				upserts = append(upserts, next.observation.Record)
			}
		}
		s.memberBytes = nextBytes
		if frame.Changes.Coverage != nil {
			coverage := *frame.Changes.Coverage
			s.status.Coverage = &coverage
		}
		s.emitStateLocked()
		for _, v := range s.views {
			v.changesLocked(upserts, removes)
		}
	case frame.Reset != nil:
		s.resetLocked(frame.Reset.Message)
		return true, nil
	case frame.Failed != nil:
		s.statusLocked("failed", resourcev2.NewError(frame.Failed.Code, frame.Failed.Message))
		return true, nil
	}
	return false, nil
}
func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
