package window

import (
	"context"
	"errors"
	"fmt"
)

// BeginDrag starts a cross-window drag owned by the source window, refreshes
// every window's native bounds and asks every window to report a fresh
// viewport.
func (s *Service) BeginDrag(b DragBegin) error {
	if b.SessionID == "" {
		return fmt.Errorf("%w: empty session id", ErrInvalidDrag)
	}
	s.refreshBounds()
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.registry.get(b.SourceWindow); !ok {
		return fmt.Errorf("%w %q", ErrUnknownWindow, b.SourceWindow)
	}
	if entry, _ := s.registry.get(b.SourceWindow); entry.kind == KindSettings {
		return fmt.Errorf("%w: settings cannot transfer tabs", ErrInvalidDrag)
	}
	if _, active := s.drags[b.SessionID]; active {
		return fmt.Errorf("%w: session %q is already active", ErrInvalidDrag, b.SessionID)
	}
	s.drags[b.SessionID] = &dragSession{
		begin:         b,
		hoverTarget:   "",
		dropTarget:    "",
		dropResponses: make(chan dropResponse, 1),
	}
	s.emitter.emit(EventDragBegin, DragBeginEvent{
		SessionID:    b.SessionID,
		SourceWindow: b.SourceWindow,
		DragType:     b.DragType,
	})
	return nil
}

// MoveDrag routes the pointer, given in the source window's client space, to
// the window under it: the previous target gets a leave event, the current
// target a hover event. Moves for unknown or ending sessions are ignored;
// they race with EndDrag/CancelDrag by design.
func (s *Service) MoveDrag(sessionID string, clientX, clientY float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.drags[sessionID]
	if !ok || session.dropTarget != "" {
		return
	}
	target := s.resolveDragTargetLocked(session, clientX, clientY)
	s.leaveHoverTargetLocked(session, target.name)
	session.hoverTarget = target.name
	if target.name == "" {
		return
	}
	s.emitter.emit(EventDragHover, DragPointerEvent{
		SessionID:    sessionID,
		TargetWindow: target.name,
		Payload:      session.begin.Payload,
		ClientX:      target.clientX,
		ClientY:      target.clientY,
	})
}

// dragTarget is the window under the pointer and the pointer in that
// window's client space.
type dragTarget struct {
	name    string
	clientX float64
	clientY float64
}

// resolveDragTargetLocked maps a point in the source window's client space to
// the window under it. The result has no name when the source's geometry is
// unknown, the point is over the source, or no window is there.
func (s *Service) resolveDragTargetLocked(session *dragSession, clientX, clientY float64) dragTarget {
	none := dragTarget{name: "", clientX: 0, clientY: 0}
	source := session.begin.SourceWindow
	globalX, globalY, err := s.clientToGlobalLocked(source, clientX, clientY)
	if err != nil {
		s.log.Debugw(context.Background(), "drag pointer not mapped", "session", session.begin.SessionID, "error", err)
		return none
	}
	name := s.registry.dropTargetAt(source, globalX, globalY)
	if name == "" {
		return none
	}
	content, _ := s.registry.entries[name].contentRect()
	return dragTarget{name: name, clientX: globalX - content.X, clientY: globalY - content.Y}
}

// EndDrag drops the tab on the window under the pointer (given in the source
// window's client space) and waits for that window's RespondDrop. It returns
// a not-accepted result when no other window is under the pointer, the
// target declines, closes, or does not answer in time. The session always
// ends with windows/drag/end.
func (s *Service) EndDrag(ctx context.Context, sessionID string, clientX, clientY float64) (DropResult, error) {
	notAccepted := DropResult{Accepted: false, TargetWindow: "", TargetInstanceID: ""}

	s.mu.Lock()
	session, ok := s.drags[sessionID]
	if !ok {
		s.mu.Unlock()
		return notAccepted, fmt.Errorf("%w %q", ErrUnknownDragSession, sessionID)
	}
	if session.dropTarget != "" {
		s.mu.Unlock()
		return notAccepted, fmt.Errorf("%w: session %q is already ending", ErrInvalidDrag, sessionID)
	}
	target := s.resolveDragTargetLocked(session, clientX, clientY)
	s.leaveHoverTargetLocked(session, target.name)
	session.hoverTarget = ""
	if target.name == "" {
		s.finishDragLocked(session)
		s.mu.Unlock()
		return notAccepted, nil
	}
	session.dropTarget = target.name
	s.emitter.emit(EventDragDrop, DragPointerEvent{
		SessionID:    sessionID,
		TargetWindow: target.name,
		Payload:      session.begin.Payload,
		ClientX:      target.clientX,
		ClientY:      target.clientY,
	})
	s.mu.Unlock()

	response, waitErr := s.awaitDropResponse(ctx, session)

	s.mu.Lock()
	s.finishDragLocked(session)
	s.mu.Unlock()

	switch {
	case waitErr != nil:
		return notAccepted, waitErr
	case !response.accepted:
		return notAccepted, nil
	default:
		return DropResult{Accepted: true, TargetWindow: target.name, TargetInstanceID: response.targetInstanceID}, nil
	}
}

