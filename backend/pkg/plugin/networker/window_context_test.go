package networker

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdknetworker "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type forwardingWindow struct {
	application.Window
	id uint
}

func (w *forwardingWindow) ID() uint { return w.id }
func (w *forwardingWindow) OnWindowEvent(events.WindowEventType, func(*application.WindowEvent)) func() {
	return func() {}
}

type forwardingConnections struct {
	t     *testing.T
	owner string
	calls int
}

func (f *forwardingConnections) GetConnection(ctx context.Context, plugin, connection string) (sdktypes.Connection, error) {
	f.calls++
	request, ok := invocation.FromContext(ctx)
	require.True(f.t, ok)
	require.Equal(f.t, f.owner, request.Principal().Owner())
	return sdktypes.Connection{ID: connection}, nil
}

type forwardingProvider struct {
	Provider
	calls int
	ctx   *sdktypes.PluginContext
}

func (p *forwardingProvider) StartPortForwardSession(ctx *sdktypes.PluginContext, _ sdknetworker.PortForwardSessionOptions) (*sdknetworker.PortForwardSession, error) {
	p.calls++
	p.ctx = ctx
	return &sdknetworker.PortForwardSession{ID: "forward"}, nil
}

func TestWindowRealmForwardBindingPreservesOwnerAndSessionLifetime(t *testing.T) {
	realm := invocation.NewWindowRealm(nil)
	window := &forwardingWindow{id: 1}
	owner := realm.ScopeForWindow(window).Principal().Owner()
	for _, test := range []struct {
		name    string
		window  application.Window
		allowed bool
	}{
		{"owner", window, true},
		{"missing", nil, false},
		{"other", &forwardingWindow{id: 2}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			connections := &forwardingConnections{t: t, owner: owner}
			ctrl := NewController(logging.NewNop(), nil, connections).(*controller)
			provider := &forwardingProvider{}
			ctrl.clients = map[string]Provider{"plugin": provider}
			boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, _ string, _ invocation.Target) error {
				if principal.Owner() != owner {
					return resourcev2.NewError("FORBIDDEN", "Reference belongs to another window.")
				}
				return nil
			}))
			ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
				return boundary.Admit(realm.Context(ctx), operation, invocation.Target{Provider: plugin, Connection: route.Connection})
			})
			options := sdknetworker.PortForwardSessionOptions{
				ConnectionType: sdknetworker.PortForwardConnectionTypeResource,
				Protocol:       sdknetworker.PortForwardProtocolTCP,
				RemotePort:     80,
				Connection: &sdknetworker.PortForwardResourceConnection{
					Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "plugin", Authority: "cluster", Type: "pod", ID: "pod", Scope: []resourcev2.ScopeEntry{}}},
					Route:     &resourcev2.AccessRoute{Connection: "connection"},
				},
			}
			encoded, err := json.Marshal(options)
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if test.window != nil {
				ctx = context.WithValue(ctx, application.WindowKey, test.window)
			}
			wrapper := &ServiceWrapper{Ctrl: ctrl, Realm: realm}
			_, err = wrapper.StartResourcePortForwardingSession(ctx, "plugin", "connection", string(encoded))
			if !test.allowed {
				require.Error(t, err)
				require.Zero(t, provider.calls)
				require.Zero(t, connections.calls)
				return
			}
			require.NoError(t, err)
			require.Equal(t, 1, provider.calls)
			require.Equal(t, 1, connections.calls)
			require.Same(t, window, provider.ctx.Context.Value(application.WindowKey))
			cancel()
			require.NoError(t, provider.ctx.Context.Err())
		})
	}
}

func TestForwardControllerPreservesHeadlessReferenceAuthority(t *testing.T) {
	scope := invocation.NewScope(invocation.ExternalAgent)
	connections := &forwardingConnections{t: t, owner: scope.Principal().Owner()}
	ctrl := NewController(logging.NewNop(), nil, connections).(*controller)
	provider := &forwardingProvider{}
	ctrl.clients = map[string]Provider{"plugin": provider}
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, _ string, _ invocation.Target) error {
		require.Equal(t, invocation.ExternalAgent, principal.Origin())
		require.Equal(t, scope.Principal().Owner(), principal.Owner())
		return nil
	}))
	ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
		return boundary.Admit(ctx, operation, invocation.Target{Provider: plugin, Connection: route.Connection})
	})
	_, err := ctrl.StartResourcePortForwardingSession(scope.Context(context.Background()), "plugin", "connection", sdknetworker.PortForwardSessionOptions{
		ConnectionType: sdknetworker.PortForwardConnectionTypeResource,
		Connection: &sdknetworker.PortForwardResourceConnection{
			Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "plugin", Authority: "cluster", Type: "pod", ID: "pod", Scope: []resourcev2.ScopeEntry{}}},
			Route:     &resourcev2.AccessRoute{Connection: "connection"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, 1, provider.calls)
	request, ok := invocation.FromContext(provider.ctx.Context)
	require.True(t, ok)
	require.Equal(t, invocation.ExternalAgent, request.Principal().Origin())
}
