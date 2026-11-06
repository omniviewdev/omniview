package metric

import (
	"context"
	"encoding/json"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type finiteCatalogRead struct {
	key      metricStreamKey
	epoch    uint64
	callers  int
	done     chan struct{}
	cancel   context.CancelFunc
	result   *sdk.ResourceMetricsCatalog
	err      error
	until    time.Time
	finished bool
}

func (c *controller) finiteCatalog(ctx context.Context, plugin, connection, resourceKey string) (*sdk.ResourceMetricsCatalog, error) {
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return nil, err
	}
	identity, _ := json.Marshal([]string{owner.Principal().Owner(), owner.Principal().Generation(), plugin, connection, resourceKey})
	key := string(identity)
	lane := metricStreamKey{plugin, connection}
	f := c.finiteCoordinator()
	f.mu.Lock()
	if f.stopped || f.blocked[lane] > 0 {
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
		if len(f.catalogs) >= 64 || f.activeCatalogs+len(f.jobs) >= finiteMaxJobs {
			f.mu.Unlock()
			return nil, finiteError("RESOURCE_LIMIT", "Metric catalog collection limit exceeded.")
		}
		if _, exists := f.epochs[lane]; !exists && len(f.epochs) >= 4096 {
			f.mu.Unlock()
			return nil, finiteError("RESOURCE_LIMIT", "Metric connection generation limit exceeded.")
		}
		work, cancel := context.WithTimeout(context.WithoutCancel(ctx), resourceMetricsTimeout)
		read = &finiteCatalogRead{key: lane, epoch: f.epochs[lane], done: make(chan struct{}), cancel: cancel}
		f.epochs[lane] = read.epoch
		f.catalogs[key] = read
		f.activeCatalogs++
		go func() {
			defer cancel()
			result, failure := c.finiteCatalogUncached(work, plugin, connection, resourceKey)
			f.mu.Lock()
			defer f.mu.Unlock()
			f.activeCatalogs--
			if f.stopped || f.epochs[lane] != read.epoch || f.blocked[lane] > 0 {
				result = nil
				failure = profileChangingError()
			}
			read.result, read.err, read.finished = result, failure, true
			read.until = time.Now().Add(30 * time.Second)
			if failure != nil && f.catalogs[key] == read {
				delete(f.catalogs, key)
			}
			f.signal()
			close(read.done)
		}()
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
			if f.catalogs[key] == read {
				delete(f.catalogs, key)
			}
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
		current := !f.stopped && f.blocked[lane] == 0 && f.epochs[lane] == read.epoch
		f.mu.Unlock()
		if !current {
			return nil, profileChangingError()
		}
		return read.result, read.err
	}
}
