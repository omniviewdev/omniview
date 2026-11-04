package metric

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

const queryCoalesceWindow = 12 * time.Millisecond
const maxQueryPartitions = 128
const maxQueryFlights = 128
const maxQueryConcurrency = 4
const maxQueryCacheBytes = 32 << 20
const maxPartitionCacheBytes = 2 << 20

type resourceCache struct {
	results  []sdk.ResourceMetricResult
	expires  time.Time
	warnings []string
	bytes    int
	guards   []observationGuard
}
type sharedQuery struct {
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	resources map[string]sdk.MetricResource
	refs      int
	started   bool
	response  *sdk.ResourceSetQueryResponse
	err       error
	epoch     uint64
	guards    observationGuards
}
type queryPartition struct {
	cache      map[string]resourceCache
	flights    []*sharedQuery
	touched    time.Time
	cacheBytes int
}

// queryCoordinator owns equivalent backend work, not authorization. Every caller
// admits before joining and re-admits after completion. All maps stay bounded.
type queryCoordinator struct {
	sync.Mutex
	epoch      uint64
	partitions map[string]*queryPartition
	slots      chan struct{}
	cacheBytes int
}

func (c *controller) queryWork() *queryCoordinator {
	c.mux.Lock()
	defer c.mux.Unlock()
	if c.coordinator == nil {
		c.coordinator = &queryCoordinator{partitions: map[string]*queryPartition{}, slots: make(chan struct{}, maxQueryConcurrency)}
	}
	return c.coordinator
}
func (q *queryCoordinator) currentEpoch() uint64 { q.Lock(); defer q.Unlock(); return q.epoch }
func (c *controller) invalidateResourceQueries() {
	q := c.queryWork()
	q.Lock()
	defer q.Unlock()
	q.epoch++
	for _, p := range q.partitions {
		for _, flight := range p.flights {
			flight.cancel()
		}
	}
	q.partitions = map[string]*queryPartition{}
	q.cacheBytes = 0
}
func (q *queryCoordinator) query(ctx context.Context, key string, resources []sdk.MetricResource, execute func(context.Context, []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error), valid func() bool) (*sdk.ResourceSetQueryResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	q.Lock()
	now := time.Now()
	p := q.partitions[key]
	if p == nil {
		if len(q.partitions) >= maxQueryPartitions {
			oldestKey := ""
			var oldest time.Time
			for k, item := range q.partitions {
				if len(item.flights) == 0 && (oldestKey == "" || item.touched.Before(oldest)) {
					oldestKey = k
					oldest = item.touched
				}
			}
			if oldestKey == "" {
				q.Unlock()
				return nil, errors.New("metric coordinator partition limit reached")
			}
			q.cacheBytes -= q.partitions[oldestKey].cacheBytes
			delete(q.partitions, oldestKey)
		}
		p = &queryPartition{cache: map[string]resourceCache{}}
		q.partitions[key] = p
	}
	p.touched = now
	cached := &sdk.ResourceSetQueryResponse{}
	allCached := true
	seenWarnings := map[string]bool{}
	cachedGuards := observationGuards{}
	for _, r := range resources {
		entry, ok := p.cache[r.Token]
		if !ok || !entry.expires.After(now) {
			allCached = false
			if ok {
				p.cacheBytes -= entry.bytes
				q.cacheBytes -= entry.bytes
			}
			delete(p.cache, r.Token)
			break
		}
		cached.Results = append(cached.Results, entry.results...)
		cachedGuards[r.Token] = entry.guards
		for _, warning := range entry.warnings {
			if !seenWarnings[warning] {
				seenWarnings[warning] = true
				cached.Warnings = append(cached.Warnings, warning)
			}
		}
	}
	if allCached {
		q.Unlock()
		if !valid() {
			return nil, profileChangingError()
		}
		for token, guards := range cachedGuards {
			if err := validateObservationGuards(ctx, guards); err != nil {
				q.evictResource(key, token)
				return nil, err
			}
		}
		return copyJSON(cached), nil
	}
	var flight *sharedQuery
	for _, f := range p.flights {
		if f.ctx.Err() != nil {
			continue
		}
		covered := true
		extra := 0
		for _, r := range resources {
			if _, ok := f.resources[r.Token]; !ok {
				covered = false
				extra++
			}
		}
		if covered || (!f.started && len(f.resources)+extra <= maxSetResources) {
			flight = f
			break
		}
	}
	fresh := false
	if flight == nil {
		flights := 0
		for _, part := range q.partitions {
			flights += len(part.flights)
		}
		if flights >= maxQueryFlights {
			q.Unlock()
			return nil, errors.New("metric coordinator in-flight limit reached")
		}
		work, cancel := context.WithTimeout(context.WithoutCancel(ctx), resourceMetricsTimeout)
		flight = &sharedQuery{ctx: work, cancel: cancel, done: make(chan struct{}), resources: map[string]sdk.MetricResource{}, epoch: q.epoch}
		p.flights = append(p.flights, flight)
		fresh = true
	}
	if !flight.started {
		for _, r := range resources {
			flight.resources[r.Token] = r
		}
	}
	flight.refs++
	q.Unlock()
	if fresh {
		go q.run(key, p, flight, execute, valid)
	}
	select {
	case <-ctx.Done():
		q.release(flight)
		return nil, ctx.Err()
	case <-flight.done:
		// Prioritize cancellation even when done and cancel become ready together.
		if err := ctx.Err(); err != nil {
			q.release(flight)
			return nil, err
		}
		q.release(flight)
		if flight.err != nil {
			return nil, flight.err
		}
		if !valid() {
			return nil, profileChangingError()
		}
		wanted := map[string]bool{}
		for _, r := range resources {
			wanted[r.Token] = true
		}
		for _, r := range resources {
			if err := validateObservationGuards(ctx, flight.guards[r.Token]); err != nil {
				q.evictResource(key, r.Token)
				return nil, err
			}
		}
		out := &sdk.ResourceSetQueryResponse{Warnings: append([]string(nil), flight.response.Warnings...)}
		for _, r := range flight.response.Results {
			if wanted[r.ResourceToken] {
				out.Results = append(out.Results, r)
			}
		}
		return copyJSON(out), nil
	}
}
func (q *queryCoordinator) release(f *sharedQuery) {
	q.Lock()
	defer q.Unlock()
	f.refs--
	if f.refs == 0 {
		f.cancel()
	}
}
func (q *queryCoordinator) run(key string, p *queryPartition, f *sharedQuery, execute func(context.Context, []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error), valid func() bool) {
	defer f.cancel()
	timer := time.NewTimer(queryCoalesceWindow)
	defer timer.Stop()
	select {
	case <-f.ctx.Done():
		q.finish(key, p, f, nil, f.ctx.Err(), valid)
		return
	case <-timer.C:
	}
	q.Lock()
	f.started = true
	resources := make([]sdk.MetricResource, 0, len(f.resources))
	for _, r := range f.resources {
		resources = append(resources, r)
	}
	q.Unlock()
	select {
	case q.slots <- struct{}{}:
	case <-f.ctx.Done():
		q.finish(key, p, f, nil, f.ctx.Err(), valid)
		return
	}
	f.guards = observationGuards{}
	work := context.WithValue(f.ctx, observationGuardKey{}, f.guards)
	response, err := execute(work, resources)
	<-q.slots
	if err == nil {
		for _, guards := range f.guards {
			if err = validateObservationGuards(work, guards); err != nil {
				break
			}
		}
	}
	if err == nil && response == nil {
		err = errors.New("metric execution returned no response")
	}
	if err == nil {
		err = f.ctx.Err()
	}
	q.finish(key, p, f, response, err, valid)
}
func (q *queryCoordinator) finish(key string, p *queryPartition, f *sharedQuery, response *sdk.ResourceSetQueryResponse, err error, valid func() bool) {
	isValid := valid()
	q.Lock()
	defer q.Unlock()
	if err == nil && (!isValid || f.epoch != q.epoch) {
		err = profileChangingError()
	}
	f.response = response
	f.err = err
	if current := q.partitions[key]; current == p {
		for i, item := range p.flights {
			if item == f {
				p.flights = append(p.flights[:i], p.flights[i+1:]...)
				break
			}
		}
		if err == nil && f.refs > 0 {
			now := time.Now()
			// Remove expired entries before enforcing the bounded per-partition cache.
			for token, entry := range p.cache {
				if !entry.expires.After(now) {
					p.cacheBytes -= entry.bytes
					q.cacheBytes -= entry.bytes
					delete(p.cache, token)
				}
			}
			grouped := map[string][]sdk.ResourceMetricResult{}
			for _, r := range response.Results {
				grouped[r.ResourceToken] = append(grouped[r.ResourceToken], r)
			}
			for token, results := range grouped {
				if _, exists := p.cache[token]; !exists && len(p.cache) >= maxSetResources {
					continue
				}
				expires := now.Add(5 * time.Second)
				for _, r := range results {
					if r.ExpiresAt.Before(expires) {
						expires = r.ExpiresAt
					}
				}
				raw, marshalErr := json.Marshal(results)
				if marshalErr != nil {
					continue
				}
				size := len(raw)
				for _, warning := range response.Warnings {
					size += len(warning)
				}
				previous := p.cache[token]
				if p.cacheBytes-previous.bytes+size > maxPartitionCacheBytes || q.cacheBytes-previous.bytes+size > maxQueryCacheBytes {
					continue
				}
				var cloned []sdk.ResourceMetricResult
				if json.Unmarshal(raw, &cloned) != nil {
					continue
				}
				p.cacheBytes += size - previous.bytes
				q.cacheBytes += size - previous.bytes
				p.cache[token] = resourceCache{results: cloned, expires: expires, warnings: response.Warnings, bytes: size, guards: f.guards[token]}
			}
		}
	}
	close(f.done)
}

func (q *queryCoordinator) evictResource(key, token string) {
	q.Lock()
	defer q.Unlock()
	p := q.partitions[key]
	if p == nil {
		return
	}
	if entry, ok := p.cache[token]; ok {
		p.cacheBytes -= entry.bytes
		q.cacheBytes -= entry.bytes
		delete(p.cache, token)
	}
}
