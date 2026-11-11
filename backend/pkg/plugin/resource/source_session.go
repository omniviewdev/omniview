package resource

import (
	"context"
	"errors"
	"io"
	"reflect"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/telemetry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
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
	memberLedger         sourceMemberLedger
	transientLedger      sourceTransientLedger
	// Source receipt, legacy production and all session views each have a
	// 256 MiB scratch pool (768 MiB combined per session), independent of
	// retained/staging budgets and SDK in-flight wire limits.
	legacyTransientLedger sourceTransientLedger
	viewTransientLedger   sourceTransientLedger
	staging               map[string]sourceMember
	stagingBytes          int
	status                HostSourceStatus
	generation            string
	generationCancel      context.CancelFunc
	stream                resourcev2.SourceStream
	done                  chan struct{}
	attempts              []time.Time
	autoReopening         bool
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
		if s.coordinator != nil && s.coordinator.ctrl != nil && s.coordinator.ctrl.logger != nil {
			logCtx := s.ctx
			if logCtx == nil {
				logCtx = context.Background()
			}
			s.coordinator.ctrl.logger.Warnw(
				logCtx,
				"source session failed",
				"pluginID",
				s.pluginID,
				"errorClass",
				telemetryutil.ErrorClass(err),
			)
		}
		// Provider error details can contain credentials or resource payloads.
		// Export only the bounded host classification and host-generated text.
		s.status.Error = &resourcev2.ResourceOperationError{
			Code: telemetryutil.ErrorClass(err), Message: "Source session failed.",
			Err: nil, Title: "", Suggestions: nil,
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
	binding := s.ctx.Value(sourceBindingKey{}).(sourceBinding)
	req := resourcev2.SourceOpenRequest{SessionID: uuid.NewString(), Generation: generation, Target: s.target, Mode: s.mode, Acquisition: resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate}, Limits: resourcev2.SourceLimits{MaxFrameBytes: defaultSourceMaxFrameBytes, MaxBatchItems: defaultSourceMaxBatchItems}, Binding: resourcev2.RepresentationBinding{Representation: binding.Representation}}
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
	binding := ctx.Value(sourceBindingKey{}).(sourceBinding)
	catalog, descriptor, err := s.sourceCatalog(operationCtx, request.Target, request.Mode)
	if err != nil {
		s.receiveAdmissionError(request.Generation, err)
		return
	}
	if catalog.Revision != binding.CatalogRevision || !reflect.DeepEqual(descriptor, binding.Descriptor) {
		s.invalidateBinding(request.Generation, expected, binding.Epoch)
		return
	}
	ctx = resourcev2.WithCatalogRevision(operationCtx, binding.CatalogRevision)
	ctx = context.WithValue(ctx, legacySourceTransientKey{}, &s.legacyTransientLedger)
	openCtx, endOpen := h3StartOperation(
		ctx,
		"resource.SourceOpen",
		attribute.String("plugin_id", s.pluginID),
		attribute.String("connection_id", request.Target.Route.Connection),
		attribute.String("resource_type", request.Target.Type),
	)
	stream, err := opener.OpenSourceStream(openCtx, request)
	endOpen(&err)
	if err != nil {
		if resourceplugin.IsFatalSourceTransportError(err) {
			go s.coordinator.ctrl.retireFatalSourceTransport(s.pluginID, expected, err)
			return
		}
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
	closeReason := "normal"
	defer func() {
		if s.coordinator.ctrl.logger != nil {
			s.coordinator.ctrl.logger.Debugw(
				ctx,
				"source stream closed",
				"pluginID",
				s.pluginID,
				"connectionID",
				request.Target.Route.Connection,
				"resourceType",
				request.Target.Type,
				"closeReason",
				closeReason,
			)
		}
	}()
	tracker := resourcev2.NewCatalogBoundSourcePhaseTracker(request, descriptor)
	defer tracker.Close()
	firstFrame := true
	for {
		frame, err := stream.Recv()
		if err != nil {
			switch {
			case ctx.Err() != nil:
				closeReason = resourceOutcomeCanceled
			case errors.Is(err, io.EOF):
				closeReason = "peer"
			default:
				closeReason = resourceOutcomeError
				telemetry.RecordPluginStreamEvent(ctx, s.pluginID, "source", "closed_error")
			}
			if resourceplugin.IsFatalSourceTransportError(err) {
				go s.coordinator.ctrl.retireFatalSourceTransport(s.pluginID, expected, err)
				return
			}
			s.receiveError(request.Generation, err)
			return
		}
		if firstFrame {
			firstFrame = false
			if s.coordinator.ctrl.logger != nil {
				s.coordinator.ctrl.logger.Debugw(
					ctx,
					"source stream received first frame",
					"pluginID",
					s.pluginID,
					"connectionID",
					request.Target.Route.Connection,
					"resourceType",
					request.Target.Type,
				)
			}
		}
		s.mu.Lock()
		if s.closed || s.generation != request.Generation {
			s.mu.Unlock()
			return
		}
		// Reserve frame and tracker scratch before constructing the wire tree.
		frameBytes, err := sourceFrameTransientEstimate(frame, maxSourceTransientBytes)
		if err != nil || !s.transientLedger.reserve(frameBytes) {
			telemetry.RecordPluginStreamEvent(ctx, s.pluginID, "source", "overflow")
			if s.coordinator.ctrl.logger != nil {
				s.coordinator.ctrl.logger.Warnw(
					ctx,
					"source frame exceeds transient budget",
					"pluginID",
					s.pluginID,
					"connectionID",
					request.Target.Route.Connection,
					"resourceType",
					request.Target.Type,
				)
			}
			s.statusLocked("failed", resourcev2.NewError("RESOURCE_LIMIT", "Source frame transient exceeds host limits."))
			s.mu.Unlock()
			return
		}
		// The legacy producer retains its page charge until this frame's
		// reservation takes over. Close cancels the handoff on every early exit.
		if legacy, ok := stream.(*legacySourceStream); ok {
			legacy.ackFrame()
		}
		terminal, rebind := func() (bool, bool) {
			defer s.transientLedger.release(frameBytes)
			if err := tracker.Admit(frame); err != nil {
				var operationErr *resourcev2.ResourceOperationError
				if errors.As(err, &operationErr) && operationErr.Code == "RESET_REQUIRED" && operationErr.Message == "source binding changed" {
					return true, true
				}
				s.statusLocked("failed", err)
				return true, false
			}
			if frame.Reset != nil && frame.Reset.Reason == resourcev2.SourceResetBindingChanged {
				return true, true
			}
			terminal, err := s.applyLocked(frame, sourceFrameContext{ctx: ctx, target: request.Target, descriptor: &descriptor, frameReserved: frameBytes})
			if err != nil {
				s.statusLocked("failed", err)
			}
			return terminal || err != nil, false
		}()
		s.mu.Unlock()
		if rebind {
			s.checkBindingMismatch(operationCtx, request, expected, binding)
			return
		}
		if terminal {
			return
		}
	}
}

// checkBindingMismatch confirms a provider-reported mismatch against the catalog
// before retiring connection-wide authority and source state.
func (s *sourceSession) checkBindingMismatch(ctx context.Context, request resourcev2.SourceOpenRequest, expected *pluginState, binding sourceBinding) {
	catalog, descriptor, err := s.sourceCatalog(ctx, request.Target, request.Mode)
	if err != nil {
		s.receiveAdmissionError(request.Generation, err)
		return
	}
	if catalog.Revision != binding.CatalogRevision || !reflect.DeepEqual(descriptor, binding.Descriptor) {
		s.invalidateBinding(request.Generation, expected, binding.Epoch)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed && s.generation == request.Generation && s.ctx.Err() == nil {
		s.statusLocked("failed", resourcev2.NewError("RESET_REQUIRED", "Source binding does not match the current catalog."))
	}
}

// invalidateBinding retires only the route epoch that observed the mismatch.
func (s *sourceSession) invalidateBinding(generation string, expected *pluginState, epoch sourceEpochSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.generation != generation || s.pluginGeneration != expected {
		return
	}
	c := s.coordinator.ctrl
	c.pluginsMu.Lock()
	if c.plugins[s.pluginID] != expected || expected.provider == nil || expected.sourceEpoch[epoch.Connection] != epoch.Epoch {
		c.pluginsMu.Unlock()
		return
	}
	now := s.coordinator.now()
	recent := s.attempts[:0]
	for _, attempt := range s.attempts {
		if now.Sub(attempt) < sourceReopenWindow {
			recent = append(recent, attempt)
		}
	}
	s.attempts = recent
	if len(s.attempts) >= len(sourceReopenBackoff) {
		c.pluginsMu.Unlock()
		s.statusLocked("failed", resourcev2.NewError("RESET_REQUIRED", "Source reconnect limit reached."))
		return
	}
	s.attempts = append(s.attempts, now)
	err := c.invalidateSourceRoutesLocked(s.pluginID, []string{epoch.Connection}, false)
	c.pluginsMu.Unlock()
	if err != nil {
		s.statusLocked("failed", err)
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
	ctx := s.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	telemetry.RecordPluginStreamEvent(ctx, s.pluginID, "source", "reset")
	if s.coordinator != nil && s.coordinator.ctrl != nil && s.coordinator.ctrl.logger != nil {
		s.coordinator.ctrl.logger.Warnw(
			ctx,
			"source continuity reset",
			"pluginID",
			s.pluginID,
			"connectionID",
			s.target.Route.Connection,
			"resourceType",
			s.target.Type,
		)
	}
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
			telemetry.RecordPluginStreamEvent(sessionCtx, s.pluginID, "source", "reconnect")
			if s.coordinator.ctrl.logger != nil {
				s.coordinator.ctrl.logger.Debugw(
					sessionCtx,
					"source reconnecting",
					"pluginID",
					s.pluginID,
					"attempt",
					len(s.attempts),
					"backoffMs",
					delay.Milliseconds(),
				)
			}
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
	for _, member := range s.members {
		member.release()
	}
	s.members = make(map[string]sourceMember)
	s.memberBytes = 0
	s.hasSnapshot = false
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
	for _, member := range s.members {
		member.release()
	}
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
	for _, member := range s.members {
		member.release()
	}
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
	ctx           context.Context
	target        resourcev2.ReadTarget
	descriptor    *resourcev2.ResourceType
	frameReserved int
}

func (s *sourceSession) fullSourceRecord(record resourcev2.SourceRecord) resourcev2.Record {
	binding := s.ctx.Value(sourceBindingKey{}).(sourceBinding).Representation
	return resourcev2.Record{Reference: record.Reference, Body: record.Body, Representation: binding, Coverage: record.Coverage, SourceRevision: record.SourceRevision}
}

func (s *sourceSession) observeFrameRecord(frame sourceFrameContext, observation resourcev2.SourceObservation) error {
	record := s.fullSourceRecord(observation.Record)
	if frame.descriptor == nil {
		return s.coordinator.ctrl.observeSourceRecord(s.ctx, s.pluginID, s.pluginGeneration, s.target.Route, record, observation.Metadata)
	}
	if err := resourcev2.ValidateSourceObservation(frame.target, frame.target.Representation, observation); err != nil {
		return err
	}
	ref, binding := observation.Record.Representation, record.Representation
	if ref.ID != binding.ID || ref.Revision != binding.Revision || (ref.SchemaRevision == nil) != (binding.Schema.Revision == nil) || ref.SchemaRevision != nil && *ref.SchemaRevision != *binding.Schema.Revision {
		return resourcev2.NewError("RESET_REQUIRED", "Source binding changed.")
	}
	if err := resourcev2.ValidateAddress(observation.Record.Reference.Address, frame.descriptor.IdentityDimensions); err != nil {
		return err
	}
	return s.coordinator.ctrl.observeValidatedSourceRecord(frame.ctx, s.pluginID, s.pluginGeneration, frame.target.Route, record, observation.Metadata)
}

// prevalidateFrameReference checks the same generation and authority fence used
// by registry publication before any member in a frame is published.
func (s *sourceSession) prevalidateFrameReference(frame sourceFrameContext, ref resourcev2.ResourceReference) error {
	c := s.coordinator.ctrl
	if frame.descriptor == nil {
		return c.validateReference(s.ctx, s.pluginID, s.target.Route, ref)
	}
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if err := c.currentGenerationLocked(frame.ctx, s.pluginID, s.pluginGeneration); err != nil {
		return err
	}
	if !c.referenceCurrentLocked(s.pluginID, frame.target.Route, ref) {
		return resourcev2.NewError("CANCELLED", "observation route authority retired")
	}
	return nil
}

func (s *sourceSession) prevalidateFrameRecord(frame sourceFrameContext, observation resourcev2.SourceObservation) error {
	if frame.descriptor != nil {
		if err := resourcev2.ValidateSourceObservation(frame.target, frame.target.Representation, observation); err != nil {
			return err
		}
		if err := resourcev2.ValidateAddress(observation.Record.Reference.Address, frame.descriptor.IdentityDimensions); err != nil {
			return err
		}
	}
	if err := resourcev2.ValidateRecord(s.fullSourceRecord(observation.Record)); err != nil {
		return err
	}
	return s.prevalidateFrameReference(frame, observation.Record.Reference)
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
		// Reserve every new member before constructing any key or wire tree.
		// Existing members remain charged until their replacements are installed.
		reserved := s.stagingBytes
		frameBytes, err := sourceFrameTransientEstimate(frame, maxSourceTransientBytes)
		if err != nil {
			return true, err
		}
		maxEncoding := 0
		for _, o := range frame.Snapshot.Observations {
			size, err := sourceMemberEstimate(o, defaultSourceStagingBytes)
			if err != nil || size > defaultSourceStagingBytes-reserved {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot exceeds host limits.")
			}
			transient, err := sourceMemberTransientEstimate(o, maxSourceTransientBytes)
			if err != nil || transient > maxSourceTransientBytes-frameBytes {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot transient exceeds host limits.")
			}
			if transient > maxEncoding {
				maxEncoding = transient
			}
			reserved += size
		}
		extra := frameBytes + maxEncoding - frameContext.frameReserved
		if extra < 0 || !s.transientLedger.reserve(extra) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot transient exceeds host limits.")
		}
		defer s.transientLedger.release(extra)
		for _, o := range frame.Snapshot.Observations {
			member, key, err := makeSourceMember(o, defaultSourceStagingBytes)
			if err != nil {
				return true, err
			}
			old, exists := s.staging[key]
			size := s.stagingBytes - old.size + member.size
			if len(s.staging)+boolInt(!exists) > maxSourceSessionMembers || size > defaultSourceStagingBytes {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot exceeds host limits.")
			}
			s.staging[key] = member
			s.stagingBytes = size
		}
	case frame.SnapshotEnd != nil:
		if len(s.staging) > maxSourceSessionMembers || s.stagingBytes > maxSourceSessionBytes {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source membership exceeds host limits.")
		}
		stageReservation := s.stagingBytes
		if !s.memberLedger.reserve(stageReservation) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source membership exceeds host limits.")
		}
		committed := false
		defer func() {
			if !committed {
				s.memberLedger.release(stageReservation)
			}
		}()
		// One decoded observation and its publication scratch are live at a
		// time. Reserve the largest before validating or publishing any row.
		maxDecode := 0
		for _, member := range s.staging {
			if member.transient > maxDecode {
				maxDecode = member.transient
			}
		}
		if frame.SnapshotEnd.Coverage.Enumeration == resourcev2.EnumerationExhausted {
			for key, member := range s.members {
				if _, ok := s.staging[key]; !ok && member.transient > maxDecode {
					maxDecode = member.transient
				}
			}
		}
		if len(s.staging) != 0 {
			binding := s.ctx.Value(sourceBindingKey{}).(sourceBinding).Representation
			schemaCost, err := sourceBindingTransientEstimate(binding)
			if err != nil || schemaCost > maxSourceTransientBytes-maxDecode {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot schema exceeds host limits.")
			}
			maxDecode += schemaCost
		}
		if !s.transientLedger.reserve(maxDecode) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source snapshot decode exceeds host limits.")
		}
		decodeReserved := true
		defer func() {
			if decodeReserved {
				s.transientLedger.release(maxDecode)
			}
		}()
		for _, member := range s.staging {
			observation, err := decodeSourceMember(member)
			if err != nil {
				return true, err
			}
			if err := s.prevalidateFrameRecord(frameContext, observation); err != nil {
				return true, err
			}
		}
		if frame.SnapshotEnd.Coverage.Enumeration == resourcev2.EnumerationExhausted {
			for key, member := range s.members {
				if _, ok := s.staging[key]; !ok {
					observation, err := decodeSourceMember(member)
					if err != nil {
						return true, err
					}
					if err := s.prevalidateFrameReference(frameContext, observation.Record.Reference); err != nil {
						return true, err
					}
				}
			}
		}
		for _, member := range s.staging {
			observation, err := decodeSourceMember(member)
			if err != nil {
				return true, err
			}
			if err := s.observeFrameRecord(frameContext, observation); err != nil {
				return true, err
			}
		}
		if frame.SnapshotEnd.Coverage.Enumeration == resourcev2.EnumerationExhausted {
			for key, member := range s.members {
				if _, ok := s.staging[key]; !ok {
					observation, err := decodeSourceMember(member)
					if err != nil {
						return true, err
					}
					s.deleteRecordContext(frameContext.ctx, observation.Record.Reference)
				}
			}
		}
		s.transientLedger.release(maxDecode)
		decodeReserved = false
		for key, member := range s.staging {
			member.attachReserved(&s.memberLedger)
			s.staging[key] = member
		}
		for _, member := range s.members {
			member.release()
		}
		committed = true
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
		// Reserve the full batch before any address key or packed member is
		// built. Old members remain live through prevalidation and publication.
		reserved := s.memberBytes
		transient, err := sourceFrameTransientEstimate(frame, maxSourceTransientBytes)
		if err != nil {
			return true, err
		}
		for _, change := range frame.Changes.Changes {
			if change.Observation == nil {
				continue
			}
			size, err := sourceMemberEstimate(*change.Observation, maxSourceSessionBytes)
			if err != nil || size > maxSourceSessionBytes-reserved {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source membership exceeds host limits.")
			}
			cost, err := sourceMemberTransientEstimate(*change.Observation, maxSourceTransientBytes)
			if err != nil || cost > maxSourceTransientBytes-transient {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
			}
			reserved += size
			transient += cost
		}
		extra := transient - frameContext.frameReserved
		if extra < 0 || !s.transientLedger.reserve(extra) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
		}
		defer s.transientLedger.release(extra)
		unassigned := reserved - s.memberBytes
		if !s.memberLedger.reserve(unassigned) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source membership exceeds host limits.")
		}
		defer func() { s.memberLedger.release(unassigned) }()
		nextCount := len(s.members)
		nextBytes := s.memberBytes
		touched := make(map[string]*sourceMember)
		for _, change := range frame.Changes.Changes {
			var key string
			var next *sourceMember
			if change.Observation != nil {
				member, k, err := makeSourceMember(*change.Observation, maxSourceSessionBytes)
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
			if change.Reference != nil && previous != nil && change.Reference.Incarnation != nil {
				if previous.transient > maxSourceTransientBytes-transient {
					return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
				}
				matches, err := func() (bool, error) {
					if !s.transientLedger.reserve(previous.transient) {
						return false, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
					}
					defer s.transientLedger.release(previous.transient)
					prior, err := decodeSourceMember(*previous)
					if err != nil {
						return false, err
					}
					return prior.Record.Reference.Incarnation == nil || sameIncarnation(change.Reference.Incarnation, prior.Record.Reference.Incarnation), nil
				}()
				if err != nil {
					return true, err
				}
				if !matches {
					continue
				}
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
		if nextCount > maxSourceSessionMembers || nextBytes > defaultSourceStagingBytes {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source membership exceeds host limits.")
		}
		// Old references and decoded upserts can coexist in view events.
		oldTransient := 0
		for key := range touched {
			if old, ok := s.members[key]; ok {
				if old.transient > maxSourceTransientBytes-transient-oldTransient {
					return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
				}
				oldTransient += old.transient
			}
		}
		if !s.transientLedger.reserve(oldTransient) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
		}
		defer s.transientLedger.release(oldTransient)
		transient += oldTransient
		// Decode every touched member before publishing any part of the batch.
		// A malformed packed member must not cause partial membership changes.
		if len(touched) > (maxSourceTransientBytes-transient)/512 {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
		}
		preparedBytes := len(touched) * 512
		if !s.transientLedger.reserve(preparedBytes) {
			return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes transient exceeds host limits.")
		}
		defer s.transientLedger.release(preparedBytes)
		transient += preparedBytes
		for _, next := range touched {
			if next == nil {
				continue
			}
			binding := s.ctx.Value(sourceBindingKey{}).(sourceBinding).Representation
			schemaCost, err := sourceBindingTransientEstimate(binding)
			if err != nil || schemaCost > maxSourceTransientBytes-transient || !s.transientLedger.reserve(schemaCost) {
				return true, resourcev2.NewError("RESOURCE_LIMIT", "Source changes schema exceeds host limits.")
			}
			defer s.transientLedger.release(schemaCost)
			break
		}
		type preparedChange struct {
			key             string
			next            *sourceMember
			old             sourceMember
			existed         bool
			oldObservation  resourcev2.SourceObservation
			nextObservation resourcev2.SourceObservation
		}
		prepared := make([]preparedChange, 0, len(touched))
		for key, next := range touched {
			old, existed := s.members[key]
			change := preparedChange{key: key, next: next, old: old, existed: existed}
			if existed {
				var err error
				change.oldObservation, err = decodeSourceMember(old)
				if err != nil {
					return true, err
				}
			}
			if next != nil {
				var err error
				change.nextObservation, err = decodeSourceMember(*next)
				if err != nil {
					return true, err
				}
			}
			prepared = append(prepared, change)
		}
		for _, change := range prepared {
			if change.existed {
				if err := s.prevalidateFrameReference(frameContext, change.oldObservation.Record.Reference); err != nil {
					return true, err
				}
			}
			if change.next != nil {
				if err := s.prevalidateFrameRecord(frameContext, change.nextObservation); err != nil {
					return true, err
				}
			}
		}
		var upserts []resourcev2.Record
		var removes []resourcev2.ResourceReference
		for _, change := range prepared {
			key, next, old, existed := change.key, change.next, change.old, change.existed
			oldObservation, nextObservation := change.oldObservation, change.nextObservation
			if existed && (next == nil || !sameIncarnation(oldObservation.Record.Reference.Incarnation, nextObservation.Record.Reference.Incarnation)) {
				removes = append(removes, oldObservation.Record.Reference)
			}
			if next == nil {
				if existed {
					s.deleteRecordContext(frameContext.ctx, oldObservation.Record.Reference)
					old.release()
					s.memberBytes -= old.size
					delete(s.members, key)
				}
			} else {
				if err := s.observeFrameRecord(frameContext, nextObservation); err != nil {
					return true, err
				}
				next.attachReserved(&s.memberLedger)
				unassigned -= next.size
				if existed {
					old.release()
					s.memberBytes -= old.size
				}
				s.members[key] = *next
				s.memberBytes += next.size
				upserts = append(upserts, s.fullSourceRecord(nextObservation.Record))
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
		s.resetLocked("Source continuity lost.")
		return true, nil
	case frame.Failed != nil:
		if s.autoReopening && sourceTransientError(frame.Failed.Code) {
			s.resetLocked("Source continuity lost.")
		} else {
			s.statusLocked("failed", resourcev2.NewError(frame.Failed.Code, "Source session failed."))
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
