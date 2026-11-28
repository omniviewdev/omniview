package exec

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
)

// A local terminal's events go to every window, under the names the exec lane uses for any session:
// the shell's output as bytes on core/exec/stream/stdout/<id>, and how it ended as one terminal.End
// on core/exec/signal/CLOSE/<id>, after the last output. The output of a terminal that has a page key, which a
// page can attach to again after a reload, comes on core/exec/stream/output/<id> instead, as {offset, data}:
// data is base64 text as before and offset is the number of bytes the terminal wrote before it, so that a replay
// and the live output join exactly (docs/ui-next/status/T2-go.md). When a page loses a terminal it had attached
// (another page took it over, it detached it, its window went away) one terminal.Detachment says so on
// core/exec/signal/DETACHED/<id>: the page acts on it when its attachment number is the event's.
const (
	localOutputEvent       = "core/exec/stream/stdout/"
	localOffsetOutputEvent = "core/exec/stream/output/"
	localCloseEvent        = "core/exec/signal/CLOSE/"
	localDetachedEvent     = "core/exec/signal/DETACHED/"
)

// terminalOutput is the payload of a local terminal's stdout event: the bytes the shell wrote, which
// serialize as base64 text, exactly as a plain byte slice does, and the transport's own signal that it took
// them. Wails serializes an event when it writes it to a client, and the moment that is DELIVERY is what the
// host counts as credit (terminal.DeliveryReporter): it keeps a client whose socket stalls from making the
// host hold more than the credit, with nothing asked of the client. Which serialization it is depends on
// the build (countsAsDelivery): in a native build it is the window's, which Wails makes in its dispatch
// worker one event at a time, after the window has run the one before; in a server build it is the one that
// writes a client's socket, in that client's worker, after the write of the one before, so it happens only
// as fast as the socket drains. A server build serializes every event a second time first, for the window
// it keeps (Event.ToJSON, in the dispatch worker, which never waits for a socket), and that one is not
// delivery.
type terminalOutput struct {
	data []byte
	// offset is where data lies in the terminal's output, and positioned says the event carries it: it does for
	// a terminal that has a page key, and its payload is then an object, not the bytes alone.
	offset     uint64
	positioned bool
	delivered  func()
	once       sync.Once
}

// positionedOutput is the payload of the output event of a terminal with a page key.
type positionedOutput struct {
	Offset uint64 `json:"offset"`
	Data   []byte `json:"data"`
}

// Bytes is the output.
func (o *terminalOutput) Bytes() []byte { return o.data }

// deliver reports the delivery once, whichever serialization comes first.
func (o *terminalOutput) deliver() { o.once.Do(o.delivered) }

// MarshalJSON is the base64 text a byte slice serializes as, or the object that carries it with its offset, and,
// when this serialization is the one that is delivery in this build, the delivery report.
func (o *terminalOutput) MarshalJSON() ([]byte, error) {
	if countsAsDelivery() {
		o.deliver()
	}
	if o.positioned {
		return json.Marshal(positionedOutput{Offset: o.offset, Data: o.data})
	}
	return json.Marshal(o.data)
}

// localSink delivers a local terminal's events. The manager calls it from one goroutine for each
// session, in order, so a session's events keep their order without a lock of the controller's.
type localSink struct{ c *controller }

// ReportsDelivery says the sink tells the manager when the transport took the output: Output returns at
// once, whatever the client does.
func (s localSink) ReportsDelivery() {}

func (s localSink) Output(sessionID string, data []byte) {
	s.emitOutput(localOutputEvent+sessionID, sessionID, 0, false, data)
}

// OutputAt is the output of a terminal that has a page key, with its offset.
func (s localSink) OutputAt(sessionID string, offset uint64, data []byte) {
	s.emitOutput(localOffsetOutputEvent+sessionID, sessionID, offset, true, data)
}

func (s localSink) emitOutput(event, sessionID string, offset uint64, positioned bool, data []byte) {
	// Bound to the session whose output this is, now: the report comes later, and the id may belong to another session then.
	credit := s.c.terminalManager.DeliveryCredit(sessionID)
	out := &terminalOutput{
		data: data, offset: offset, positioned: positioned,
		delivered: func() { credit.Delivered(len(data)) }, once: sync.Once{},
	}
	if s.c.events == nil {
		s.c.logger.Errorw(context.Background(), "event emitter is nil, cannot dispatch output")
		out.deliver() // there is no transport to wait for
		return
	}
	if cancelled := s.c.events.Emit(event, out); cancelled {
		out.deliver() // an event a hook cancelled is never serialized: the credit does not wait for it
	}
}

