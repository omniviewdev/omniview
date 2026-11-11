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
	var calls atomic.Int32
	var unavailable atomic.Bool
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &scriptedSourceProvider{
		mockProvider: &mockProvider{
			CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				calls.Add(1)
				if unavailable.Load() {
					return resourcev2.Catalog{}, resourcev2.NewError("CONNECTION_ERROR", "catalog unavailable")
				}
				catalog := canonicalTestCatalog("p1", "native::Pod")
				catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
				return catalog, nil
			},
		},
		opens: make(chan scriptedSourceOpen, 16),
	}
	// Connection startup schedules independent catalog reads outside this session.
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	_, generation, ctx, cancel, _, _, err := ctrl.sources.prepare(testInvocationContext(), "p1", target.Target, "ifSupported")
	require.NoError(t, err)
	s := &sourceSession{coordinator: ctrl.sources, pluginID: "p1", target: target.Target, pluginGeneration: generation, opener: provider, ctx: ctx, cancel: cancel, mode: resourcev2.SourceModeSnapshotAndUpdates, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
	defer s.close()
	s.run()
	first := sourceNextOpen(t, provider)
	initialCalls := calls.Load()
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
	require.Equal(t, initialCalls, calls.Load(), "frames must not re-fetch catalog")
	unavailable.Store(false)
	s.refresh()
	second := sourceNextOpen(t, provider)
	require.Equal(t, initialCalls+1, calls.Load(), "refresh must re-admit the catalog")
	sourceSend(second.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.status.State == "following"
	}, 5*time.Second, time.Millisecond)
	require.Equal(t, initialCalls+1, calls.Load())
}
