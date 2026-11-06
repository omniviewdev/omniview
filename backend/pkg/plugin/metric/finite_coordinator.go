package metric

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

const finiteMaxInterests = 512
const finiteMaxJobs = 4
const finiteCacheTTL = 2 * time.Second
const finitePendingTTL = 30 * time.Second
const finiteMaxBytes = 4 << 20

type finitePair struct{ target, metric string }
type finiteReply struct {
	data *sdk.ResourceMetricsResponse
	err  error
}
type finiteWaiter struct {
	ctx         context.Context
	query       sdk.ResourceMetricsQuery
	spec        MetricsObservationSpec
	partition   string
	pairs       map[finitePair]bool
	results     map[finitePair]sdk.ResourceMetricResult
	missing     int
	complete    bool
	warnings    []string
	reply       chan finiteReply
	queued      time.Time
	maxTargets  int
	done        map[finitePair]bool
	epoch       uint64
	cachedPairs map[finitePair]bool
	finished    bool
}
type finiteJob struct {
	partition string
	query     sdk.ResourceMetricsQuery
	pairs     map[finitePair]bool
	waiters   map[*finiteWaiter]bool
	cancel    context.CancelFunc
	epoch     uint64
	key       metricStreamKey
	retired   bool
}
type finiteCacheEntry struct {
	partition string
	pairs     map[finitePair]sdk.ResourceMetricResult
	complete  bool
	warnings  []string
	until     time.Time
	key       metricStreamKey
	epoch     uint64
	bytes     int
}

func mergeFiniteWarnings(current, incoming []string) []string {
	for _, warning := range incoming {
		if !slices.Contains(current, warning) {
			current = append(current, warning)
		}
	}
	return current
}

type finiteCoordinator struct {
	c              *controller
	mu             sync.Mutex
	pending        map[*finiteWaiter]bool
	jobs           map[*finiteJob]bool
	cache          []finiteCacheEntry
	catalogs       map[string]*finiteCatalogRead
	activeCatalogs int
	catalogWaiters int
	epochs         map[metricStreamKey]uint64
	blocked        map[metricStreamKey]int
	observations   map[string]*finiteObservation
	snapshotBytes  int
	tombstones     map[string]time.Time
	generation     uint64
	stopped        bool
	wake           chan struct{}
}

