package resource

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
	"github.com/stretchr/testify/require"
)

func TestWatchStartupFailureRollsBackBeforeSourcesStart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	var loaded atomic.Int32
	provider := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(context.Context) ([]types.Connection, error) {
			loaded.Add(1)
			return nil, nil
		}),
		resourcetest.WithListenForEventsFunc(func(context.Context, resource.WatchEventSink, func() error) error {
			return &resource.ResourceOperationError{Code: "FORBIDDEN", Message: "native event access denied"}
		}),
	)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, provider)})
	err := ctrl.OnPluginStart("proof", defaultMeta(), backend)
	var denied *resource.ResourceOperationError
	require.ErrorAs(t, err, &denied)
	require.Equal(t, "FORBIDDEN", denied.Code)
	present, inspectErr := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, inspectErr)
	require.False(t, present)
	require.Zero(t, loaded.Load(), "failed stream registration must not admit connection sources")
}

func TestWatchStartupStopCancelsPendingActualRPC(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	entered := make(chan struct{})
	stopped := make(chan struct{})
	provider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, _ resource.WatchEventSink, _ func() error) error {
			defer close(stopped)
			close(entered)
			<-ctx.Done()
			return ctx.Err()
		}),
	)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, provider)})
	done := make(chan error, 1)
	go func() { done <- ctrl.OnPluginStart("proof", defaultMeta(), backend) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("actual event RPC did not reach pending registration")
	}
	require.NoError(t, ctrl.OnPluginStop("proof", defaultMeta()))
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("stopped plugin startup did not return its registration failure")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stopped plugin retained its actual server registration")
	}
	present, inspectErr := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, inspectErr)
	require.False(t, present)
}

func TestWatchStartupTimeoutReturnsFailureAndRetiresActualRPC(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	stopped := make(chan struct{})
	provider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, _ resource.WatchEventSink, _ func() error) error {
			defer close(stopped)
			<-ctx.Done()
			return ctx.Err()
		}),
	)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, provider)})
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown("proof", defaultMeta())) })
	// Exercise the unchanged production readiness deadline, not a fake clock.
	err := ctrl.OnPluginStart("proof", defaultMeta(), backend)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("timed-out startup retained its actual server registration")
	}
	present, inspectErr := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, inspectErr)
	require.False(t, present)
}
