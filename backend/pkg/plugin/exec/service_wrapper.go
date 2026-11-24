package exec

import (
	"context"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	"github.com/omniviewdev/omniview/internal/nativeapps"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// WindowRealm is what the wrapper needs of the host's window realm: provenance for a call, the
// admission of the window that makes it, and the signal that a window is gone.
type WindowRealm interface {
	invocation.ContextScope
	AdmitWindow(window application.Window) (*invocation.Scope, error)
	OnRetire(fn func(invocation.WindowIdentity))
}

// ServiceWrapper is an explicit delegation wrapper around exec.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy
type ServiceWrapper struct {
	Ctrl  Controller
	Realm WindowRealm
	// retire subscribes to the realm's retirement signal once, before the first terminal is made.
	retire sync.Once
}

func (s *ServiceWrapper) realmContext(ctx context.Context) context.Context {
	if s.Realm == nil {
		return ctx
	}
	return s.Realm.Context(ctx)
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.Ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *ServiceWrapper) ServiceShutdown() error {
	if ss, ok := s.Ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}

// CreateSession starts a session of a plugin for the window that asks: it belongs to that window until the window
// goes away, and then to whichever window attaches it first (T2c-go.md). A call that comes from no window creates
// a session that belongs to none. A window that retires while the plugin makes the session leaves it to none as well
// (the session is recorded as the window's, and the retirement, which came before, found nothing of the window's to
// release).
func (s *ServiceWrapper) CreateSession(
	ctx context.Context,
	plugin, connectionID string,
	encoded string,
) (*execsdk.Session, error) {
	var opts execsdk.SessionOptions
	if err := transportjson.Decode(encoded, &opts, plugin, connectionID); err != nil {
		_, end := startOp(ctx, "exec.CreateSession",
			attribute.String("plugin_id", plugin), attribute.String("connection_id", connectionID))
		end(&err)
		return nil, err
	}
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	var owner terminal.Owner
	if window != nil && s.Realm != nil {
		identity, err := s.terminalOwner(window)
		if err != nil {
			return nil, err
		}
		owner = identity
	}
	session, err := s.Ctrl.CreateSession(s.realmContext(ctx), owner, plugin, connectionID, opts)
	if err != nil || owner == nil {
		return session, err
	}
	// A retirement that came while the plugin made the session found no session of the window to orphan, and the session
	// has just been recorded as the window's: nobody could list it, claim it or release it. The realm refuses a window
	// that was retired, and has already refused it when it announces the retirement, so asking it again, now that the
	// session is recorded, closes the gap exactly as it does for a terminal (CreateTerminal): a retirement before this
	// point is seen here, and one after it finds the session and orphans it. The session goes on, and any window that
	// lists it takes it.
	if _, admitErr := s.Realm.AdmitWindow(window); admitErr != nil {
		s.Ctrl.ReleaseOwnedTerminals(owner, terminal.ClosedByWindow)
	}
	return session, nil
}

// OpenNativeSession accepts only the same bounded resource payload as CreateSession.
// Executables and launch commands are never accepted from the frontend.
func (s *ServiceWrapper) OpenNativeSession(ctx context.Context, plugin, connectionID, encoded string) error {
	var opts execsdk.SessionOptions
	if err := transportjson.Decode(encoded, &opts, plugin, connectionID); err != nil {
		_, end := startOp(ctx, "exec.OpenNativeSession",
			attribute.String("plugin_id", plugin), attribute.String("connection_id", connectionID))
		end(&err)
		return err
	}
	return s.Ctrl.OpenNativeSession(s.realmContext(ctx), plugin, connectionID, opts)
}

func (s *ServiceWrapper) GetNativeTerminalSupport() bool {
	return s.Ctrl.GetNativeTerminalSupport()
}

// GetNativeTerminalApplications discovers installed applications with safe native launch adapters.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetNativeTerminalApplications() (_ []nativeapps.Application, err error) {
	ctx, end := startOp(context.Background(), "exec.GetNativeTerminalApplications")
	defer end(&err)
	return nativeapps.Discover(ctx)
}