func (c *controller) finiteCoordinator() *finiteCoordinator {
	c.finiteOnce.Do(func() {
		f := &finiteCoordinator{c: c, pending: map[*finiteWaiter]bool{}, jobs: map[*finiteJob]bool{}, epochs: map[metricStreamKey]uint64{}, blocked: map[metricStreamKey]int{}, observations: map[string]*finiteObservation{}, tombstones: map[string]time.Time{}, wake: make(chan struct{}, 1)}
		c.mux.RLock()
		for key, count := range c.streamBlocked {
			f.blocked[key] = count
		}
		c.finite.Store(f)
		c.mux.RUnlock()
		go f.loop()
	})
	return c.finite.Load()
}
func (f *finiteCoordinator) signal() {
	select {
	case f.wake <- struct{}{}:
	default:
	}
}
func finiteError(code, message string) error { return resourcev2.NewError(code, message) }
func finiteTargetKey(t sdk.ResourceMetricTarget) string {
	// The canonical reference includes incarnation. Observer tokens never key work.
	reference := t.Reference
	reference.Address.Scope = append([]resourcev2.ScopeEntry(nil), reference.Address.Scope...)
	sort.Slice(reference.Address.Scope, func(i, j int) bool {
		return reference.Address.Scope[i].Dimension < reference.Address.Scope[j].Dimension
	})
	b, _ := json.Marshal(struct {
		Reference resourcev2.ResourceReference
		Route     resourcev2.AccessRoute
	}{reference, t.Route})
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func finitePairs(q sdk.ResourceMetricsQuery) map[finitePair]bool {
	p := make(map[finitePair]bool, len(q.Targets)*len(q.MetricIDs))
	for _, t := range q.Targets {
		for _, m := range q.MetricIDs {
			p[finitePair{t.Token, m}] = true
		}
	}
	return p
}
func finiteIdentity(ctx context.Context) (invocation.Request, error) {
	if req, ok := invocation.FromContext(ctx); ok && req.OwnedBy(ctx) {
		return req, nil
	}
	admitted, err := invocation.NewBoundary(nil).Admit(ctx, "metric.Observe", invocation.Target{})
	if err != nil {
		return invocation.Request{}, err
	}
	req, _ := invocation.FromContext(admitted)
	return req, nil
}
func (c *controller) finiteProvider(plugin string) (sdk.FiniteQueryProvider, error) {
	c.mux.RLock()
	p := c.clients[plugin]
	c.mux.RUnlock()
	if p == nil {
		return nil, finiteError("UNAVAILABLE", "Metric provider is unavailable.")
	}
	provider, ok := p.(sdk.FiniteQueryProvider)
	if !ok {
		return nil, finiteError("UNSUPPORTED", "Finite resource metrics are unavailable.")
	}
	return provider, nil
}
func (c *controller) finiteCatalogUncached(ctx context.Context, plugin, connection, key string) (*sdk.ResourceMetricsCatalog, error) {
	if plugin == "" || connection == "" || key == "" {
		return nil, finiteError("INVALID_REQUEST", "Owner connection and resource key are required.")
	}
	f := c.finiteCoordinator()
	lane := metricStreamKey{plugin, connection}
	f.mu.Lock()
	blocked, epoch := f.blocked[lane] > 0, f.epochs[lane]
	f.mu.Unlock()
	if blocked {
		return nil, profileChangingError()
	}
	p, err := c.finiteProvider(plugin)
	if err != nil {
		return nil, err
	}
	pc := c.getConnectedCtx(ctx, plugin, connection)
	if pc == nil {
		return nil, finiteError("INVALID_CONTEXT", "Owner connection is unavailable.")
	}
	catalog, err := p.GetResourceMetricsCatalog(pc, key)
	if err != nil {
		return nil, err
	}
	if err = sdk.ValidateResourceMetricsCatalog(catalog); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(catalog)
	if err != nil || len(encoded) > 64<<10 {
		return nil, finiteError("RESOURCE_LIMIT", "Metric catalog byte limit exceeded.")
	}
	expected := sdk.MetricSourceRef{PluginID: plugin, ConnectionID: connection, DatasourceKind: "metrics-server"}
	if catalog.Source != expected {
		return nil, finiteError("UNSUPPORTED", "Only the selected owner's native metrics-server source is supported.")
	}
	for _, d := range catalog.Metrics {
		if d.ResourceKey != key {
			return nil, finiteError("INVALID_REQUEST", "Catalog resource key does not match the owner.")
		}
	}
	f.mu.Lock()
	current := !f.stopped && f.blocked[lane] == 0 && f.epochs[lane] == epoch
	f.mu.Unlock()
	if !current {
		return nil, profileChangingError()
	}
	return catalog, nil
}

// GetResourceMetricsCatalog resolves the admitted active owner's native source.
// The returned descriptors, not display labels or caller source hints, define
// units/shapes. Unsupported old providers fail explicitly without legacy loops.
func (c *controller) GetResourceMetricsCatalog(ctx context.Context, plugin, connection, key string) (*sdk.ResourceMetricsCatalog, error) {
	request, err := finiteIdentity(ctx)
	if err != nil {
		return nil, err
	}
	if request.Principal().Origin() == invocation.ExternalAgent && (request.Operation() != "metric.Query" || request.Target().Provider != plugin || request.Target().Connection != connection || request.Target().ResourceType != key) {
		return nil, finiteError("DENIED", "Catalog reads require matching admitted owner authority.")
	}
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	catalog, err := c.finiteCatalog(ctx, plugin, connection, key)
	if err != nil {
		return nil, err
	}
	return cloneFiniteCatalog(catalog), nil
}

func (c *controller) admitFinite(ctx context.Context, spec MetricsObservationSpec) (context.Context, sdk.ResourceMetricsQuery, error) {
	q := sdk.ResourceMetricsQuery{Source: sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, DatasourceKind: "metrics-server"}, Targets: spec.Targets, MetricIDs: spec.MetricIDs, Shape: spec.Shape, StartTime: spec.StartTime, EndTime: spec.EndTime, Step: time.Duration(spec.StepMs) * time.Millisecond}
	if spec.StepMs < 0 || spec.StepMs > int(sdk.MaxFiniteRange/time.Millisecond) || spec.IntervalMs < 0 || spec.IntervalMs > 3600000 || (spec.IntervalMs > 0 && spec.IntervalMs < 1000) {
		return ctx, q, finiteError("INVALID_REQUEST", "Metric step or polling interval is outside bounds.")
	}
	if err := sdk.ValidateResourceMetricsQuery(q); err != nil {
		return ctx, q, err
	}
	if c.referenceAdmitter == nil {
		return ctx, q, finiteError("UNSUPPORTED", "Reference admission is unavailable.")
	}
	first := ctx
	identities := map[string]bool{}
	for i, t := range q.Targets {
		if t.Route.Connection != spec.OwnerConnectionID || t.Reference.Address.Type != spec.ResourceKey || t.Reference.Address.Provider != spec.OwnerPluginID {
			return ctx, q, finiteError("INVALID_REQUEST", "Target route or resource key does not match its owner.")
		}
		identity := finiteTargetKey(t)
		if identities[identity] {
			return ctx, q, finiteError("INVALID_REQUEST", "Duplicate canonical metric target.")
		}
		identities[identity] = true
		admitted, err := c.referenceAdmitter(ctx, "metric.Query", spec.OwnerPluginID, t.Route, t.Reference)
		if err != nil {
			return ctx, q, err
		}
		if i == 0 {
			first = admitted
		}
	}
	return first, q, nil
}

