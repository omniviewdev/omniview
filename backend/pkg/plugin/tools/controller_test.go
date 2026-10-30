package tools

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

type fakeProvider struct {
	descriptors []sdktools.Descriptor
	listErr     error
	listStarted chan struct{}
	listRelease chan struct{}
}

func (f *fakeProvider) ListTools(*sdktypes.PluginContext) ([]sdktools.Descriptor, error) {
	if f.listStarted != nil {
		close(f.listStarted)
		<-f.listRelease
	}
	return f.descriptors, f.listErr
}

func (f *fakeProvider) CallTool(*sdktypes.PluginContext, sdktools.CallInput) (*sdktools.Result, error) {
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
	ctrl := NewController(logging.NewNop(), nil)
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
	ctrl := NewController(logging.NewNop(), nil)
	provider := &fakeProvider{listErr: errors.New("boom")}
	err := ctrl.OnPluginStart("alpha", config.PluginMeta{ID: "alpha"}, &fakeBackend{provider: provider, version: 1})
	require.ErrorContains(t, err, "boom")
	require.False(t, ctrl.HasPlugin("alpha"))
}

func TestControllerDoesNotConfusePluginProtocolWithToolsContract(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil)
	require.NoError(t, ctrl.OnPluginStart("alpha", config.PluginMeta{ID: "alpha"}, &fakeBackend{provider: &fakeProvider{}, version: 2}))
}

func TestControllerRejectsUnknownPlugin(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil)
	_, err := ctrl.CallTool(context.Background(), "missing", nil, "ping", nil)
	require.ErrorContains(t, err, "missing")
}

func TestFailedReplacementRetiresOldTools(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil)
	meta := config.PluginMeta{ID: "alpha"}
	require.NoError(t, ctrl.OnPluginStart("alpha", meta, &fakeBackend{provider: &fakeProvider{}, version: 1}))
	old := ctrl.ListAll()["alpha"].Generation
	require.NotZero(t, old)
	require.Error(t, ctrl.OnPluginStart("alpha", meta, &fakeBackend{
		provider: &fakeProvider{listErr: errors.New("failed replacement")}, version: 1,
	}))
	require.Empty(t, ctrl.ListAll())
	_, err := ctrl.CallTool(WithGeneration(context.Background(), old), "alpha", nil, "ping", nil)
	require.Error(t, err)
}

func TestDispatchRejectsReplacedGeneration(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil)
	meta := config.PluginMeta{ID: "alpha"}
	backend := &fakeBackend{provider: &fakeProvider{}, version: 1}
	require.NoError(t, ctrl.OnPluginStart("alpha", meta, backend))
	old := ctrl.ListAll()["alpha"].Generation
	require.NoError(t, ctrl.OnPluginStart("alpha", meta, backend))
	require.NotEqual(t, old, ctrl.ListAll()["alpha"].Generation)
	_, err := ctrl.CallTool(WithGeneration(context.Background(), old), "alpha", nil, "ping", nil)
	require.ErrorIs(t, err, context.Canceled)
}

func TestStopCancelsDiscoveryAndFencesLatePublication(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil)
	provider := &fakeProvider{listStarted: make(chan struct{}), listRelease: make(chan struct{})}
	defer close(provider.listRelease)
	started := make(chan error, 1)
	meta := config.PluginMeta{ID: "alpha"}
	go func() { started <- ctrl.OnPluginStart("alpha", meta, &fakeBackend{provider: provider, version: 1}) }()
	select {
	case <-provider.listStarted:
	case <-time.After(time.Second):
		t.Fatal("tool discovery did not start")
	}
	require.NoError(t, ctrl.OnPluginStop("alpha", meta))
	select {
	case err := <-started:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(time.Second):
		t.Fatal("stop did not cancel discovery")
	}
	require.Empty(t, ctrl.ListAll())
}