func (s localSink) Closed(sessionID string, end terminal.End) {
	s.c.logger.Debugw(context.Background(), "closing session", "sessionID", sessionID, "reason", end.Reason)
	// The session doesn't exist anymore: remove it from the index.
	s.c.mu.Lock()
	delete(s.c.sessionIndex, sessionID)
	s.c.mu.Unlock()
	s.c.emitLocal(localCloseEvent+sessionID, end)
}

// Detached tells every window that a page lost a terminal it had attached. It is called by the call that changed
// hands, with no lock of the manager held.
func (s localSink) Detached(sessionID string, detachment terminal.Detachment) {
	s.c.emitLocal(localDetachedEvent+sessionID, detachment)
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
	c.terminalManager.SetIntegration(c.shellIntegrationOn)
}

// shellIntegrationOn is the user's opt-out of the shell integration, asked for every terminal that starts so that a change
// in Settings applies to the next one. The integration is on by default: with no settings to ask, or a value that cannot be
// read, the manager is told so and leaves the shell alone.
func (c *controller) shellIntegrationOn() (bool, error) {
	if c.settingsProvider == nil {
		return true, nil
	}
	return c.settingsProvider.GetBool("terminal.shellIntegration")
}

// CreateTerminal starts a shell on this machine. The session belongs to owner and ends with it; a channel terminal
// (opts.Channel) belongs to no one: see createChannelTerminal.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) CreateTerminal(
	ctx context.Context, owner terminal.Owner, opts terminal.Options,
) (_ *terminal.Session, err error) {
	ctx, end := startOp(ctx, "exec.CreateTerminal")
	defer end(&err)
	if isResourceProcessID(opts.ID) {
		return nil, invalidShellRequest()
	}
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}
	opts.Command = withDefaultShell(opts.Command, c.defaultShellSetting)
	if opts.Channel {
		return c.createChannelTerminal(ctx, opts)
	}
	// The id is in the index before the shell starts: its output, even its CLOSE, can come before this
	// call returns. It also keeps a terminal from taking the id of a session of a plugin.
	c.mu.Lock()
	if c.idHeldLocked(opts.ID) {
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
	c.logger.Infow(ctx, "exec session created", "sessionID", info.ID, "pluginID", localPluginID)
	return &info, nil
}

// createChannelTerminal starts a channel terminal. It has no record in the index of the events lane, so every call that names a
// terminal by its id finds nothing, it has no owner and no window, and nothing of it goes out as an event: the page reaches it by
// the capability in the answer, which is never logged or put in a span. Its id is held from the check to the manager's own hold,
// under the one lock that every lane decides an id under (idHeldLocked): an id that a session has or that is being made is
// refused, as for any terminal.
func (c *controller) createChannelTerminal(ctx context.Context, opts terminal.Options) (*terminal.Session, error) {
	c.mu.Lock()
	if c.idHeldLocked(opts.ID) {
		c.mu.Unlock()
		return nil, terminal.IDInUse(opts.ID)
	}
	c.channelMaking[opts.ID] = true
	c.mu.Unlock()
	info, err := c.terminalManager.Start(opts, nil)
	c.mu.Lock()
	delete(c.channelMaking, opts.ID)
	c.mu.Unlock()
	if err != nil {
		return nil, err
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("session_id", info.ID))
	c.logger.Infow(ctx, "exec channel terminal created", "sessionID", info.ID)
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

// AckTerminal tells a local terminal that n more bytes of its output were taken in by the client. It runs
// for every few kilobytes of output, so it opens no span.
func (c *controller) AckTerminal(sessionID string, n int) error {
	return c.terminalManager.Ack(sessionID, n)
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

// GetCwd says which directory a terminal's shell is in now. A session of a plugin runs on another
// machine, so it says unknown.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) GetCwd(sessionID string) (_ terminal.Directory, err error) {
	_, span := tracer.Start(context.Background(), "exec.GetCwd")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))
	var none terminal.Directory
	index, _, ok := c.lookupSession(sessionID)
	if !ok {
		return none, apperror.SessionNotFound(sessionID)
	}
	if !index.local {
		return terminal.Directory{Path: "", Reason: terminal.ReasonRemote}, nil
	}
	return c.terminalManager.Cwd(sessionID)
}

// ReleaseOwnedTerminals is what a window going away does to its local terminals: those that have a page key are
// detached and kept for their lease, any other is ended.
func (c *controller) ReleaseOwnedTerminals(owner terminal.Owner, by terminal.ClosedBy) terminal.Released {
	var none terminal.Released
	if c.terminalManager == nil {
		return none
	}
	released := c.terminalManager.ReleaseOwned(owner, by)
	if released.Detached > 0 || released.Ended > 0 {
		c.logger.Infow(context.Background(), "released the terminals of a window that went away", "detached", released.Detached, "ended", released.Ended)
	}
	return released
}

