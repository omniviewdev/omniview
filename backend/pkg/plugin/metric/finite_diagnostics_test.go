package metric

import (
	"context"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func TestDiagnosticsInflightPersistsUntilCanceledProviderActuallyReturns(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	release := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	p.query = func(pc *types.PluginContext, _ sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		<-release // A provider may ignore cancellation until its I/O returns.
		return nil, pc.Context.Err()
	}
	request, cancel := context.WithCancel(ctx)
	defer cancel()
	result := finiteTestRead(c, request, finiteTestSpec("caller-token", "object-a", "cpu"))
	finiteTestReceive(t, p.calls)
	f := c.finiteCoordinator()
	require.EqualValues(t, 1, f.diagnosticsState().Inflight)
	require.Zero(t, f.diagnosticsState().Queued)
	cancel()
	require.ErrorIs(t, finiteTestReceive(t, result).err, context.Canceled)
	// Detaching the last reader requests cancellation but must not free the slot.
	f.shutdown()
	require.EqualValues(t, 1, f.diagnosticsState().Inflight, "shutdown must not hide canceled provider work still running")
	require.Zero(t, f.diagnosticsState().Queued)
	close(release)
	require.Eventually(t, func() bool { return f.diagnosticsState().Inflight == 0 }, 3*time.Second, time.Millisecond)
	require.Zero(t, f.diagnosticsState().CacheEntries)
	require.Zero(t, f.diagnosticsState().CacheBytes)
}

func TestDiagnosticsCacheStateReflectsRetainedRepliesAndRetirement(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	result := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("caller-token", "object-a", "cpu")))
	require.NoError(t, result.err)
	f := c.finiteCoordinator()
	state := f.diagnosticsState()
	require.Zero(t, state.Queued)
	require.Zero(t, state.Inflight)
	require.EqualValues(t, 1, state.CacheEntries)
	require.Positive(t, state.CacheBytes)
	f.retire("kubernetes", "cluster", false)
	state = f.diagnosticsState()
	require.Zero(t, state.CacheEntries)
	require.Zero(t, state.CacheBytes)
	require.Zero(t, state.Inflight)
}