// ReadFiniteResourceMetrics performs one cancellable finite read through the
// same coordinator used by UI observations. The caller must carry host-issued
// invocation identity. Cancellation detaches only this reader; shared provider
// work stops when its final interested reader retires. Each delivery re-admits
// all requested references, including cache hits. No background UI work starts.
// Collection has a 30-second deadline, four shared I/O slots, at most 512
// interests and 32768 requested pairs. A response is at most 4 MiB/10000 points.
// Completed sample cache is bounded to 64 entries/8 MiB and expires after two
// seconds; native catalog cache is 64 entries of at most 64 KiB for 30 seconds.
// Overflow returns RESOURCE_LIMIT, never silent truncation or a legacy fallback.
func (c *controller) ReadFiniteResourceMetrics(ctx context.Context, spec MetricsObservationSpec) (*sdk.ResourceMetricsResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	return c.readFinite(ctx, spec, false)
}
func (c *controller) readFinite(ctx context.Context, spec MetricsObservationSpec, refresh bool) (*sdk.ResourceMetricsResponse, error) {
	return c.readFiniteCatalog(ctx, spec, refresh, nil, nil)
}
func (c *controller) readFiniteCatalog(ctx context.Context, spec MetricsObservationSpec, refresh bool, capture func(*sdk.ResourceMetricsCatalog), observation *finiteObservation) (*sdk.ResourceMetricsResponse, error) {
	admitted, q, err := c.admitFinite(ctx, spec)
	if err != nil {
		return nil, err
	}
	catalog, err := c.finiteCatalog(admitted, spec.OwnerPluginID, spec.OwnerConnectionID, spec.ResourceKey)
	if err != nil {
		return nil, err
	}
	if err = validateFiniteSelection(q, catalog); err != nil {
		return nil, err
	}
	if capture != nil {
		capture(catalog)
	}
	request, ok := invocation.FromContext(admitted)
	if !ok {
		return nil, finiteError("DENIED", "Admitted metric identity is required.")
	}
	// A partition isolates authority, connection generations and evaluation domain.
	partitionBytes, _ := json.Marshal([]any{request.Principal().Owner(), request.Principal().Generation(), q.Source, spec.ResourceKey, q.Shape, q.StartTime, q.EndTime, q.Step, catalog})
	partition := string(partitionBytes)
	canonical := q
	canonical.Targets = make([]sdk.ResourceMetricTarget, len(q.Targets))
	copy(canonical.Targets, q.Targets)
	for i := range canonical.Targets {
		canonical.Targets[i].Token = finiteTargetKey(canonical.Targets[i])
	}
	w := &finiteWaiter{ctx: admitted, query: canonical, spec: spec, partition: partition, pairs: finitePairs(canonical), done: map[finitePair]bool{}, results: map[finitePair]sdk.ResourceMetricResult{}, complete: true, reply: make(chan finiteReply, 1), queued: time.Now(), maxTargets: catalog.MaxTargets}
	w.missing = len(w.pairs)
	f := c.finiteCoordinator()
	key := metricStreamKey{spec.OwnerPluginID, spec.OwnerConnectionID}
	f.mu.Lock()
	if f.stopped || f.blocked[key] > 0 {
		f.mu.Unlock()
		return nil, profileChangingError()
	}
	interests, pairs := f.interestBoundsLocked()
	if interests >= finiteMaxInterests || pairs+len(w.pairs) > 32768 {
		f.mu.Unlock()
		return nil, finiteError("RESOURCE_LIMIT", "Metric coordinator interest or pair limit exceeded.")
	}
	if observation != nil {
		observation.waiter = w
		if observation.refresh {
			refresh = true
			observation.refresh = false
		}
	}
	w.epoch = f.epochs[key]
	f.epochs[key] = w.epoch
	if !refresh {
		now := time.Now()
		for index := len(f.cache) - 1; index >= 0; index-- {
			entry := f.cache[index]
			if entry.partition != partition || entry.epoch != f.epochs[key] || !now.Before(entry.until) {
				continue
			}
			for pair := range w.pairs {
				if !w.done[pair] {
					if r, ok := entry.pairs[pair]; ok {
						if w.cachedPairs == nil {
							w.cachedPairs = map[finitePair]bool{}
						}
						w.cachedPairs[pair] = true
						w.results[pair] = r
						w.done[pair] = true
						w.missing--
						w.complete = w.complete && entry.complete
						w.warnings = mergeFiniteWarnings(w.warnings, entry.warnings)
					}
				}
			}
		}
	}
	if w.missing > 0 {
		for job := range f.jobs {
			if job.retired || job.partition != partition || job.epoch != f.epochs[key] {
				continue
			}
			for pair := range w.pairs {
				if !w.done[pair] && job.pairs[pair] {
					job.waiters[w] = true
				}
			}
		}
		f.pending[w] = true
	}
	ready := w.missing == 0
	if ready {
		f.finishWaiter(w, nil)
	}
	f.mu.Unlock()
	f.signal()
	select {
	case result := <-w.reply:
		if result.err != nil {
			return nil, result.err
		}
		if _, _, err = c.admitFinite(ctx, spec); err != nil {
			return nil, err
		}
		f.mu.Lock()
		current := !f.stopped && f.blocked[key] == 0 && f.epochs[key] == w.epoch
		f.mu.Unlock()
		if !current {
			return nil, profileChangingError()
		}
		// Projection never exposes another subscriber's target tokens or pairs.
		tokens := map[string]string{}
		for _, t := range q.Targets {
			tokens[finiteTargetKey(t)] = t.Token
		}
		for i := range result.data.Results {
			result.data.Results[i] = cloneFiniteResult(result.data.Results[i])
			result.data.Results[i].ResourceToken = tokens[result.data.Results[i].ResourceToken]
		}
		if encoded, encodeErr := json.Marshal(result.data); encodeErr != nil || len(encoded) > finiteMaxBytes {
			return nil, finiteError("RESOURCE_LIMIT", "Projected metric response byte limit exceeded.")
		}
		return result.data, nil
	case <-ctx.Done():
		f.detach(w)
		return nil, ctx.Err()
	}
}
func (f *finiteCoordinator) interestBoundsLocked() (int, int) {
	seen := map[*finiteWaiter]bool{}
	for w := range f.pending {
		seen[w] = true
	}
	for j := range f.jobs {
		for w := range j.waiters {
			seen[w] = true
		}
	}
	pairs := 0
	for w := range seen {
		pairs += len(w.pairs)
	}
	return len(seen), pairs
}
func (f *finiteCoordinator) waiterCountLocked() int {
	count, _ := f.interestBoundsLocked()
	return count
}
func (f *finiteCoordinator) detach(w *finiteWaiter) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.pending, w)
	w.finished = true
	for j := range f.jobs {
		delete(j.waiters, w)
		if len(j.waiters) == 0 {
			j.retired = true
			j.cancel()
		}
	}
}
func (f *finiteCoordinator) finishWaiter(w *finiteWaiter, err error) {
	if w.finished {
		return
	}
	w.finished = true
	if err != nil {
		select {
		case w.reply <- finiteReply{err: err}:
		default:
		}
		return
	}
	response := &sdk.ResourceMetricsResponse{Results: make([]sdk.ResourceMetricResult, 0, len(w.results)), Complete: w.complete, Warnings: w.warnings}
	for _, t := range w.query.Targets {
		for _, m := range w.query.MetricIDs {
			if r, ok := w.results[finitePair{t.Token, m}]; ok {
				response.Results = append(response.Results, r)
			} else {
				response.Complete = false
			}
		}
	}
	reply := finiteReply{data: response}
	if validationErr := sdk.ValidateResourceMetricsResponse(w.query, response); validationErr != nil {
		reply = finiteReply{err: validationErr}
	} else if encoded, encodeErr := json.Marshal(response); encodeErr != nil || len(encoded) > finiteMaxBytes {
		reply = finiteReply{err: finiteError("RESOURCE_LIMIT", "Assembled metric response byte limit exceeded.")}
	}
	select {
	case w.reply <- reply:
	default:
	}
}
func (f *finiteCoordinator) loop() {
	timer := time.NewTimer(time.Hour)
	timer.Stop()
	defer timer.Stop()
	for {
		f.mu.Lock()
		if f.stopped {
			f.mu.Unlock()
			return
		}
		f.expireLocked(time.Now())
		f.dispatchLocked()
		f.mu.Unlock()
		f.pollObservations()
		f.mu.Lock()
		deadline := f.nextDeadlineLocked(time.Now())
		f.mu.Unlock()
		if deadline.IsZero() {
			<-f.wake
			continue
		}
		delay := time.Until(deadline)
		if delay < 0 {
			delay = 0
		}
		timer.Reset(delay)
		select {
		case <-timer.C:
		case <-f.wake:
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}
}
func (f *finiteCoordinator) nextDeadlineLocked(now time.Time) time.Time {
	var next time.Time
	earlier := func(candidate time.Time) {
		if !candidate.IsZero() && (next.IsZero() || candidate.Before(next)) {
			next = candidate
		}
	}
	for w := range f.pending {
		ready := w.queued.Add(8 * time.Millisecond)
		if ready.After(now) {
			earlier(ready)
			continue
		}
		if len(f.jobs)+f.activeCatalogs >= finiteMaxJobs {
			continue
		}
		for pair := range w.pairs {
			if w.done[pair] {
				continue
			}
			covered := false
			for job := range f.jobs {
				if !job.retired && job.partition == w.partition && job.pairs[pair] {
					covered = true
					break
				}
			}
			if !covered {
				earlier(now)
				break
			}
		}
	}
	for _, o := range f.observations {
		if !o.attached {
			earlier(o.expires)
		} else if !o.running {
			earlier(o.due)
			if o.refresh {
				earlier(now)
			}
		}
	}
	for _, entry := range f.cache {
		earlier(entry.until)
	}
	for _, until := range f.tombstones {
		earlier(until)
	}
	for _, read := range f.catalogs {
		if read.finished {
			earlier(read.until)
		}
	}
	return next
}
func (f *finiteCoordinator) expireLocked(now time.Time) {
	kept := f.cache[:0]
	for _, entry := range f.cache {
		if now.Before(entry.until) {
			kept = append(kept, entry)
		}
	}
	clear(f.cache[len(kept):])
	f.cache = kept
	for key, until := range f.tombstones {
		if !now.Before(until) {
			delete(f.tombstones, key)
		}
	}
	for key, read := range f.catalogs {
		if read.finished && !now.Before(read.until) {
			delete(f.catalogs, key)
		}
	}
	for w := range f.pending {
		if w.ctx.Err() != nil {
			delete(f.pending, w)
		}
	}
}
func (f *finiteCoordinator) dispatchLocked() {
	if len(f.jobs)+f.activeCatalogs >= finiteMaxJobs {
		return
	}
	// Build the exact pair union, then group targets by identical metric sets.
	// This avoids the accidental Cartesian product of independently requested pairs.
	partitions := map[string]map[string]map[string]bool{}
	targets := map[string]sdk.ResourceMetricTarget{}
	bases := map[string]*finiteWaiter{}
	for w := range f.pending {
		if time.Since(w.queued) < 8*time.Millisecond {
			continue
		}
		bases[w.partition] = w
		if partitions[w.partition] == nil {
			partitions[w.partition] = map[string]map[string]bool{}
		}
		for _, t := range w.query.Targets {
			targets[t.Token] = t
		}
		for pair := range w.pairs {
			if w.done[pair] {
				continue
			}
			covered := false
			for j := range f.jobs {
				if !j.retired && j.partition == w.partition && j.pairs[pair] {
					j.waiters[w] = true
					covered = true
					break
				}
			}
			if covered {
				continue
			}
			byTarget := partitions[w.partition]
			if byTarget[pair.target] == nil {
				byTarget[pair.target] = map[string]bool{}
			}
			byTarget[pair.target][pair.metric] = true
		}
	}
	for partition, byTarget := range partitions {
		groups := map[string][]string{}
		metrics := map[string][]string{}
		for target, ids := range byTarget {
			list := make([]string, 0, len(ids))
			for id := range ids {
				list = append(list, id)
			}
			sort.Strings(list)
			encoded, _ := json.Marshal(list)
			group := string(encoded)
			groups[group] = append(groups[group], target)
			metrics[group] = list
		}
		for group, list := range groups {
			sort.Strings(list)
			for len(list) > 0 && len(f.jobs)+f.activeCatalogs < finiteMaxJobs {
				base := bases[partition]
				count := len(list)
				if count > base.maxTargets {
					count = base.maxTargets
				}
				q := base.query
				q.Targets = make([]sdk.ResourceMetricTarget, 0, count)
				q.MetricIDs = metrics[group]
				for _, id := range list[:count] {
					q.Targets = append(q.Targets, targets[id])
				}
				list = list[count:]
				key := metricStreamKey{base.spec.OwnerPluginID, base.spec.OwnerConnectionID}
				workCtx, cancel := context.WithTimeout(context.WithoutCancel(base.ctx), resourceMetricsTimeout)
				job := &finiteJob{partition: partition, query: q, pairs: finitePairs(q), waiters: map[*finiteWaiter]bool{}, cancel: cancel, key: key, epoch: f.epochs[key]}
				for w := range f.pending {
					if w.partition == partition {
						for pair := range job.pairs {
							if w.pairs[pair] {
								job.waiters[w] = true
								break
							}
						}
					}
				}
				f.jobs[job] = true
				go f.runJob(workCtx, job, base.spec)
			}
		}
	}
}
func (f *finiteCoordinator) runJob(ctx context.Context, job *finiteJob, base MetricsObservationSpec) {
	defer job.cancel()
	spec := base
	spec.Targets = job.query.Targets
	spec.MetricIDs = job.query.MetricIDs
	admitted, _, err := f.c.admitFinite(ctx, spec)
	var response *sdk.ResourceMetricsResponse
	if err == nil {
		var provider sdk.FiniteQueryProvider
		provider, err = f.c.finiteProvider(base.OwnerPluginID)
		if err == nil {
			pc := f.c.getConnectedCtx(admitted, base.OwnerPluginID, base.OwnerConnectionID)
			if pc == nil {
				err = finiteError("INVALID_CONTEXT", "Metric connection unavailable.")
			} else {
				response, err = provider.QueryResources(pc, job.query)
			}
		}
	}
	if err == nil {
		err = sdk.ValidateResourceMetricsResponse(job.query, response)
	}
	var size int
	if err == nil {
		bytes, encodeErr := json.Marshal(response)
		size = len(bytes)
		if encodeErr != nil || size > finiteMaxBytes {
			err = finiteError("RESOURCE_LIMIT", "Metric response byte limit exceeded.")
		}
	}
	f.mu.Lock()
	if !f.jobs[job] {
		f.mu.Unlock()
		return
	}
	delete(f.jobs, job)
	if job.retired || len(job.waiters) == 0 {
		f.mu.Unlock()
		f.signal()
		return
	}
	if f.stopped || f.epochs[job.key] != job.epoch || f.blocked[job.key] > 0 {
		err = profileChangingError()
	}
	resultMap := map[finitePair]sdk.ResourceMetricResult{}
	if err == nil {
		for _, r := range response.Results {
			resultMap[finitePair{r.ResourceToken, r.MetricID}] = r
		}
		entry := finiteCacheEntry{partition: job.partition, pairs: resultMap, complete: response.Complete, warnings: response.Warnings, until: time.Now().Add(finiteCacheTTL), key: job.key, epoch: job.epoch, bytes: size}
		total := size
		for _, e := range f.cache {
			total += e.bytes
		}
		for len(f.cache) > 0 && (len(f.cache) >= 64 || total > 8<<20) {
			total -= f.cache[0].bytes
			f.cache[0] = finiteCacheEntry{}
			f.cache = f.cache[1:]
		}
		f.cache = append(f.cache, entry)
	}
	for w := range job.waiters {
		if err != nil {
			delete(f.pending, w)
			for other := range f.jobs {
				delete(other.waiters, w)
				if len(other.waiters) == 0 {
					other.retired = true
					other.cancel()
				}
			}
			f.finishWaiter(w, err)
			continue
		}
		w.complete = w.complete && response.Complete
		w.warnings = mergeFiniteWarnings(w.warnings, response.Warnings)
		for pair := range job.pairs {
			if !w.pairs[pair] || w.done[pair] {
				continue
			}
			w.done[pair] = true
			w.missing--
			if r, ok := resultMap[pair]; ok {
				w.results[pair] = r
			} else {
				w.complete = false
			}
		}
		if w.missing == 0 {
			delete(f.pending, w)
			f.finishWaiter(w, nil)
		}
	}
	f.mu.Unlock()
	f.signal()
}

func (f *finiteCoordinator) retire(plugin, connection string, stop bool) {
	f.mu.Lock()
	matches := func(key metricStreamKey) bool {
		return key.plugin == plugin && (connection == "" || key.connection == connection)
	}
	for id, read := range f.catalogs {
		if matches(read.key) {
			read.cancel()
			delete(f.catalogs, id)
		}
	}
	for key := range f.epochs {
		if matches(key) {
			f.epochs[key]++
		}
	}
	if connection != "" {
		key := metricStreamKey{plugin, connection}
		f.epochs[key]++
		if stop {
			f.blocked[key]++
		}
	}
	for job := range f.jobs {
		if matches(job.key) {
			job.retired = true
			job.cancel()
			for w := range job.waiters {
				delete(f.pending, w)
				f.finishWaiter(w, profileChangingError())
			}
			clear(job.waiters)
		}
	}
	for w := range f.pending {
		if matches(metricStreamKey{w.spec.OwnerPluginID, w.spec.OwnerConnectionID}) {
			delete(f.pending, w)
			f.finishWaiter(w, profileChangingError())
		}
	}
	kept := f.cache[:0]
	for _, entry := range f.cache {
		if !matches(entry.key) {
			kept = append(kept, entry)
		}
	}
	clear(f.cache[len(kept):])
	f.cache = kept
	var publish []*finiteObservation
	for key, o := range f.observations {
		if matches(metricStreamKey{o.spec.OwnerPluginID, o.spec.OwnerConnectionID}) {
			f.forgetObservationLocked(key, o)
			o.snapshot.Data = nil
			o.snapshot.Catalog = nil
			o.snapshot.Fetching = false
			o.snapshot.Invalidated = true
			o.snapshot.Error = "Metric connection retired."
			o.snapshot.Sequence++
			publish = append(publish, o)
		}
	}
	f.mu.Unlock()
	for _, o := range publish {
		o.publish()
	}
}
func (f *finiteCoordinator) shutdown() {
	f.mu.Lock()
	f.stopped = true
	for _, read := range f.catalogs {
		read.cancel()
	}
	clear(f.catalogs)
	for job := range f.jobs {
		job.cancel()
		for w := range job.waiters {
			f.finishWaiter(w, closedStreamError())
		}
	}
	for w := range f.pending {
		f.finishWaiter(w, closedStreamError())
	}
	for key, o := range f.observations {
		f.forgetObservationLocked(key, o)
	}
	clear(f.jobs)
	clear(f.pending)
	clear(f.observations)
	f.cache = nil
	f.mu.Unlock()
	f.signal()
}
