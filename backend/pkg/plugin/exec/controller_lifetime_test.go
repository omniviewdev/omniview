package exec

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

func TestDirectStopDrainsSDKExecWorkerWithoutApplicationCancellation(t *testing.T) {
	manager := sdkexec.NewManager(sdkexec.ManagerConfig{Logger: logging.NewNop()})
	backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Exec: manager})
	if err != nil {
		t.Fatal(err)
	}
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	ctrl.ctx = context.Background()
	ctrl.OnPluginInit("native", config.PluginMeta{})
	if err := ctrl.OnPluginStart("native", config.PluginMeta{}, backend); err != nil {
		t.Fatal(err)
	}
	ctrl.mu.RLock()
	done := ctrl.streams["native"].done
	ctrl.mu.RUnlock()
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = ctrl.OnPluginShutdown("native", config.PluginMeta{})
	}()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("native exec worker survived provider shutdown")
	}
	select {
	case <-done:
	default:
		t.Fatal("native exec stop returned before forwarding worker drained")
	}
}

// Hold frames in the real forwarding queue until their generation retires.
// Reusing the session ID also proves an old close cannot remove a new session.
func TestNativeExecRetirementDropsQueuedOutput(t *testing.T) {
	const pluginID = "native"
	const sessionID = "reused-session"
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	ctrl.ctx = ctx
	ctrl.outputMux = make(chan execProviderOutput, 4)
	emitted := make(chan execTestEvent, 8)
	ctrl.events = execTestEmitter(func(name string, data ...any) bool {
		emitted <- execTestEvent{name: name, data: data[0]}
		return false
	})
	ctrl.OnPluginInit(pluginID, config.PluginMeta{})

	start := func() *queuedExecProvider {
		t.Helper()
		provider := &queuedExecProvider{output: make(chan sdkexec.StreamOutput)}
		backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Exec: provider})
		require.NoError(t, err)
		require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{}, backend))
		return provider
	}
	old := start()
	var queued []execProviderOutput
	for _, output := range []sdkexec.StreamOutput{
		{SessionID: sessionID, Data: []byte("retired stdout")},
		{SessionID: sessionID, Signal: sdkexec.StreamSignalError, Error: &sdkexec.StreamError{Title: "retired error"}},
		{SessionID: sessionID, Signal: sdkexec.StreamSignalClose},
	} {
		sendExecTestOutput(t, old.output, output)
		select {
		case frame := <-ctrl.outputMux:
			queued = append(queued, frame)
		case <-time.After(5 * time.Second):
			t.Fatal("native output did not reach the forwarding queue")
		}
	}
	for _, frame := range queued {
		ctrl.outputMux <- frame
	}
	require.NoError(t, ctrl.OnPluginStop(pluginID, config.PluginMeta{}))

	active := start()
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginStop(pluginID, config.PluginMeta{})) })
	ctrl.mu.Lock()
	ctrl.sessionIndex[sessionID] = sessionIndex{pluginID: pluginID}
	ctrl.mu.Unlock()
	muxDone := make(chan struct{})
	go func() {
		defer close(muxDone)
		ctrl.runMux()
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-muxDone:
		case <-time.After(5 * time.Second):
			t.Error("exec mux did not stop")
		}
	})

	// The active frame follows all retired frames in the same FIFO queue.
	sendExecTestOutput(t, active.output, sdkexec.StreamOutput{SessionID: sessionID, Data: []byte("active stdout")})
	select {
	case event := <-emitted:
		require.Equal(t, "core/exec/stream/stdout/"+sessionID, event.name)
		require.Equal(t, []byte("active stdout"), event.data)
	case <-time.After(5 * time.Second):
		t.Fatal("active native output was not emitted")
	}
	ctrl.mu.RLock()
	_, indexed := ctrl.sessionIndex[sessionID]
	ctrl.mu.RUnlock()
	require.True(t, indexed, "retired close removed the replacement session")

	sendExecTestOutput(t, active.output, sdkexec.StreamOutput{SessionID: sessionID, Signal: sdkexec.StreamSignalClose})
	select {
	case event := <-emitted:
		require.Equal(t, "core/exec/signal/CLOSE/"+sessionID, event.name)
	case <-time.After(5 * time.Second):
		t.Fatal("active close was not emitted")
	}
	ctrl.mu.RLock()
	_, indexed = ctrl.sessionIndex[sessionID]
	ctrl.mu.RUnlock()
	require.False(t, indexed, "active close did not remove its session")
}

func TestNativeExecStopDrainsBlockedOutputForwarder(t *testing.T) {
	provider := &queuedExecProvider{output: make(chan sdkexec.StreamOutput)}
	backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Exec: provider})
	require.NoError(t, err)
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	ctrl.ctx = context.Background()
	ctrl.OnPluginInit("native", config.PluginMeta{})
	require.NoError(t, ctrl.OnPluginStart("native", config.PluginMeta{}, backend))
	// No mux receiver exists. After this handoff the worker must either be
	// entering or blocked in its output send when stop cancels the stream.
	sendExecTestOutput(t, provider.output, sdkexec.StreamOutput{SessionID: "blocked", Data: []byte("pending")})
	ctrl.mu.RLock()
	done := ctrl.streams["native"].done
	ctrl.mu.RUnlock()
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = ctrl.OnPluginStop("native", config.PluginMeta{})
	}()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("native exec stop blocked on queued output")
	}
	select {
	case <-done:
	default:
		t.Fatal("native exec stop returned before forwarding worker drained")
	}
}

type queuedExecProvider struct {
	sdkexec.Provider
	output chan sdkexec.StreamOutput
}

func (*queuedExecProvider) GetSupportedResources(*sdktypes.PluginContext) []sdkexec.Handler {
	return nil
}

func (p *queuedExecProvider) Stream(context.Context, chan sdkexec.StreamInput) (chan sdkexec.StreamOutput, error) {
	return p.output, nil
}

func (*queuedExecProvider) Close() {}

type execTestEvent struct {
	name string
	data any
}

type execTestEmitter func(string, ...any) bool

func (emit execTestEmitter) Emit(name string, data ...any) bool {
	return emit(name, data...)
}

func sendExecTestOutput(t *testing.T, output chan sdkexec.StreamOutput, frame sdkexec.StreamOutput) {
	t.Helper()
	select {
	case output <- frame:
	case <-time.After(5 * time.Second):
		t.Fatal("native output forwarder did not receive frame")
	}
}
