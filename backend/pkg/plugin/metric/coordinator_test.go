package metric

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func TestCoordinatorSharesInflightAndCancelsOnlyLastConsumer(t *testing.T) {
	q := &queryCoordinator{partitions: map[string]*queryPartition{}, slots: make(chan struct{}, maxQueryConcurrency)}
	started := make(chan struct{}, 1)
	finish := make(chan struct{})
	providerCancelled := make(chan struct{}, 1)
	var calls atomic.Int32
	execute := func(ctx context.Context, resources []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error) {
		calls.Add(1)
		started <- struct{}{}
		select {
		case <-ctx.Done():
			providerCancelled <- struct{}{}
			return nil, ctx.Err()
		case <-finish:
		}
		return &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{{ResourceToken: "identity", MetricID: "cpu", Status: sdk.MetricStatusMissing, ExpiresAt: time.Now().Add(time.Second)}}}, nil
	}
	resources := []sdk.MetricResource{{Token: "identity"}}
	firstCtx, cancelFirst := context.WithCancel(context.Background())
	defer cancelFirst()
	first := make(chan error, 1)
	second := make(chan error, 1)
	go func() {
		_, err := q.query(firstCtx, "owner-auth-tenant-datasource", resources, execute, func() bool { return true })
		first <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("shared work did not start")
	}
	go func() {
		_, err := q.query(context.Background(), "owner-auth-tenant-datasource", resources, execute, func() bool { return true })
		second <- err
	}()
	require.Eventually(t, func() bool {
		q.Lock()
		defer q.Unlock()
		p := q.partitions["owner-auth-tenant-datasource"]
		return len(p.flights) == 1 && p.flights[0].refs == 2
	}, time.Second, time.Millisecond)
	cancelFirst()
	require.ErrorIs(t, <-first, context.Canceled)
	select {
	case <-providerCancelled:
		t.Fatal("one consumer cancelled another consumer's work")
	default:
	}
	close(finish)
	require.NoError(t, <-second)
	require.Equal(t, int32(1), calls.Load())
	_, err := q.query(context.Background(), "owner-auth-tenant-datasource", resources, execute, func() bool { return true })
	require.NoError(t, err)
	require.Equal(t, int32(1), calls.Load())
}
func TestCoordinatorDifferentAuthorizationPartitionsNeverShare(t *testing.T) {
	q := &queryCoordinator{partitions: map[string]*queryPartition{}, slots: make(chan struct{}, maxQueryConcurrency)}
	var calls atomic.Int32
	execute := func(context.Context, []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error) {
		calls.Add(1)
		return &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{{ResourceToken: "same-resource", MetricID: "cpu", Status: sdk.MetricStatusMissing, ExpiresAt: time.Now().Add(time.Second)}}}, nil
	}
	for _, partition := range []string{"principal-one:tenant-one:ds-one", "principal-two:tenant-one:ds-one", "principal-one:tenant-two:ds-one", "principal-one:tenant-one:ds-two"} {
		_, err := q.query(context.Background(), partition, []sdk.MetricResource{{Token: "same-resource"}}, execute, func() bool { return true })
		require.NoError(t, err)
	}
	require.Equal(t, int32(4), calls.Load())
}
func TestCoordinatorLastConsumerCancellationStopsBackend(t *testing.T) {
	q := &queryCoordinator{partitions: map[string]*queryPartition{}, slots: make(chan struct{}, maxQueryConcurrency)}
	started := make(chan struct{})
	cancelled := make(chan struct{})
	done := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	execute := func(ctx context.Context, _ []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error) {
		close(started)
		<-ctx.Done()
		close(cancelled)
		return nil, ctx.Err()
	}
	go func() {
		_, err := q.query(ctx, "partition", []sdk.MetricResource{{Token: "identity"}}, execute, func() bool { return true })
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("last consumer did not cancel backend")
	}
}

func TestCoordinatorChecksObservationGenerationOnCacheDelivery(t *testing.T) {
	q := &queryCoordinator{partitions: map[string]*queryPartition{}, slots: make(chan struct{}, maxQueryConcurrency)}
	var generation atomic.Int32
	generation.Store(1)
	var calls atomic.Int32
	execute := func(ctx context.Context, _ []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error) {
		calls.Add(1)
		captured := generation.Load()
		err := registerObservationGuard(ctx, "identity", func(current context.Context) error {
			if err := current.Err(); err != nil {
				return err
			}
			if generation.Load() != captured {
				return context.Canceled
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		return &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{{ResourceToken: "identity", MetricID: "cpu", Status: sdk.MetricStatusMissing, ExpiresAt: time.Now().Add(time.Second)}}}, nil
	}
	resources := []sdk.MetricResource{{Token: "identity"}}
	first, cancel := context.WithCancel(context.Background())
	_, err := q.query(first, "partition", resources, execute, func() bool { return true })
	require.NoError(t, err)
	cancel()
	// Work/caller cancellation must not poison a valid cache guard.
	_, err = q.query(context.Background(), "partition", resources, execute, func() bool { return true })
	require.NoError(t, err)
	require.Equal(t, int32(1), calls.Load())
	generation.Store(2)
	_, err = q.query(context.Background(), "partition", resources, execute, func() bool { return true })
	require.Error(t, err)
	require.Equal(t, int32(1), calls.Load(), "generation change must not publish cached values")
	_, err = q.query(context.Background(), "partition", resources, execute, func() bool { return true })
	require.NoError(t, err)
	require.Equal(t, int32(2), calls.Load(), "guard failure evicts the old resource cache")
}
