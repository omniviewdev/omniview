package exec

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
)

type nativeAdmissionKey struct{}

type nativeConnectionFixture struct {
	t       *testing.T
	failure error
}

func (f nativeConnectionFixture) GetConnection(_ context.Context, plugin, connectionID string) (sdktypes.Connection, error) {
	require.Equal(f.t, "installed-plugin", plugin)
	require.Equal(f.t, "selected-connection", connectionID)
	return sdktypes.Connection{ID: connectionID, Name: "authoritative connection"}, f.failure
}

type nativePlanFixture struct {
	Provider
	calls       int
	createCalls int
	plan        *execsdk.NativeCommand
	failure     error
	context     *sdktypes.PluginContext
}

func (p *nativePlanFixture) PlanNativeCommand(pc *sdktypes.PluginContext, _ execsdk.SessionOptions) (*execsdk.NativeCommand, error) {
	p.calls++
	p.context = pc
	return p.plan, p.failure
}

func (p *nativePlanFixture) CreateSession(_ *sdktypes.PluginContext, _ execsdk.SessionOptions) (*execsdk.Session, error) {
	p.createCalls++
	return &execsdk.Session{ID: "builtin-created"}, nil
}

type nativeLaunchFixture struct {
	supported   bool
	calls       int
	application string
	plan        *execsdk.NativeCommand
	failure     error
}

func (l *nativeLaunchFixture) Supported() bool { return l.supported }
func (l *nativeLaunchFixture) Launch(_ context.Context, application string, plan *execsdk.NativeCommand) error {
	l.calls++
	l.application, l.plan = application, plan
	return l.failure
}

func nativeSessionOptions() execsdk.SessionOptions {
	return execsdk.SessionOptions{
		Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
			Provider: "canonical-provider", Authority: "cluster", Type: "pod", ID: "opaque/id", Scope: []resourcev2.ScopeEntry{},
		}},
		Route:   &resourcev2.AccessRoute{Connection: "selected-connection"},
		Command: []string{"/bin/sh"}, TTY: true,
	}
}

func nativeSessionController(t *testing.T) (*controller, *nativePlanFixture, *nativeLaunchFixture) {
	t.Helper()
	ctrl := NewController(logging.NewNop(), nil, nativeConnectionFixture{t: t}).(*controller)
	provider := &nativePlanFixture{plan: &execsdk.NativeCommand{Executable: "fixture-cli", Args: []string{"literal"}}}
	launcher := &nativeLaunchFixture{supported: true}
	ctrl.clients = map[string]Provider{"installed-plugin": provider}
	ctrl.nativeLauncher = launcher
	ctrl.referenceAdmitter = func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		require.Equal(t, "exec.CreateSession", operation, "native and built-in use the same host admission")
		require.Equal(t, "installed-plugin", plugin)
		require.Equal(t, *nativeSessionOptions().Route, route)
		require.Equal(t, *nativeSessionOptions().Reference, ref)
		return context.WithValue(ctx, nativeAdmissionKey{}, true), nil
	}
	return ctrl, provider, launcher
}

func TestOpenNativeSessionPreservesAdmissionAndAllocatesNoSession(t *testing.T) {
	ctrl, provider, launcher := nativeSessionController(t)
	ctrl.sessionIndex["existing"] = sessionIndex{pluginID: "installed-plugin", connectionID: "selected-connection"}
	opts := nativeSessionOptions()
	encoded, err := json.Marshal(opts)
	require.NoError(t, err)
	wrapper := ServiceWrapper{Ctrl: ctrl}
	require.True(t, wrapper.GetNativeTerminalSupport())
	require.NoError(t, wrapper.OpenNativeSession("installed-plugin", "selected-connection", string(encoded)))
	require.Equal(t, 1, provider.calls)
	require.Equal(t, "selected-connection", provider.context.Connection.ID)
	require.Equal(t, "authoritative connection", provider.context.Connection.Name)
	require.Equal(t, true, provider.context.Context.Value(nativeAdmissionKey{}))
	_, deadline := provider.context.Context.Deadline()
	require.True(t, deadline)
	require.Equal(t, 1, launcher.calls)
	require.Equal(t, "terminal", launcher.application)
	require.Same(t, provider.plan, launcher.plan)
	require.Zero(t, provider.createCalls)
	require.Len(t, ctrl.sessionIndex, 1)
	require.Contains(t, ctrl.sessionIndex, "existing")
	require.Empty(t, ctrl.inChans)
}

func TestOpenNativeSessionUsesConfiguredApplication(t *testing.T) {
	ctrl, _, launcher := nativeSessionController(t)
	ctrl.settingsProvider = settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{{
		ID: "terminal", Settings: map[string]settings.Setting{"nativeApplication": {ID: "nativeApplication", Type: settings.Text, Default: "iterm2"}},
	}}})
	require.NoError(t, ctrl.OpenNativeSession("installed-plugin", "selected-connection", nativeSessionOptions()))
	require.Equal(t, "iterm2", launcher.application)
}