// CreateTerminal starts a shell on this machine for the window that asks. opts names it as for any
// session (its id, if the caller chose one so that it can listen first, and its command; empty is the
// account's login shell) and launch says where and how it starts: the directory (empty is the user's
// home) and the size the pty is opened at before the shell starts. The answer states the shell, the
// directory it started in and the size that was applied. Every terminal is paced by credit: the host stops
// reading a shell whose client does not take its output (T1-go.md, 2.8.6).
//
// The shell belongs to the window. Without launch.page_key it ends with the window: when the window closes,
// or the page it served is gone (the realm says so for both), and a tab restored in a new page says it ended.
// With a page key it is detached instead, and kept for a lease (launch.lease_ms; five minutes, at most
// thirty): the page that comes back lists its terminals with ListTerminals and takes one over with
// AttachTerminal, and what the shell wrote meanwhile is replayed (docs/ui-next/status/T2-go.md). Its output
// then arrives on core/exec/stream/output/<id> with an offset. A call that comes from no window starts
// nothing: a terminal that nothing could ever retire would outlive everything.
func (s *ServiceWrapper) CreateTerminal(ctx context.Context, opts execsdk.SessionOptions, launch terminal.Launch) (*terminal.Session, error) {
	if opts.HasResourceIntent() {
		return nil, resourcev2.NewError("INVALID_REQUEST", "A local terminal cannot execute a resource request.")
	}
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	owner, err := s.terminalOwner(window)
	if err != nil {
		return nil, err
	}
	session, err := s.Ctrl.CreateTerminal(ctx, owner, terminal.Options{
		ID: opts.ID, Command: opts.Command, Cols: launch.Cols, Rows: launch.Rows, Cwd: launch.Cwd,
		PageKey: launch.PageKey, LeaseMs: launch.LeaseMs, Labels: opts.Labels, Params: opts.Params,
	})
	if err != nil {
		return nil, err
	}
	// The window can be retired while the shell starts, and a retirement that came before the session was
	// registered found nothing to release. The realm refuses a retired window, so asking it again now that the
	// session is registered closes the gap: a retirement after this point finds the session. A terminal that
	// no page can know about is ended whatever its key says: a detached one would wait for a page that never
	// heard of it. One that another window took over meanwhile (a page with the same key, which chose the id) is
	// not this call's to end.
	if _, admitErr := s.Realm.AdmitWindow(window); admitErr != nil {
		s.Ctrl.CloseTerminalUnlessTakenOver(session.ID, owner)
		return nil, admitErr
	}
	return session, nil
}

// terminalOwner admits the window and names it as the owner of the terminals it opens.
func (s *ServiceWrapper) terminalOwner(window application.Window) (invocation.WindowIdentity, error) {
	var none invocation.WindowIdentity
	if s.Realm == nil || window == nil {
		return none, apperror.Forbidden("Access denied", "A terminal belongs to the window that opens it.")
	}
	if _, err := s.Realm.AdmitWindow(window); err != nil {
		return none, err
	}
	// Subscribed before the first session is made, so no retirement can fall before it.
	s.retire.Do(func() {
		s.Realm.OnRetire(func(key invocation.WindowIdentity) {
			s.Ctrl.ReleaseOwnedTerminals(key, terminal.ClosedByWindow)
		})
	})
	return invocation.IdentityOf(window), nil
}

// callerOf names the window that makes a call that addresses a session by its id: the identity the realm issued for
// it, which no page can name for another. A call that comes from no window has none and holds nothing. The window is
// not admitted: one that holds nothing is refused whatever it is, and a window that was retired holds nothing.
func callerOf(ctx context.Context) terminal.Owner {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	if window == nil {
		return nil
	}
	return invocation.IdentityOf(window)
}

// ListSessions lists the sessions the calling window holds, and the sessions of plugins that no window holds. Every
// call below that names a session by its id answers not-found to a window that does not hold it, as for an id that
// never was (T2c-go.md).
func (s *ServiceWrapper) ListSessions(ctx context.Context) ([]*execsdk.Session, error) {
	return s.Ctrl.ListSessions(callerOf(ctx))
}
func (s *ServiceWrapper) GetSession(ctx context.Context, sessionID string) (*execsdk.Session, error) {
	return s.Ctrl.GetSession(callerOf(ctx), sessionID)
}

