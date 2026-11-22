package exec

import (
	"context"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
)

// A local terminal's events go to every window, under the names the exec lane uses for any session:
// the shell's output as bytes on core/exec/stream/stdout/<id>, and how it ended as one terminal.End
// on core/exec/signal/CLOSE/<id>, after the last output.
const (
	localOutputEvent = "core/exec/stream/stdout/"
	localCloseEvent  = "core/exec/signal/CLOSE/"
)

// localSink delivers a local terminal's events. The manager calls it from one goroutine for each
// session, in order, so a session's events keep their order without a lock of the controller's.
type localSink struct{ c *controller }

func (s localSink) Output(sessionID string, data []byte) {
	s.c.emitLocal(localOutputEvent+sessionID, data)
}

func (s localSink) Closed(sessionID string, end terminal.End) {
	s.c.logger.Debugw(context.Background(), "closing session", "sessionID", sessionID, "reason", end.Reason)
	// The session doesn't exist anymore: remove it from the index.
	s.c.mu.Lock()
	delete(s.c.sessionIndex, sessionID)
	s.c.mu.Unlock()
	s.c.emitLocal(localCloseEvent+sessionID, end)
}

func (c *controller) emitLocal(name string, data any) {
	if c.events == nil {
		c.logger.Errorw(context.Background(), "event emitter is nil, cannot dispatch output")
		return
	}
	c.events.Emit(name, data)
}

// startTerminals makes the local terminal manager. It is made before any goroutine that reads
// c.terminalManager starts.
func (c *controller) startTerminals(ctx context.Context) {
	c.terminalManager = terminal.NewManager(ctx, c.logger, localSink{c: c})
}

// CreateTerminal starts a shell on this machine. The session belongs to owner and ends with it.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) CreateTerminal(
	ctx context.Context, owner terminal.Owner, opts terminal.Options,
) (_ *terminal.Session, err error) {
	ctx, end := startOp(ctx, "exec.CreateTerminal")
	defer end(&err)
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}
	// The id is in the index before the shell starts: its output, even its CLOSE, can come before this
	// call returns. It also keeps a terminal from taking the id of a session of a plugin.
	c.mu.Lock()
	if _, taken := c.sessionIndex[opts.ID]; taken {
		c.mu.Unlock()
		return nil, terminal.IDInUse(opts.ID)
	}
	c.sessionIndex[opts.ID] = sessionIndex{pluginID: "", connectionID: "", local: true}
	c.mu.Unlock()
	info, err := c.terminalManager.Start(opts, owner)
	if err != nil {
		c.mu.Lock()
		delete(c.sessionIndex, opts.ID)
		c.mu.Unlock()
		return nil, err
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("session_id", info.ID))
	c.logger.Infow(ctx, "exec session created", "sessionID", info.ID, "pluginID", "local")
	return &info, nil
}

// WriteTerminal applies input to a local terminal, in the order of its sequence numbers.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) WriteTerminal(sessionID string, seq uint64, data []byte) (err error) {
	_, span := tracer.Start(context.Background(), "exec.WriteTerminal")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))
	return c.terminalManager.Write(sessionID, seq, data)
}

// ResizeTerminal sets the size of a local terminal, in the order of its sequence numbers.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ResizeTerminal(sessionID string, seq uint64, rows, cols int) (err error) {
	_, span := tracer.Start(context.Background(), "exec.ResizeTerminal")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))
	return c.terminalManager.Resize(sessionID, seq, rows, cols)
}

// IsBusy says whether something other than the shell holds a terminal's foreground. A session of a
// plugin runs on another machine: the host holds no terminal for it, so it says unknown.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) IsBusy(sessionID string) (_ terminal.Foreground, err error) {
	_, span := tracer.Start(context.Background(), "exec.IsBusy")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))
	var none terminal.Foreground
	index, _, ok := c.lookupSession(sessionID)
	if !ok {
		return none, apperror.SessionNotFound(sessionID)
	}
	if !index.local {
		return terminal.UnknownForeground(terminal.ReasonRemote), nil
	}
	return c.terminalManager.Busy(sessionID)
}

// CloseOwnedTerminals ends the local terminals of owner, as its window going away does.
func (c *controller) CloseOwnedTerminals(owner terminal.Owner, by terminal.ClosedBy) int {
	if c.terminalManager == nil {
		return 0
	}
	ended := c.terminalManager.CloseOwned(owner, by)
	if ended > 0 {
		c.logger.Infow(context.Background(), "ended the terminals of a closed window", "count", ended)
	}
	return ended
}