// awaitDropResponse waits for the target's answer. A timeout is a decline,
// not an error; cancellation of the caller's context is an error.
func (s *Service) awaitDropResponse(ctx context.Context, session *dragSession) (dropResponse, error) {
	waitCtx, cancel := context.WithTimeout(ctx, s.dropTimeout)
	defer cancel()
	select {
	case response := <-session.dropResponses:
		return response, nil
	case <-waitCtx.Done():
		if ctx.Err() != nil {
			return dropResponse{accepted: false, targetInstanceID: ""},
				fmt.Errorf("await drop response for session %q: %w", session.begin.SessionID, ctx.Err())
		}
		if errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
			s.log.Warnw(ctx, "drop target did not respond in time",
				"session", session.begin.SessionID, "target", session.dropTarget, "timeout", s.dropTimeout)
		}
		return dropResponse{accepted: false, targetInstanceID: ""}, nil
	}
}

// CancelDrag ends a session without a drop. Unknown sessions are ignored.
func (s *Service) CancelDrag(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.drags[sessionID]
	if !ok {
		return
	}
	s.leaveHoverTargetLocked(session, "")
	session.hoverTarget = ""
	if session.dropTarget != "" {
		offerDropResponse(session, dropResponse{accepted: false, targetInstanceID: ""})
	}
	s.finishDragLocked(session)
}

// RespondDrop delivers the drop target's answer to the waiting EndDrag.
// Answers for unknown sessions, sessions not waiting on a drop, and duplicate
// answers are ignored.
func (s *Service) RespondDrop(sessionID string, accepted bool, targetInstanceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.drags[sessionID]
	if !ok || session.dropTarget == "" {
		return
	}
	if accepted && targetInstanceID == "" {
		s.log.Warnw(context.Background(), "drop accepted without a target instance; treating it as declined",
			"session", sessionID, "target", session.dropTarget)
		accepted = false
	}
	offerDropResponse(session, dropResponse{accepted: accepted, targetInstanceID: targetInstanceID})
}

// settleDragsForClosedWindowLocked clears a closed window as a hover target,
// declines drops waiting on it (or owned by it) and ends drags it owned.
func (s *Service) settleDragsForClosedWindowLocked(name string) {
	for _, session := range s.drags {
		if session.hoverTarget == name {
			session.hoverTarget = ""
		}
		if session.dropTarget != "" {
			// EndDrag is waiting and finishes the session itself.
			if session.dropTarget == name || session.begin.SourceWindow == name {
				offerDropResponse(session, dropResponse{accepted: false, targetInstanceID: ""})
			}
			continue
		}
		if session.begin.SourceWindow == name {
			s.leaveHoverTargetLocked(session, "")
			session.hoverTarget = ""
			s.finishDragLocked(session)
		}
	}
}

// leaveHoverTargetLocked emits leave to the current hover target when the
// pointer moved to a different target.
func (s *Service) leaveHoverTargetLocked(session *dragSession, nextTarget string) {
	if session.hoverTarget == "" || session.hoverTarget == nextTarget {
		return
	}
	s.emitter.emit(EventDragLeave, DragLeaveEvent{
		SessionID:    session.begin.SessionID,
		TargetWindow: session.hoverTarget,
	})
}

// finishDragLocked removes the session and tells every window it ended. It
// is a no-op when the session already ended.
func (s *Service) finishDragLocked(session *dragSession) {
	if s.drags[session.begin.SessionID] != session {
		return
	}
	delete(s.drags, session.begin.SessionID)
	s.emitter.emit(EventDragEnd, DragEndEvent{SessionID: session.begin.SessionID})
}

// offerDropResponse delivers the first answer; later answers are dropped.
func offerDropResponse(session *dragSession, response dropResponse) {
	select {
	case session.dropResponses <- response:
	default:
	}
}
