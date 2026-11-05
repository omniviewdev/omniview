package resource

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/stretchr/testify/require"
)

type fatalTransportTestProvider struct {
	*mockProvider
	closes atomic.Int32
}

func (p *fatalTransportTestProvider) Close() error {
	p.closes.Add(1)
	return nil
}

func TestFatalSourceTransportReportsGenerationOwnedHealth(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &fatalTransportTestProvider{mockProvider: &mockProvider{}}
	registerMockPlugin(ctrl, "p", provider)
	state := ctrl.plugins["p"]
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	state.backend = backend
	var guard func(func()) bool
	ctrl.SetFatalTransportCallback(func(id string, got plugintypes.PluginBackend, owned func(func()) bool) {
		require.Equal(t, "p", id)
		require.Same(t, backend, got)
		guard = owned
		called := false
		require.True(t, owned(func() { called = true }))
		require.True(t, called)
	})
	require.True(t, ctrl.retireFatalSourceTransport("p", state, errors.New("fatal transport")))
	require.NotNil(t, guard)
	registerMockPlugin(ctrl, "p", &mockProvider{})
	called := false
	require.False(t, guard(func() { called = true }))
	require.False(t, called)
}

func TestFatalSourceTransportRetiresOwnedGeneration(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	provider := &fatalTransportTestProvider{mockProvider: &mockProvider{}}
	registerMockPlugin(ctrl, "p", provider)
	registerMockPlugin(ctrl, "other", &mockProvider{})
	state := ctrl.plugins["p"]
	state.metadataAvailable = true
	ctx, cancel := context.WithCancel(state.ctx)
	session := &sourceSession{coordinator: ctrl.sources, key: "source", pluginID: "p", pluginGeneration: state, ctx: ctx, cancel: cancel, views: make(map[string]*sourceView)}
	ctrl.sources.sessions[session.key] = session

	require.True(t, ctrl.retireFatalSourceTransport("p", state, errors.New("fatal transport")))
	require.ErrorIs(t, state.ctx.Err(), context.Canceled)
	require.Nil(t, state.provider)
	require.False(t, state.metadataAvailable)
	require.True(t, session.closed)
	require.Empty(t, ctrl.sources.sessions)
	require.EqualValues(t, 1, provider.closes.Load())
	require.NotNil(t, ctrl.plugins["other"].provider)
	require.NotEmpty(t, emitter.EventsWithKey(EventConnectionMetadata))
	_, _, _, _, err := ctrl.operationGeneration(context.Background(), "p", session.target.Route)
	require.Error(t, err)
	require.False(t, ctrl.retireFatalSourceTransport("p", state, errors.New("duplicate")))
	require.EqualValues(t, 1, provider.closes.Load())
}

func TestFatalSourceTransportDoesNotRetireReplacement(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	old := &fatalTransportTestProvider{mockProvider: &mockProvider{}}
	registerMockPlugin(ctrl, "p", old)
	stale := ctrl.plugins["p"]
	replacement := &fatalTransportTestProvider{mockProvider: &mockProvider{}}
	registerMockPlugin(ctrl, "p", replacement)
	current := ctrl.plugins["p"]

	require.False(t, ctrl.retireFatalSourceTransport("p", stale, errors.New("late fatal transport")))
	require.False(t, ctrl.retireFatalSourceTransport("p", nil, errors.New("missing generation")))
	require.Same(t, replacement, current.provider)
	require.NoError(t, current.ctx.Err())
	require.Zero(t, replacement.closes.Load())
	require.Empty(t, emitter.EventsWithKey(EventConnectionMetadata))
}

func TestFatalSourceTransportConcurrentReportsRetireOnce(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &fatalTransportTestProvider{mockProvider: &mockProvider{}}
	registerMockPlugin(ctrl, "p", provider)
	state := ctrl.plugins["p"]
	var retired atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ctrl.retireFatalSourceTransport("p", state, errors.New("fatal transport")) {
				retired.Add(1)
			}
		}()
	}
	wg.Wait()
	require.EqualValues(t, 1, retired.Load())
	require.EqualValues(t, 1, provider.closes.Load())
}