func TestOpenNativeSessionRejectsBeforePlanning(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*controller, *execsdk.SessionOptions)
		plugin string
		code   string
	}{
		{"no reference", func(_ *controller, o *execsdk.SessionOptions) { o.Reference = nil }, "installed-plugin", "INVALID_REQUEST"},
		{"no route", func(_ *controller, o *execsdk.SessionOptions) { o.Route = nil }, "installed-plugin", "INVALID_REQUEST"},
		{"wrong route", func(_ *controller, o *execsdk.SessionOptions) { o.Route.Connection = "different" }, "installed-plugin", "INVALID_REQUEST"},
		{"local", nil, "local", "INVALID_REQUEST"},
		{"unsupported platform", func(c *controller, _ *execsdk.SessionOptions) { c.nativeLauncher = &nativeLaunchFixture{} }, "installed-plugin", "UNSUPPORTED"},
		{"no admission", func(c *controller, _ *execsdk.SessionOptions) { c.referenceAdmitter = nil }, "installed-plugin", "UNSUPPORTED"},
		{"denied admission", func(c *controller, _ *execsdk.SessionOptions) {
			c.referenceAdmitter = func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (context.Context, error) {
				return nil, resourcev2.NewError("FORBIDDEN", "denied")
			}
		}, "installed-plugin", "FORBIDDEN"},
		{"legacy provider", func(c *controller, _ *execsdk.SessionOptions) { c.clients["installed-plugin"] = NewAdapterV1(nil) }, "installed-plugin", "UNSUPPORTED"},
		{"connection unavailable", func(c *controller, _ *execsdk.SessionOptions) {
			c.resourceClient = nativeConnectionFixture{t: t, failure: errors.New("unavailable")}
		}, "installed-plugin", "UNAVAILABLE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctrl, provider, launcher := nativeSessionController(t)
			opts := nativeSessionOptions()
			if test.change != nil {
				test.change(ctrl, &opts)
			}
			err := ctrl.OpenNativeSession(test.plugin, "selected-connection", opts)
			require.Equal(t, test.code, resourcev2.ErrorCode(err))
			require.Zero(t, provider.calls)
			require.Zero(t, provider.createCalls)
			require.Zero(t, launcher.calls)
			require.Empty(t, ctrl.sessionIndex)
		})
	}
}

func TestOpenNativeSessionProviderAndLaunchErrorsNeverFallback(t *testing.T) {
	for _, test := range []struct {
		name                string
		plan                *execsdk.NativeCommand
		planning, launching error
		code                string
	}{
		{"unsupported", nil, resourcev2.NewError("UNSUPPORTED", "unsupported auth"), nil, "UNSUPPORTED"},
		{"stale reference", nil, resourcev2.NewError("RESET_REQUIRED", "stale reference"), nil, "RESET_REQUIRED"},
		{"invalid plan", &execsdk.NativeCommand{}, nil, nil, "INVALID_REQUEST"},
		{"launch denied", &execsdk.NativeCommand{Executable: "fixture-cli"}, nil, resourcev2.NewError("FORBIDDEN", "Automation denied"), "FORBIDDEN"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctrl, provider, launcher := nativeSessionController(t)
			provider.plan, provider.failure, launcher.failure = test.plan, test.planning, test.launching
			err := ctrl.OpenNativeSession("installed-plugin", "selected-connection", nativeSessionOptions())
			require.Equal(t, test.code, resourcev2.ErrorCode(err))
			require.Equal(t, 1, provider.calls)
			require.Zero(t, provider.createCalls)
			require.Empty(t, ctrl.sessionIndex)
			require.Empty(t, ctrl.inChans)
		})
	}
}

func TestNativeMissingPluginAndBuiltinSessionUnaffected(t *testing.T) {
	ctrl, provider, _ := nativeSessionController(t)
	delete(ctrl.clients, "installed-plugin")
	var appError *apperror.AppError
	require.ErrorAs(t, ctrl.OpenNativeSession("installed-plugin", "selected-connection", nativeSessionOptions()), &appError)
	require.Equal(t, apperror.TypePluginNotFound, appError.Type)
	ctrl.clients["installed-plugin"] = provider
	session, err := ctrl.CreateSession("installed-plugin", "selected-connection", nativeSessionOptions())
	require.NoError(t, err)
	require.Equal(t, "builtin-created", session.ID)
	require.Contains(t, ctrl.sessionIndex, session.ID)
	require.Equal(t, 1, provider.createCalls)
	require.Zero(t, provider.calls)
}

func TestOpenNativeSessionDecodeRejectsArbitraryAndUnboundedInput(t *testing.T) {
	// A nil controller proves decoding rejects before dispatching any host call.
	wrapper := ServiceWrapper{}
	for _, encoded := range []string{
		`{"Executable":"/bin/sh","Args":["-c","arbitrary"]}`,
		`{"command":["sh"],"unknown":"field"}`,
		`{"command":["unterminated]}`,
		strings.Repeat(" ", resourcev2.MaxMessageBytes+1),
	} {
		require.Error(t, wrapper.OpenNativeSession("plugin", "connection", encoded))
	}
	require.Error(t, wrapper.OpenNativeSession("\xff", "connection", `{}`))
}

func TestNativeAdapterRejectsLegacyProvider(t *testing.T) {
	legacy := NewAdapterV1(nil)
	plan, err := legacy.PlanNativeCommand(nil, nativeSessionOptions())
	require.Nil(t, plan)
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
}

func TestOpenNativeSessionRejectsUnavailableOrInvalidSetting(t *testing.T) {
	for _, application := range []string{"missing setting", "invalid"} {
		t.Run(application, func(t *testing.T) {
			ctrl, provider, launcher := nativeSessionController(t)
			ctrl.settingsProvider = settings.NewProvider(settings.ProviderOpts{})
			want := "UNAVAILABLE"
			if application == "invalid" {
				ctrl.settingsProvider = settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{{
					ID: "terminal", Settings: map[string]settings.Setting{"nativeApplication": {ID: "nativeApplication", Type: settings.Text, Default: "arbitrary-app"}},
				}}})
				want = "INVALID_REQUEST"
			}
			err := ctrl.OpenNativeSession("installed-plugin", "selected-connection", nativeSessionOptions())
			require.Equal(t, want, resourcev2.ErrorCode(err))
			require.Zero(t, provider.calls)
			require.Zero(t, launcher.calls)
			require.Empty(t, ctrl.sessionIndex)
		})
	}
}
