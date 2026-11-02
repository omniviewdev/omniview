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
	autoReopening        bool
}

func (s *sourceSession) updateCount() {
	count := strconv.Itoa(len(s.members))
	s.status.Count = resourcev2.Count{Kind: "exact", Value: &count}
}
func (s *sourceSession) emitStateLocked() {
	s.updateCount()
	s.coordinator.emitSourceState(s)
}
func (s *sourceSession) statusLocked(state string, err error) {
	s.status.State = state
	if state == "failed" {
		s.staging = nil
		s.stagingBytes = 0
	}
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
	if s.generationCancel != nil {
		s.generationCancel()
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
	go s.receive(ctx, req, done, s.opener, s.pluginGeneration)
}

type sourceAdmissionFailure struct{ error }

func (e *sourceAdmissionFailure) Unwrap() error { return e.error }

func (s *sourceSession) sourceCatalog(ctx context.Context, target resourcev2.ReadTarget, mode string) (resourcev2.Catalog, resourcev2.ResourceType, error) {
	c := s.coordinator.ctrl
	admission, catalog, err := c.routeCatalog(ctx, s.pluginID, target.Route)
	if err != nil {
		return resourcev2.Catalog{}, resourcev2.ResourceType{}, err
	}
	authority, err := c.resolveAuthority(ctx, s.pluginID, target.Route, catalog, admission, target.Type)
	if err != nil {
		if resourcev2.ErrorCode(err) == "NOT_FOUND" {
			return resourcev2.Catalog{}, resourcev2.ResourceType{}, &sourceAdmissionFailure{resourcev2.NewError("RESET_REQUIRED", "Source type is no longer available.")}
		}
		return resourcev2.Catalog{}, resourcev2.ResourceType{}, err
	}
	if catalog.Provider != target.Provider || authority.Authority != target.Authority {
		return resourcev2.Catalog{}, resourcev2.ResourceType{}, &sourceAdmissionFailure{resourcev2.NewError("RESET_REQUIRED", "Source authority changed.")}
	}
	var operation any = resourcev2.EnumerateRequest{Target: target}
	if mode == resourcev2.SourceModeSnapshotAndUpdates {
		operation = target
	}
	descriptor, err := resourcev2.AdmitCatalogOperation(catalog, operation)
	if err != nil {
		return resourcev2.Catalog{}, resourcev2.ResourceType{}, &sourceAdmissionFailure{resourcev2.NewError("RESET_REQUIRED", "Source capability is no longer available.")}
	}
	return catalog, descriptor, nil
}

func (s *sourceSession) receive(ctx context.Context, request resourcev2.SourceOpenRequest, done chan struct{}, opener resourcev2.SourceStreamOpener, expected *pluginState) {
	defer close(done)
	epoch, ok := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
	if !ok || s.coordinator.ctrl.currentGeneration(ctx, s.pluginID, expected) != nil {
		return
	}
	admission := catalogAdmission{generation: expected, epoch: epoch}
	_, _, operationCtx, cleanup, err := s.coordinator.ctrl.operationGenerationExpected(ctx, s.pluginID, request.Target.Route, &admission)
	if err != nil {
		if s.coordinator.ctrl.currentGeneration(ctx, s.pluginID, expected) == nil {
			s.receiveError(request.Generation, err)
		}
		return
	}
	defer cleanup()
	catalog, _, err := s.sourceCatalog(operationCtx, request.Target, request.Mode)
	if err != nil {
		s.receiveAdmissionError(request.Generation, err)
		return
	}
	ctx = resourcev2.WithCatalogRevision(operationCtx, catalog.Revision)
	stream, err := opener.OpenSourceStream(ctx, request)
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
		var descriptor *resourcev2.ResourceType
		if frame.SnapshotEnd != nil || frame.Changes != nil {
			_, current, catalogErr := s.sourceCatalog(ctx, request.Target, request.Mode)
			if catalogErr != nil {
				s.receiveAdmissionError(request.Generation, catalogErr)
				return
			}
			descriptor = &current
		}
		s.mu.Lock()
		if s.closed || s.generation != request.Generation {
			s.mu.Unlock()
			return
		}
		terminal, err := s.applyLocked(frame, sourceFrameContext{ctx: ctx, target: request.Target, descriptor: descriptor})
		if err != nil {
			s.statusLocked("failed", err)
		}
		s.mu.Unlock()
		if err != nil || terminal {
			return
		}
	}
}
func (s *sourceSession) receiveAdmissionError(generation string, err error) {
	var failure *sourceAdmissionFailure
	if !errors.As(err, &failure) {
		s.receiveError(generation, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed && s.generation == generation && s.ctx.Err() == nil {
		s.statusLocked("failed", err)
	}
}

func (s *sourceSession) receiveError(generation string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.generation != generation {
		return
	}
	if s.ctx.Err() != nil {
		return
	}
	if errors.Is(err, io.EOF) && s.status.State == "finished" {
		return
	}
	if resourcev2.ErrorCode(err) == "RESET_REQUIRED" || errors.Is(err, io.EOF) || (s.autoReopening && sourceTransientError(resourcev2.ErrorCode(err))) {
		s.resetLocked("Source continuity lost.")
		return
	}
	s.statusLocked("failed", err)
}

func sourceTransientError(code string) bool {
	return code == "UNAVAILABLE" || code == "CONNECTION_ERROR" || code == "TIMEOUT"
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
	sessionCtx := s.ctx
	go func() {
		select {
		case <-s.coordinator.after(delay):
		case <-sessionCtx.Done():
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if !s.closed && s.generation == generation {
			s.autoReopening = true
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
	s.autoReopening = false
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

// Caller holds both coordinator and session locks.
func (s *sourceSession) rebindLocked(target resourcev2.ReadTarget, opener resourcev2.SourceStreamOpener, generation *pluginState, ctx context.Context, cancel context.CancelFunc, mode string) {
	s.cancel()
	if s.generationCancel != nil {
		s.generationCancel()
	}
	if s.stream != nil {
		s.stream.Close()
		s.stream = nil
	}
	s.target = target
	s.opener = opener
	s.pluginGeneration = generation
	s.ctx = ctx
	s.cancel = cancel
	s.mode = mode
	s.status.Mode = mode
	s.members = make(map[string]sourceMember)
	s.memberBytes = 0
	s.hasSnapshot = false
	s.attempts = nil
	s.autoReopening = false
	for _, v := range s.views {
		v.resetLocked("sourceReset", "Source binding changed.")
	}
	s.startLocked()
}

// Caller holds both coordinator and session locks.
func (s *sourceSession) rebindFailedLocked(err error) {
	if s.generationCancel != nil {
		s.generationCancel()
	}
	if s.stream != nil {
		s.stream.Close()
		s.stream = nil
	}
	s.generation = uuid.NewString()
	s.members = make(map[string]sourceMember)
	s.memberBytes = 0
	s.hasSnapshot = false
	for _, v := range s.views {
		v.resetLocked("sourceReset", "Source binding changed.")
	}
	s.statusLocked("failed", err)
}

func (s *sourceSession) close() {
	done := s.closeWithoutJoin()
	if done != nil {
		select {
		case <-done:
		case <-s.coordinator.after(sourceCloseJoinTimeout):
		}
	}
}

func (s *sourceSession) closeWithoutJoin() <-chan struct{} {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
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
	return done
}
func sameIncarnation(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

type sourceFrameContext struct {
	ctx        context.Context
	target     resourcev2.ReadTarget
	descriptor *resourcev2.ResourceType
}

func (s *sourceSession) observeFrameRecord(frame sourceFrameContext, observation resourcev2.SourceObservation) error {
	if frame.descriptor == nil {
		return s.coordinator.ctrl.observeSourceRecord(s.ctx, s.pluginID, s.pluginGeneration, s.target.Route, observation.Record, observation.Metadata)
	}
	if err := resourcev2.ValidateSourceObservation(frame.target, frame.target.Representation, observation); err != nil {
		return err
	}
	if err := resourcev2.ValidateAddress(observation.Record.Reference.Address, frame.descriptor.IdentityDimensions); err != nil {
		return err
	}
	return s.coordinator.ctrl.observeValidatedSourceRecord(frame.ctx, s.pluginID, s.pluginGeneration, frame.target.Route, observation.Record, observation.Metadata)
}

func (s *sourceSession) applyLocked(frame resourcev2.SourceFrame, frames ...sourceFrameContext) (bool, error) {
	var frameContext sourceFrameContext
	if len(frames) != 0 {
		frameContext = frames[0]
	}
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
			if err := s.observeFrameRecord(frameContext, member.observation); err != nil {
				return true, err
			}
		}
		if frame.SnapshotEnd.Coverage.Enumeration == resourcev2.EnumerationExhausted {
			for key, member := range s.members {
				if _, ok := s.staging[key]; !ok {
					s.deleteRecordContext(frameContext.ctx, member.observation.Record.Reference)
				}
			}
		}
		s.members = s.staging
		s.memberBytes = s.stagingBytes
		s.staging = nil
		s.stagingBytes = 0
		s.hasSnapshot = true
		s.autoReopening = false
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
			if change.Reference != nil && previous != nil && change.Reference.Incarnation != nil && previous.observation.Record.Reference.Incarnation != nil && !sameIncarnation(change.Reference.Incarnation, previous.observation.Record.Reference.Incarnation) {
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
					s.deleteRecordContext(frameContext.ctx, old.observation.Record.Reference)
					delete(s.members, key)
				}
			} else {
				if err := s.observeFrameRecord(frameContext, next.observation); err != nil {
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
		if s.autoReopening && sourceTransientError(frame.Failed.Code) {
			s.resetLocked(frame.Failed.Message)
		} else {
			s.statusLocked("failed", resourcev2.NewError(frame.Failed.Code, frame.Failed.Message))
		}
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
