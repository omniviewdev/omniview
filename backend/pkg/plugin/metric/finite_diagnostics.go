package metric

import (
	"context"
	"github.com/omniviewdev/omniview/internal/telemetry"
)

// diagnosticsState samples authoritative state rather than maintaining a second
// set of counters across the coordinator's many cancellation and failure paths.
func (f *finiteCoordinator) diagnosticsState() telemetry.PipelineState {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := telemetry.PipelineState{
		Inflight: int64(len(f.jobs)), CatalogInflight: int64(f.activeCatalogs), CatalogWaiters: int64(f.catalogWaiters),
		CacheEntries: int64(len(f.cache)), Observations: int64(len(f.observations)), SnapshotBytes: int64(f.snapshotBytes),
	}
	for _, entry := range f.cache {
		s.CacheBytes += int64(entry.bytes)
	}
	for w := range f.pending {
		if w.finished || w.ctx.Err() != nil {
			continue
		}
		for pair := range w.pairs {
			if f.uncoveredLocked(w, pair) {
				s.Queued++
				break
			}
		}
	}
	return s
}

// retireLocked records a cancellation request once. Keep the job in f.jobs:
// cancellation does not prove the provider has returned or released its slot.
func (j *finiteJob) retireLocked() {
	if j.retired {
		return
	}
	j.retired = true
	telemetry.RecordPipelineEvent(context.Background(), "cancel_provider", 1)
	j.cancel()
}

// Stop sampling only once all canceled provider work has actually returned.
// Never hold f.mu while unregistering: collection takes registry then f.mu.
func (f *finiteCoordinator) releaseDiagnosticsIfStopped() {
	f.mu.Lock()
	var unregister func()
	if f.stopped && len(f.jobs) == 0 && f.activeCatalogs == 0 {
		unregister = f.unregisterDiagnostics
		f.unregisterDiagnostics = nil
	}
	f.mu.Unlock()
	if unregister != nil {
		unregister()
	}
}
