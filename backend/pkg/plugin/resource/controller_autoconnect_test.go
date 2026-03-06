package resource

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestScheduleAutoConnect_StartsEligibleConnection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var starts atomic.Int32
	registerMockPlugin(ctrl, "p1", &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			starts.Add(1)
			return types.ConnectionStatus{Status: types.ConnectionStatusConnected}, nil
		},
	})

	conn := types.Connection{
		ID: "conn-1",
		Lifecycle: types.ConnectionLifecycle{
			AutoConnect: types.ConnectionAutoConnect{
				Enabled: true,
				Triggers: []types.ConnectionAutoConnectTrigger{
					types.ConnectionAutoConnectTriggerPluginStart,
				},
				Retry: types.ConnectionAutoConnectRetryNone,
			},
		},
	}

	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerPluginStart)

	require.Eventually(t, func() bool { return starts.Load() == 1 }, time.Second, 10*time.Millisecond)
}

func TestScheduleAutoConnect_SkipsOnTriggerMismatch(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var starts atomic.Int32
	registerMockPlugin(ctrl, "p1", &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			starts.Add(1)
			return types.ConnectionStatus{Status: types.ConnectionStatusConnected}, nil
		},
	})

	conn := types.Connection{
		ID: "conn-1",
		Lifecycle: types.ConnectionLifecycle{
			AutoConnect: types.ConnectionAutoConnect{
				Enabled: true,
				Triggers: []types.ConnectionAutoConnectTrigger{
					types.ConnectionAutoConnectTriggerPluginStart,
				},
				Retry: types.ConnectionAutoConnectRetryNone,
			},
		},
	}

	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerConnectionDiscovered)
	time.Sleep(50 * time.Millisecond)
	require.EqualValues(t, 0, starts.Load())
}

func TestScheduleAutoConnect_RetryNoneAttemptsOnce(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var starts atomic.Int32
	registerMockPlugin(ctrl, "p1", &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			starts.Add(1)
			return types.ConnectionStatus{Status: types.ConnectionStatusError, Error: "failed"}, nil
		},
	})

	conn := types.Connection{
		ID: "conn-1",
		Lifecycle: types.ConnectionLifecycle{
			AutoConnect: types.ConnectionAutoConnect{
				Enabled: true,
				Triggers: []types.ConnectionAutoConnectTrigger{
					types.ConnectionAutoConnectTriggerPluginStart,
				},
				Retry: types.ConnectionAutoConnectRetryNone,
			},
		},
	}

	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerPluginStart)
	require.Eventually(t, func() bool { return starts.Load() == 1 }, time.Second, 10*time.Millisecond)

	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerPluginStart)
	time.Sleep(50 * time.Millisecond)
	require.EqualValues(t, 1, starts.Load())
}

func TestScheduleAutoConnect_RetryOnChangeAttemptsOnSignatureChange(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var starts atomic.Int32
	registerMockPlugin(ctrl, "p1", &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			starts.Add(1)
			return types.ConnectionStatus{Status: types.ConnectionStatusError, Error: "failed"}, nil
		},
	})

	conn := types.Connection{
		ID:   "conn-1",
		Data: map[string]any{"docker_host": "unix:///var/run/docker.sock"},
		Lifecycle: types.ConnectionLifecycle{
			AutoConnect: types.ConnectionAutoConnect{
				Enabled: true,
				Triggers: []types.ConnectionAutoConnectTrigger{
					types.ConnectionAutoConnectTriggerPluginStart,
				},
				Retry: types.ConnectionAutoConnectRetryOnChange,
			},
		},
	}

	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerPluginStart)
	require.Eventually(t, func() bool { return starts.Load() == 1 }, time.Second, 10*time.Millisecond)

	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerPluginStart)
	time.Sleep(50 * time.Millisecond)
	require.EqualValues(t, 1, starts.Load())

	conn.Data["docker_host"] = "unix:///tmp/docker.sock"
	ctrl.scheduleAutoConnect("p1", []types.Connection{conn}, types.ConnectionAutoConnectTriggerPluginStart)
	require.Eventually(t, func() bool { return starts.Load() == 2 }, time.Second, 10*time.Millisecond)
}

func TestListenForConnectionEvents_AutoConnectsOnDiscoveredTrigger(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var starts atomic.Int32
	mock := &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			starts.Add(1)
			return types.ConnectionStatus{Status: types.ConnectionStatusConnected}, nil
		},
		WatchConnectionsFunc: func(ctx context.Context, stream chan<- []types.Connection) error {
			stream <- []types.Connection{
				{
					ID: "conn-1",
					Lifecycle: types.ConnectionLifecycle{
						AutoConnect: types.ConnectionAutoConnect{
							Enabled: true,
							Triggers: []types.ConnectionAutoConnectTrigger{
								types.ConnectionAutoConnectTriggerConnectionDiscovered,
							},
							Retry: types.ConnectionAutoConnectRetryNone,
						},
					},
				},
			}
			<-ctx.Done()
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		ctrl.listenForConnectionEvents("p1", mock, ctx)
		close(done)
	}()

	require.Eventually(t, func() bool { return starts.Load() == 1 }, time.Second, 10*time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("listener did not stop after cancel")
	}
}

func TestClearAutoConnectAttempts_AllowsRetryAfterRestart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	first := ctrl.shouldAttemptAutoConnect("p1", "conn-1", "sig-1", types.ConnectionAutoConnectRetryNone)
	require.True(t, first)

	second := ctrl.shouldAttemptAutoConnect("p1", "conn-1", "sig-1", types.ConnectionAutoConnectRetryNone)
	require.False(t, second)

	ctrl.clearAutoConnectAttempts("p1")

	third := ctrl.shouldAttemptAutoConnect("p1", "conn-1", "sig-1", types.ConnectionAutoConnectRetryNone)
	require.True(t, third)
}

func TestShouldAttemptAutoConnect_EmptyRetryBehavesAsNone(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	first := ctrl.shouldAttemptAutoConnect("p1", "conn-1", "sig-1", "")
	require.True(t, first)

	second := ctrl.shouldAttemptAutoConnect("p1", "conn-1", "sig-2", "")
	require.False(t, second)
}
