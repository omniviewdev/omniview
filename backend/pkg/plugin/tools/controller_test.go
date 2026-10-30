package tools

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

type fakeProvider struct {
	descriptors []sdktools.Descriptor
	listErr     error
	lastCtx     *sdktypes.PluginContext
	lastInput   sdktools.CallInput
}

func (f *fakeProvider) ListTools(*sdktypes.PluginContext) ([]sdktools.Descriptor, error) {
	return f.descriptors, f.listErr
}

func (f *fakeProvider) CallTool(ctx *sdktypes.PluginContext, input sdktools.CallInput) (*sdktools.Result, error) {
	f.lastCtx = ctx
	f.lastInput = input
	return sdktools.TextResult("ok"), nil
}

type fakeBackend struct {
	provider *fakeProvider
	version  int
}

func (b *fakeBackend) Dispense(name string) (interface{}, error) {
	if name != "tools" {
		return nil, errors.New("unexpected capability " + name)
	}
	return b.provider, nil
}
func (b *fakeBackend) Healthy() bool          { return true }
func (b *fakeBackend) Stop() error            { return nil }
func (b *fakeBackend) Kill()                  {}
func (b *fakeBackend) Exited() bool           { return false }
func (b *fakeBackend) NegotiatedVersion() int { return b.version }

func TestControllerCachesToolsAndNotifies(t *testing.T) {
	ctrl := NewController(logging.NewNop())
	changes := 0
	ctrl.OnChange(func() { changes++ })

	provider := &fakeProvider{descriptors: []sdktools.Descriptor{{Name: "ping", Scope: sdktools.ScopePlugin}}}
	meta := config.PluginMeta{ID: "alpha", Name: "Alpha"}
	require.NoError(t, ctrl.OnPluginStart("alpha", meta, &fakeBackend{provider: provider, version: 1}))

	all := ctrl.ListAll()
	require.Len(t, all, 1)
	require.Equal(t, "Alpha", all["alpha"].Meta.Name)
	require.Equal(t, "ping", all["alpha"].Tools[0].Name)
	require.True(t, ctrl.HasPlugin("alpha"))
	require.Equal(t, 1, changes)

	require.NoError(t, ctrl.OnPluginStop("alpha", meta))
	require.Empty(t, ctrl.ListAll())
	require.False(t, ctrl.HasPlugin("alpha"))
	require.Equal(t, 2, changes)

	// Stopping an unknown plugin does not notify.
	require.NoError(t, ctrl.OnPluginShutdown("alpha", meta))
	require.Equal(t, 2, changes)
}

func TestControllerStartFailsOnListError(t *testing.T) {
	ctrl := NewController(logging.NewNop())
	provider := &fakeProvider{listErr: errors.New("boom")}
	err := ctrl.OnPluginStart("alpha", config.PluginMeta{ID: "alpha"}, &fakeBackend{provider: provider, version: 1})
	require.ErrorContains(t, err, "boom")
	require.False(t, ctrl.HasPlugin("alpha"))
}

func TestControllerRejectsUnsupportedVersion(t *testing.T) {
	ctrl := NewController(logging.NewNop())
	err := ctrl.OnPluginStart("alpha", config.PluginMeta{ID: "alpha"}, &fakeBackend{provider: &fakeProvider{}, version: 2})
	require.ErrorContains(t, err, "Unsupported SDK protocol version")
}

func TestControllerCallToolPassesConnection(t *testing.T) {
	ctrl := NewController(logging.NewNop())
	provider := &fakeProvider{}
	require.NoError(t, ctrl.OnPluginStart("alpha", config.PluginMeta{ID: "alpha"}, &fakeBackend{provider: provider, version: 1}))

	conn := &sdktypes.Connection{ID: "prod", Name: "Production"}
	res, err := ctrl.CallTool(context.Background(), "alpha", conn, "ping", json.RawMessage(`{"a":1}`))
	require.NoError(t, err)
	require.Equal(t, "ok", res.Content[0].Text)
	require.Equal(t, "prod", provider.lastCtx.Connection.ID)
	require.Equal(t, "mcp", provider.lastCtx.RequesterID)
	require.Equal(t, "ping", provider.lastInput.Name)
	require.JSONEq(t, `{"a":1}`, string(provider.lastInput.Arguments))

	_, err = ctrl.CallTool(context.Background(), "alpha", nil, "ping", nil)
	require.NoError(t, err)
	require.Nil(t, provider.lastCtx.Connection)

	_, err = ctrl.CallTool(context.Background(), "missing", nil, "ping", nil)
	require.ErrorContains(t, err, "missing")
}
