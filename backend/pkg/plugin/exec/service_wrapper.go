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
	return s.Ctrl.CreateSession(s.realmContext(ctx), plugin, connectionID, opts)
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
// The shell belongs to the window and ends with it: when the window closes, or the page it served is
// gone (the realm says so for both), the window's terminals are ended, and a tab restored in a new page
// says they ended. A call that comes from no window starts nothing: a terminal that nothing could ever
// retire would outlive everything.
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
		Labels: opts.Labels, Params: opts.Params,
	})
	if err != nil {
		return nil, err
	}
	// The window can be retired while the shell starts, and a retirement that came before the session was
	// registered found nothing to end. The realm refuses a retired window, so asking it again now that the
	// session is registered closes the gap: a retirement after this point finds the session.
	if _, admitErr := s.Realm.AdmitWindow(window); admitErr != nil {
		s.Ctrl.CloseOwnedTerminals(owner, terminal.ClosedByWindow)
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
			s.Ctrl.CloseOwnedTerminals(key, terminal.ClosedByWindow)
		})
	})
	return invocation.IdentityOf(window), nil
}
func (s *ServiceWrapper) ListSessions() ([]*execsdk.Session, error) {
	return s.Ctrl.ListSessions()
}
func (s *ServiceWrapper) GetSession(sessionID string) (*execsdk.Session, error) {
	return s.Ctrl.GetSession(sessionID)
}
func (s *ServiceWrapper) AttachSession(sessionID string) (*execsdk.Session, []byte, error) {
	return s.Ctrl.AttachSession(sessionID)
}
func (s *ServiceWrapper) DetachSession(sessionID string) (*execsdk.Session, error) {
	return s.Ctrl.DetachSession(sessionID)
}
func (s *ServiceWrapper) WriteSession(sessionID string, data []byte) error {
	return s.Ctrl.WriteSession(sessionID, data)
}
func (s *ServiceWrapper) CloseSession(sessionID string) error {
	return s.Ctrl.CloseSession(sessionID)
}
func (s *ServiceWrapper) ResizeSession(sessionID string, rows, cols uint16) error {
	return s.Ctrl.ResizeSession(sessionID, rows, cols)
}

// WriteTerminal applies input to a local terminal. seq is the caller's sequence number for the session,
// counted up from 1, one for each write or resize: calls the transport delivers out of order are applied
// in sequence order. Zero is "no number": the call is applied in the order it arrived.
func (s *ServiceWrapper) WriteTerminal(sessionID string, seq uint64, data []byte) error {
	return s.Ctrl.WriteTerminal(sessionID, seq, data)
}

// ResizeTerminal sets the size of a local terminal; seq is as for WriteTerminal.
func (s *ServiceWrapper) ResizeTerminal(sessionID string, seq uint64, rows, cols int) error {
	return s.Ctrl.ResizeTerminal(sessionID, seq, rows, cols)
}

// IsBusy says whether something other than the shell holds the terminal's foreground: idle, busy (with
// the program's name where the platform gives it) or unknown. The UI asks when the user closes a terminal.
func (s *ServiceWrapper) IsBusy(sessionID string) (terminal.Foreground, error) {
	return s.Ctrl.IsBusy(sessionID)
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
func (s *ServiceWrapper) GetCwd(sessionID string) (terminal.Directory, error) {
	return s.Ctrl.GetCwd(sessionID)
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
// remembered and is not found, as one that never existed.
func (s *ServiceWrapper) AckTerminal(sessionID string, n int) error {
	return s.Ctrl.AckTerminal(sessionID, n)
}
