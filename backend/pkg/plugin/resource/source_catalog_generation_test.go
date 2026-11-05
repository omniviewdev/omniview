package resource

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestSourceCatalogAdmittedOncePerGeneration(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	var calls atomic.Int32
	var unavailable atomic.Bool
	original := provider.CatalogFunc
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		calls.Add(1)
		if unavailable.Load() {
			return resourcev2.Catalog{}, resourcev2.NewError("CONNECTION_ERROR", "catalog unavailable")
		}
		return original(ctx, request)
	}
	_, generation, ctx, cancel, _, _, err := ctrl.sources.prepare(testInvocationContext(), "p1", target.Target, "ifSupported")
	require.NoError(t, err)
	s := &sourceSession{coordinator: ctrl.sources, pluginID: "p1", target: target.Target, pluginGeneration: generation, opener: provider, ctx: ctx, cancel: cancel, mode: resourcev2.SourceModeSnapshotAndUpdates, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
	s.run()
	first := sourceNextOpen(t, provider)
	require.EqualValues(t, 2, calls.Load())
	unavailable.Store(true)
	sourceSend(first.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	for i := range 3 {
		record := sourceTestRecord(target.Target, fmt.Sprintf("pod-%d", i), "")
		sourceSend(first.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}}}}})
	}
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.status.State == "following" && len(s.members) == 3
	}, 5*time.Second, time.Millisecond)
	require.EqualValues(t, 2, calls.Load(), "frames must not re-fetch catalog")
	unavailable.Store(false)
	s.refresh()
	second := sourceNextOpen(t, provider)
	require.EqualValues(t, 3, calls.Load(), "refresh must re-admit the catalog")
	sourceSend(second.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.status.State == "following"
	}, 5*time.Second, time.Millisecond)
	require.EqualValues(t, 3, calls.Load())
	s.close()
}