// AttachSession returns a session's output: for the window that holds it, or that claims it (a session of a plugin
// that no window holds, or one its owner offered with OfferSession), which holds it from then on. A claim can make a
// window the owner of a session, and a window that holds a session has to be one the realm knows, so that its
// retirement releases what it holds: the window is admitted here and not only when it opens a terminal of its own. A
// call that comes from no window, or from one the realm refuses, claims nothing and is told what is told of an id that
// never was.
func (s *ServiceWrapper) AttachSession(ctx context.Context, sessionID string) (*execsdk.Session, []byte, error) {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	owner, err := s.terminalOwner(window)
	if err != nil {
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	return s.Ctrl.AttachSession(owner, sessionID)
}
func (s *ServiceWrapper) DetachSession(ctx context.Context, sessionID string) (*execsdk.Session, error) {
	return s.Ctrl.DetachSession(callerOf(ctx), sessionID)
}
func (s *ServiceWrapper) WriteSession(ctx context.Context, sessionID string, data []byte) error {
	return s.Ctrl.WriteSession(callerOf(ctx), sessionID, data)
}
func (s *ServiceWrapper) CloseSession(ctx context.Context, sessionID string) error {
	return s.Ctrl.CloseSession(callerOf(ctx), sessionID)
}
func (s *ServiceWrapper) ResizeSession(ctx context.Context, sessionID string, rows, cols uint16) error {
	return s.Ctrl.ResizeSession(callerOf(ctx), sessionID, rows, cols)
}

// OfferSession lets the next window that attaches the session take it over, within a minute, once: the move of a
// tab to another window. Only the window that holds the session offers it; the offer gives no other window access.
func (s *ServiceWrapper) OfferSession(ctx context.Context, sessionID string) error {
	return s.Ctrl.OfferSession(callerOf(ctx), sessionID)
}

// WriteTerminal applies input to a local terminal. seq is the caller's sequence number for the session,
// counted up from 1, one for each write or resize: calls the transport delivers out of order are applied
// in sequence order. Zero is "no number": the call is applied in the order it arrived.
func (s *ServiceWrapper) WriteTerminal(ctx context.Context, sessionID string, seq uint64, data []byte) error {
	return s.Ctrl.WriteTerminal(callerOf(ctx), sessionID, seq, data)
}

// ResizeTerminal sets the size of a local terminal; seq is as for WriteTerminal.
func (s *ServiceWrapper) ResizeTerminal(ctx context.Context, sessionID string, seq uint64, rows, cols int) error {
	return s.Ctrl.ResizeTerminal(callerOf(ctx), sessionID, seq, rows, cols)
}

// IsBusy says whether something other than the shell holds the terminal's foreground: idle, busy (with
// the program's name where the platform gives it) or unknown. The UI asks when the user closes a terminal.
func (s *ServiceWrapper) IsBusy(ctx context.Context, sessionID string) (terminal.Foreground, error) {
	return s.Ctrl.IsBusy(callerOf(ctx), sessionID)
}

// ListTerminals says which terminals the calling page may attach: those of its window that have a page key,
// and those that carry the page key it gives (a server-mode reload is a new window: the key is how the page
// finds its terminals again). A terminal without a key is not listed, and nothing lists another page's
// terminals or any key. A terminal that ended by itself while no page was attached is listed with how it
// ended, for what is left of its lease. A call that comes from no window lists nothing, and is refused.
func (s *ServiceWrapper) ListTerminals(ctx context.Context, pageKey string) ([]terminal.Listed, error) {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	owner, err := s.terminalOwner(window)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.ListTerminals(owner, pageKey), nil
}

// AttachTerminal takes a terminal over for the calling window and hands it what the page lacks, in one step:
// request.page_key is the key the terminal was opened with (a window that owns the terminal needs none) and
// request.from_offset is the offset of the first byte the page does not have (absent: the page has nothing).
// The answer's replay is exactly the output from there to replay.end, with the size and the modes that
// output was written under and the ones now; the terminal's events continue at replay.end, with no byte lost
// at or above it. An event below it is already in the replay, was handed to the transport before the answer,
// and may still reach the page after it: the page drops every event at or below what it has, held or live. The
// page listens first, then attaches. It acknowledges what it takes in from events and never the replay. The
// answer's attachment is the number of this attachment: the page that held the terminal before is told, on
// core/exec/signal/DETACHED/<id>, that its attachment ended. A terminal that ended while no page was attached
// answers its replay and how it ended. A caller that may not attach is told what is told of a terminal that
// is not there.
func (s *ServiceWrapper) AttachTerminal(ctx context.Context, sessionID string, request terminal.AttachRequest) (*terminal.Attached, error) {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	owner, err := s.terminalOwner(window)
	if err != nil {
		return nil, err
	}
	attached, err := s.Ctrl.AttachTerminal(ctx, owner, sessionID, request)
	if err != nil {
		return nil, err
	}
	// The window can be retired while it attaches, and a retirement that came before the terminal was its own
	// found nothing to release: asking the realm again closes the gap, as for a new terminal.
	if _, admitErr := s.Realm.AdmitWindow(window); admitErr != nil {
		s.Ctrl.ReleaseOwnedTerminals(owner, terminal.ClosedByWindow)
		return nil, admitErr
	}
	return attached, nil
}

// DetachTerminal leaves a terminal waiting for a page, as the window going away does, without waiting for the
// realm to notice: a page that is leaving says so, and the shell is held at once. request.lease_ms is how
// long to keep it (zero: the terminal's own lease; more than thirty minutes is cut to it) and the answer says
// the lease that applies and when it ends. A terminal that is already detached stays as it is. The window that
// owns the terminal detaches it; the key detaches only a terminal that no window owns, so that a tab that was
// displaced by a copy of it (which shares the key) cannot detach what the other tab shows: it is told what is
// told of a terminal that is not there.
func (s *ServiceWrapper) DetachTerminal(ctx context.Context, sessionID string, request terminal.DetachRequest) (*terminal.Detached, error) {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	owner, err := s.terminalOwner(window)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.DetachTerminal(ctx, owner, sessionID, request)
}
func (s *ServiceWrapper) GetHandler(plugin, resource string) *execsdk.Handler {
	return s.Ctrl.GetHandler(plugin, resource)
}
func (s *ServiceWrapper) GetHandlers() map[string]map[string]execsdk.Handler {
	return s.Ctrl.GetHandlers()
}
func (s *ServiceWrapper) GetPluginHandlers(plugin string) map[string]execsdk.Handler {
	return s.Ctrl.GetPluginHandlers(plugin)
}
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}

