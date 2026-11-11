package exec

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	"github.com/omniviewdev/omniview/internal/nativeapps"
	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel/attribute"

	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// ServiceWrapper is an explicit delegation wrapper around exec.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy
type ServiceWrapper struct {
	Ctrl  Controller
	Realm invocation.ContextScope
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

func (s *ServiceWrapper) CreateTerminal(opts execsdk.SessionOptions) (*execsdk.Session, error) {
	return s.Ctrl.CreateTerminal(opts)
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
