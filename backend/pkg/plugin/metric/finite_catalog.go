package metric

import (
	"context"
	"encoding/json"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type finiteCatalogRead struct {
	key                 metricStreamKey
	sourceKey           metricStreamKey
	epoch               uint64
	sourceEpoch         uint64
	configuration       uint64
	configurationKeys   []finiteConfigurationKey
	configurationSerial uint64
	callers             int
	done                chan struct{}
	cancel              context.CancelFunc
	result              *sdk.ResourceMetricsCatalog
	err                 error
	until               time.Time
	finished            bool
	started             bool
	queued              time.Time
	ctx                 context.Context
	request             ResourceMetricsCatalogRequest
	lane                finiteSourceLane
}

func (c *controller) finiteCatalog(ctx context.Context, request ResourceMetricsCatalogRequest, lane finiteSourceLane, serial uint64) (*sdk.ResourceMetricsCatalog, error) {
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return nil, err
	}
	key := metricDigest([]any{owner.Principal().Owner(), owner.Principal().Generation(), request.OwnerPluginID, request.OwnerConnectionID, request.ResourceKey, lane.source, lane.context, lane.configurationKeys})
	ownerKey := metricStreamKey{request.OwnerPluginID, request.OwnerConnectionID}
	sourceKey := metricStreamKey{lane.source.PluginID, lane.source.ConnectionID}
	f := c.finiteCoordinator()
	f.mu.Lock()
	if f.stopped || f.configurationChanges > 0 || f.blocked[ownerKey] > 0 || f.blocked[sourceKey] > 0 || !f.configurationCurrentLocked(lane.configurationKeys, serial) {
		f.mu.Unlock()
		return nil, profileChangingError()
	}
	if f.catalogWaiters >= finiteMaxInterests {
		f.mu.Unlock()
		return nil, finiteError("RESOURCE_LIMIT", "Metric catalog reader limit exceeded.")
	}
	if f.catalogs == nil {
		f.catalogs = map[string]*finiteCatalogRead{}
	}
	now := time.Now()
	for id, read := range f.catalogs {
		if read.finished && !now.Before(read.until) {
			delete(f.catalogs, id)
		}
	}
	read := f.catalogs[key]
	if read == nil {
		if len(f.catalogs) >= 64 {
			f.mu.Unlock()
			return nil, finiteError("RESOURCE_LIMIT", "Metric catalog queue and cache limit exceeded.")
		}
		for _, laneKey := range []metricStreamKey{ownerKey, sourceKey} {
			if _, exists := f.epochs[laneKey]; !exists && len(f.epochs) >= 4096 {
				f.mu.Unlock()
				return nil, finiteError("RESOURCE_LIMIT", "Metric connection generation limit exceeded.")
			}
			f.epochs[laneKey] = f.epochs[laneKey]
		}
		work, cancel := context.WithTimeout(context.WithoutCancel(ctx), resourceMetricsTimeout)
		read = &finiteCatalogRead{key: ownerKey, sourceKey: sourceKey, epoch: f.epochs[ownerKey], sourceEpoch: f.epochs[sourceKey], configuration: f.configuration, done: make(chan struct{}), cancel: cancel}
		read.configurationKeys = lane.configurationKeys
		read.configurationSerial = serial
		read.ctx, read.request, read.lane, read.queued = work, request, lane, now
		f.catalogs[key] = read
		f.signal()
	}
	read.callers++
	f.catalogWaiters++
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.catalogWaiters--
		read.callers--
		if read.callers == 0 && !read.finished {
			read.cancel()
			if !read.started {
				f.finishCatalogLocked(key, read, nil, context.Canceled)
			}
			if f.catalogs[key] == read {
				delete(f.catalogs, key)
			}
			f.signal()
		}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-read.done:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		f.mu.Lock()
		current := !f.stopped && f.configuration == read.configuration && f.configurationChanges == 0 && f.blocked[ownerKey] == 0 && f.blocked[sourceKey] == 0 && f.epochs[ownerKey] == read.epoch && f.epochs[sourceKey] == read.sourceEpoch && f.configurationCurrentLocked(read.configurationKeys, read.configurationSerial)
		f.mu.Unlock()
		if !current {
			return nil, profileChangingError()
		}
		return read.result, read.err
	}
}

// A canceled running catalog still owns its slot until the provider returns.
func (f *finiteCoordinator) runCatalog(id string, read *finiteCatalogRead) {
	defer read.cancel()
	defer f.releaseDiagnosticsIfStopped()
	var result *sdk.ResourceMetricsCatalog
	failure := read.ctx.Err()
	if failure == nil {
		result, failure = f.c.finiteCatalogUncached(read.ctx, read.request, read.lane)
	}
	f.mu.Lock()
	f.activeCatalogs--
	if f.stopped || f.configuration != read.configuration || f.configurationChanges > 0 || f.epochs[read.key] != read.epoch || f.epochs[read.sourceKey] != read.sourceEpoch || f.blocked[read.key] > 0 || f.blocked[read.sourceKey] > 0 || !f.configurationCurrentLocked(read.configurationKeys, read.configurationSerial) {
		result, failure = nil, profileChangingError()
	}
	if read.callers == 0 || read.ctx.Err() != nil {
		result, failure = nil, read.ctx.Err()
	}
	f.finishCatalogLocked(id, read, result, failure)
	f.mu.Unlock()
	f.signal()
}

func (f *finiteCoordinator) finishCatalogLocked(id string, read *finiteCatalogRead, result *sdk.ResourceMetricsCatalog, failure error) {
	if read.finished {
		return
	}
	read.result, read.err, read.finished = result, failure, true
	read.until = time.Now().Add(30 * time.Second)
	if (failure != nil || read.callers == 0) && f.catalogs[id] == read {
		delete(f.catalogs, id)
	}
	close(read.done)
}

func (f *finiteCoordinator) cancelCatalogLocked(id string, read *finiteCatalogRead) {
	read.cancel()
	if !read.started {
		f.finishCatalogLocked(id, read, nil, profileChangingError())
	}
	delete(f.catalogs, id)
}

func mergeFiniteCatalogs(catalogs []*sdk.ResourceMetricsCatalog) (*sdk.ResourceMetricsCatalog, error) {
	if len(catalogs) == 0 {
		return nil, finiteError("UNSUPPORTED", "No selected metric source.")
	}
	merged := cloneFiniteCatalog(catalogs[0])
	merged.Metrics = nil
	byID := map[string]bool{}
	for _, catalog := range catalogs {
		if catalog.MaxTargets < merged.MaxTargets {
			merged.MaxTargets = catalog.MaxTargets
		}
		if catalog.MaxSampleAge == 0 || (merged.MaxSampleAge > 0 && catalog.MaxSampleAge > merged.MaxSampleAge) {
			merged.MaxSampleAge = catalog.MaxSampleAge
		}
		for _, descriptor := range catalog.Metrics {
			if byID[descriptor.ID] {
				return nil, finiteError("INVALID_REQUEST", "Selected source lanes returned duplicate metric IDs.")
			}
			byID[descriptor.ID] = true
			source := catalog.Source
			descriptor.Source = &source
			merged.Metrics = append(merged.Metrics, descriptor)
		}
	}
	if err := sdk.ValidateResourceMetricsCatalog(merged); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(merged)
	if err != nil || len(encoded) > 64<<10 {
		return nil, finiteError("RESOURCE_LIMIT", "Merged metric catalog byte limit exceeded.")
	}
	return merged, nil
}