// GetCwd says which directory a terminal's shell is in now: the shell's own current working directory,
// read from the system when asked, or why it cannot be read (see terminal.Directory). A session of a plugin
// runs on another machine and answers unknown.
func (s *ServiceWrapper) GetCwd(ctx context.Context, sessionID string) (terminal.Directory, error) {
	return s.Ctrl.GetCwd(callerOf(ctx), sessionID)
}

// AckTerminal tells a terminal that n more bytes of its output were taken in by the client: written into its
// emulator, or deliberately dropped. A terminal UI MUST call it: its first call turns flow on, from then on
// only its acknowledgements credit, and it must acknowledge every byte it parses, dropped bytes included.
// Without acknowledgements a flood grows the host's memory without bound (a server build with a reader that
// keeps up, a native webview that stalls): the transport's credit alone does not bound what Wails retains
// after the point where the host credits. A client that never calls it (the legacy terminal) still gets every
// byte, paced by what its transport took (docs/ui-next/status/T1-go.md, 2.8.6). A session that is ending, or
// is one of the last 256 that ended, takes the acknowledgement and answers success, because there is nothing
// left to credit and the last acknowledgement of an exiting shell races its CLOSE; an older session is not
// remembered and is not found, as one that never existed. After an attach the replay is not acknowledged, nor
// is an event whose offset is below the replay's end: the attach forgot what was owed for it.
func (s *ServiceWrapper) AckTerminal(ctx context.Context, sessionID string, n int) error {
	return s.Ctrl.AckTerminal(callerOf(ctx), sessionID, n)
}

// RevokeSession takes back the offer that OfferSession made: the move of a tab that did not happen (the drop was refused,
// or the window that was to take it went away). Only the window that holds the session revokes it; an offer that is not
// open is nothing to take back, and no error.
func (s *ServiceWrapper) RevokeSession(ctx context.Context, sessionID string) error {
	return s.Ctrl.RevokeSession(callerOf(ctx), sessionID)
}