// CloseTerminalUnlessTakenOver ends a local terminal that a call could not hand to owner's window, unless
// another window took it over meanwhile.
func (c *controller) CloseTerminalUnlessTakenOver(sessionID string, owner terminal.Owner) {
	if c.terminalManager == nil {
		return
	}
	c.terminalManager.CloseUnlessTakenOver(sessionID, owner)
}

// AttachTerminal takes a local terminal over for owner and hands it the output it lacks.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) AttachTerminal(
	ctx context.Context, owner terminal.Owner, sessionID string, request terminal.AttachRequest,
) (_ *terminal.Attached, err error) {
	_, span := tracer.Start(ctx, "exec.AttachTerminal")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))
	return c.terminalManager.Attach(sessionID, owner, request)
}

// DetachTerminal leaves a local terminal waiting for a page for a lease.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) DetachTerminal(
	ctx context.Context, owner terminal.Owner, sessionID string, request terminal.DetachRequest,
) (_ *terminal.Detached, err error) {
	_, span := tracer.Start(ctx, "exec.DetachTerminal")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))
	detached, err := c.terminalManager.Detach(sessionID, owner, request)
	if err != nil {
		return nil, err
	}
	return &detached, nil
}

// ListTerminals says which local terminals the owner, or whoever holds the key, may attach. It opens no span:
// a page asks it once as it loads.
func (c *controller) ListTerminals(owner terminal.Owner, pageKey string) []terminal.Listed {
	return c.terminalManager.List(owner, pageKey)
}

// ServeTerminalChannel serves one stream of the terminal channel until it ends: the stream's first frame names the
// terminal by its capability, and the connection is the terminal's holder for as long as it lasts. It opens no span: a
// stream lives as long as a page does.
func (c *controller) ServeTerminalChannel(ch terminal.Channel) { c.terminalManager.ServeChannel(ch) }

// CloseChannelTerminal ends the channel terminal that the capability names. The capability is never an attribute of
// the span, and the answer for a capability that opens nothing holds nothing the caller sent.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) CloseChannelTerminal(capability string) (err error) {
	_, span := tracer.Start(context.Background(), "exec.CloseChannelTerminal")
	defer finishOp(span, &err)
	err = c.terminalManager.CloseChannel(capability)
	if errors.Is(err, terminal.ErrCloseTimeout) {
		c.logger.Warnw(context.Background(), "a channel terminal was still ending when its close stopped waiting")
	}
	return err
}

// ChannelTerminalBusy says whether something other than the shell holds the foreground of a channel terminal.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ChannelTerminalBusy(capability string) (_ terminal.Foreground, err error) {
	_, span := tracer.Start(context.Background(), "exec.ChannelTerminalBusy")
	defer finishOp(span, &err)
	return c.terminalManager.ChannelBusy(capability)
}

// ChannelTerminalCwd says which directory the shell of a channel terminal is in now.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ChannelTerminalCwd(capability string) (_ terminal.Directory, err error) {
	_, span := tracer.Start(context.Background(), "exec.ChannelTerminalCwd")
	defer finishOp(span, &err)
	return c.terminalManager.ChannelCwd(capability)
}

// ChannelTerminalCommands reads the record of the commands the shell of a channel terminal told of.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ChannelTerminalCommands(capability string) (_ terminal.Commands, err error) {
	_, span := tracer.Start(context.Background(), "exec.ChannelTerminalCommands")
	defer finishOp(span, &err)
	return c.terminalManager.ChannelCommands(capability)
}

// ChannelTerminalResolveLink says what a candidate link in a channel terminal's output names on this machine. The span has no attribute and nothing is
// logged: the text and the paths are the user's data.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ChannelTerminalResolveLink(capability, rowDirectory, text string) (_ terminal.LinkResolution, err error) {
	_, span := tracer.Start(context.Background(), "exec.ChannelTerminalResolveLink")
	defer finishOp(span, &err)
	return c.terminalManager.ChannelResolveLink(capability, rowDirectory, text)
}

// ListChannelTerminals lists the channel terminals of the capabilities given, and only those, in the order given. It
// opens no span: a page asks it once as it loads.
func (c *controller) ListChannelTerminals(capabilities []string) ([]terminal.ChannelListed, error) {
	return c.terminalManager.ListChannels(capabilities)
}

// DismissChannelTerminal forgets the end that a channel terminal left.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) DismissChannelTerminal(capability string) (err error) {
	_, span := tracer.Start(context.Background(), "exec.DismissChannelTerminal")
	defer finishOp(span, &err)
	return c.terminalManager.DismissChannel(capability)
}
