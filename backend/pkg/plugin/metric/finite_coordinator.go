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
	ctx                 context.Context
	query               sdk.ResourceMetricsQuery
	spec                MetricsObservationSpec
	partition           string
	pairs               map[finitePair]bool
	workTargets         map[string]sdk.ResourceMetricTarget
	workPairs           map[finitePair]finitePair
	results             map[finitePair]sdk.ResourceMetricResult
	missing             int
	complete            bool
	warnings            []string
	reply               chan finiteReply
	queued              time.Time
	maxTargets          int
	done                map[finitePair]bool
	epoch               uint64
	cachedPairs         map[finitePair]bool
	sourceEpoch         uint64
	configuration       uint64
	configurationKeys   []finiteConfigurationKey
	configurationSerial uint64
	configurationGuard  func() error
	finished            bool
}
type finiteJob struct {
	partition           string
	query               sdk.ResourceMetricsQuery
	pairs               map[finitePair]bool
	waiters             map[*finiteWaiter]bool
	cancel              context.CancelFunc
	epoch               uint64
	key                 metricStreamKey
	sourceKey           metricStreamKey
	sourceEpoch         uint64
	configuration       uint64
	configurationKeys   []finiteConfigurationKey
	configurationSerial uint64
	configurationGuard  func() error
	retired             bool
}
type finiteCacheEntry struct {
	partition         string
	pairs             map[finitePair]sdk.ResourceMetricResult
	complete          bool
	warnings          []string
	until             time.Time
	key               metricStreamKey
	epoch             uint64
	sourceKey         metricStreamKey
	sourceEpoch       uint64
	configuration     uint64
	configurationKeys []finiteConfigurationKey
	bytes             int
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
	c                     *controller
	mu                    sync.Mutex
	pending               map[*finiteWaiter]bool
	jobs                  map[*finiteJob]bool
	cache                 []finiteCacheEntry
	catalogs              map[string]*finiteCatalogRead
	activeCatalogs        int
	catalogWaiters        int
	epochs                map[metricStreamKey]uint64
	blocked               map[metricStreamKey]int
	observations          map[string]*finiteObservation
	snapshotBytes         int
	tombstones            map[string]time.Time
	generation            uint64
	stopped               bool
	configuration         uint64
	configurationChanges  int
	configurationSerial   uint64
	configurationVersions map[finiteConfigurationKey]uint64
	configurationBlocked  map[finiteConfigurationKey]int
	configurationReaders  map[uint64]int
	wake                  chan struct{}
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
func finiteWorkTargetKey(t sdk.ResourceMetricTarget) string {
	return metricDigest([]any{finiteTargetKey(t), t.PublicData})
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

// finiteWaiterPairs separates metric-specific public projections from caller
// correlation tokens. Equal target/metric subsets can share work even when a
// broader observation also requests a different resource-path mapping.
func finiteWaiterPairs(q sdk.ResourceMetricsQuery) (map[finitePair]bool, map[string]sdk.ResourceMetricTarget, map[finitePair]finitePair) {
	pairs := make(map[finitePair]bool, len(q.Targets)*len(q.MetricIDs))
	targets := map[string]sdk.ResourceMetricTarget{}
	keys := make(map[finitePair]finitePair, len(q.Targets)*len(q.MetricIDs))
	fields := map[string][]string{}
	for _, definition := range q.Context.Definitions {
		for _, binding := range definition.FieldBindings {
			if binding.ResourcePath != "" {
				fields[definition.ID] = append(fields[definition.ID], binding.Field)
			}
		}
	}
	for _, target := range q.Targets {
		emptyKey := metricDigest([]any{target.Token, map[string]string(nil)})
		for _, id := range q.MetricIDs {
			work := target
			work.PublicData = nil
			for _, field := range fields[id] {
				if value, exists := target.PublicData[field]; exists {
					if work.PublicData == nil {
						work.PublicData = make(map[string]string, len(fields[id]))
					}
					work.PublicData[field] = value
				}
			}
			work.Token = emptyKey
			if len(work.PublicData) > 0 {
				work.Token = metricDigest([]any{target.Token, work.PublicData})
			}
			pair := finitePair{work.Token, id}
			pairs[pair] = true
			targets[work.Token] = work
			keys[finitePair{target.Token, id}] = pair
		}
	}
	return pairs, targets, keys
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
func (c *controller) finiteCatalogUncached(ctx context.Context, request ResourceMetricsCatalogRequest, lane finiteSourceLane) (*sdk.ResourceMetricsCatalog, error) {
	providerRequest := sdk.ResourceMetricsCatalogRequest{Source: lane.source, ResourceKey: request.ResourceKey, Context: lane.context}
	if err := sdk.ValidateResourceMetricsCatalogRequest(providerRequest); err != nil {
		return nil, err
	}
	p, err := c.finiteProvider(lane.source.PluginID)
	if err != nil {
		return nil, err
	}
	pc, err := c.finiteSourceContext(ctx, lane.source)
	if err != nil {
		return nil, err
	}
	catalog, err := p.GetResourceMetricsCatalog(pc, providerRequest)
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
	if catalog.Source != lane.source {
		return nil, finiteError("INVALID_REQUEST", "Catalog source does not match the selected source.")
	}
	for _, d := range catalog.Metrics {
		if d.ResourceKey != request.ResourceKey {
			return nil, finiteError("INVALID_REQUEST", "Catalog resource key does not match the owner.")
		}
		if d.Source != nil && *d.Source != lane.source {
			return nil, finiteError("INVALID_REQUEST", "Catalog descriptor source does not match the selected source.")
		}
	}
	return cloneFiniteCatalog(catalog), nil
}

// GetResourceMetricsCatalog resolves explicit, binding, global, then native source.
// An unavailable explicit selection is an error, never a native fallback.
func (c *controller) GetResourceMetricsCatalog(ctx context.Context, request ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	return c.selectedResourceMetricsCatalog(ctx, request, nil)
}
func (c *controller) selectedResourceMetricsCatalog(ctx context.Context, request ResourceMetricsCatalogRequest, observation *finiteObservation) (*sdk.ResourceMetricsCatalog, error) {
	identity, err := finiteIdentity(ctx)
	if err != nil {
		return nil, err
	}
	if identity.Principal().Origin() == invocation.ExternalAgent && (identity.Operation() != "metric.Query" || identity.Target().Provider != request.OwnerPluginID || identity.Target().Connection != request.OwnerConnectionID || identity.Target().ResourceType != request.ResourceKey) {
		return nil, finiteError("DENIED", "Catalog reads require matching admitted owner authority.")
	}
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	f := c.finiteCoordinator()
	generation, serial, finishRead := f.beginConfigurationRead()
	defer finishRead()
	lanes, err := c.resolveFiniteSources(request, nil, nil)
	if err != nil {
		return nil, err
	}
	sourceGuard, err := f.fenceFiniteSources(request, lanes, generation, serial, nil)
	if err != nil {
		return nil, err
	}
	if observation != nil {
		f.mu.Lock()
		observation.configurationKeys = finiteLaneConfigurationKeys(lanes)
		f.mu.Unlock()
	}
	catalogs := make([]*sdk.ResourceMetricsCatalog, 0, len(lanes))
	for _, lane := range lanes {
		catalog, err := c.finiteCatalog(ctx, request, lane, serial)
		if err != nil {
			return nil, err
		}
		if len(lanes) > 1 {
			filtered := cloneFiniteCatalog(catalog)
			filtered.Metrics = nil
			for _, descriptor := range catalog.Metrics {
				if lane.acceptsMetric(descriptor.ID) {
					filtered.Metrics = append(filtered.Metrics, descriptor)
				}
			}
			catalog = filtered
		}
		catalogs = append(catalogs, catalog)
	}
	merged, err := mergeFiniteCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	merged.Source = lanes[0].catalogSource
	if err = sourceGuard(); err != nil {
		return nil, err
	}
	f.mu.Lock()
	current := !f.stopped && f.configuration == generation && f.configurationChanges == 0
	f.mu.Unlock()
	if !current {
		return nil, profileChangingError()
	}
	return merged, nil
}

func (c *controller) admitFinite(ctx context.Context, spec MetricsObservationSpec) (context.Context, sdk.ResourceMetricsQuery, error) {
	resolved, err := resolveFiniteRange(spec, time.Now())
	if err != nil {
		return ctx, sdk.ResourceMetricsQuery{}, err
	}
	spec = resolved
	q := sdk.ResourceMetricsQuery{Source: sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, DatasourceKind: "metrics-server"}, Targets: spec.Targets, MetricIDs: spec.MetricIDs, Shape: spec.Shape, StartTime: spec.StartTime, EndTime: spec.EndTime, Step: time.Duration(spec.StepMs) * time.Millisecond}
	if spec.Source != nil {
		q.Source = *spec.Source
	}
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
	return c.readFiniteResolved(ctx, spec, refresh, capture, observation, nil)
}
func (c *controller) readFiniteResolved(ctx context.Context, spec MetricsObservationSpec, refresh bool, capture func(*sdk.ResourceMetricsCatalog), observation *finiteObservation, preview *sdk.MetricDefinition) (*sdk.ResourceMetricsResponse, error) {
	resolved, err := resolveFiniteRange(spec, time.Now())
	if err != nil {
		return nil, err
	}
	spec = resolved
	admitted, baseQuery, err := c.admitFinite(ctx, spec)
	if err != nil {
		return nil, err
	}
	f := c.finiteCoordinator()
	generation, serial, finishRead := f.beginConfigurationRead()
	defer finishRead()
	request := ResourceMetricsCatalogRequest{OwnerPluginID: spec.OwnerPluginID, OwnerConnectionID: spec.OwnerConnectionID, ResourceKey: spec.ResourceKey, BindingID: spec.BindingID, Source: spec.Source}
	lanes, err := c.resolveFiniteSources(request, spec.MetricIDs, preview)
	if err != nil {
		return nil, err
	}
	if preview != nil {
		for _, lane := range lanes {
			if lane.source.DatasourceKind == "metrics-server" {
				return nil, finiteError("UNSUPPORTED", "Definition previews require a mapping-capable selected source.")
			}
		}
	}
	sourceGuard, err := f.fenceFiniteSources(request, lanes, generation, serial, preview)
	if err != nil {
		return nil, err
	}
	// Retain repair dependencies until replacement catalogs are admitted. A
	// deleted definition or source can then recover the same observation.
	if observation != nil {
		f.mu.Lock()
		observation.configurationKeys = finiteMergeConfigurationKeys(observation.configurationKeys, finiteLaneConfigurationKeys(lanes))
		f.mu.Unlock()
	}
	// Validate every lane before collecting any metric samples.
	preparedCatalogs := make([]*sdk.ResourceMetricsCatalog, len(lanes))
	for i, lane := range lanes {
		catalog, err := c.finiteCatalog(admitted, request, lane, serial)
		if err != nil {
			return nil, err
		}
		query := baseQuery
		query.Source = lane.source
		query.Context = lane.context
		query.MetricIDs = lane.metrics
		if err = validateFiniteSelection(query, catalog); err != nil {
			return nil, err
		}
		preparedCatalogs[i] = catalog
	}
	if observation != nil {
		f.mu.Lock()
		observation.configurationKeys = finiteLaneConfigurationKeys(lanes)
		f.mu.Unlock()
	}
	projectionGuards := []func() error{}
	response := &sdk.ResourceMetricsResponse{Complete: true}
	catalogs := make([]*sdk.ResourceMetricsCatalog, 0, len(lanes))
	for i, lane := range lanes {
		laneSpec := spec
		source := lane.source
		laneSpec.Source = &source
		laneSpec.MetricIDs = lane.metrics
		laneGuard, err := f.fenceFiniteSources(request, []finiteSourceLane{lane}, generation, serial, preview)
		if err != nil {
			return nil, err
		}
		data, catalog, err := c.readFiniteLane(admitted, laneSpec, lane, preparedCatalogs[i], refresh, observation, generation, serial, laneGuard, func(guard func() error) { projectionGuards = append(projectionGuards, guard) })
		if err != nil {
			return nil, err
		}
		if len(lanes) > 1 {
			for i := range data.Results {
				source := lane.source
				data.Results[i].Source = &source
			}
		}
		response.Results = append(response.Results, data.Results...)
		response.Complete = response.Complete && data.Complete
		response.Warnings = mergeFiniteWarnings(response.Warnings, data.Warnings)
		filtered := cloneFiniteCatalog(catalog)
		filtered.Metrics = nil
		for _, descriptor := range catalog.Metrics {
			if slices.Contains(lane.metrics, descriptor.ID) {
				filtered.Metrics = append(filtered.Metrics, descriptor)
			}
		}
		catalogs = append(catalogs, filtered)
	}
	f.mu.Lock()
	current := !f.stopped && f.configuration == generation && f.configurationChanges == 0
	f.mu.Unlock()
	if !current {
		return nil, profileChangingError()
	}
	if _, _, err = c.admitFinite(ctx, spec); err != nil {
		return nil, err
	}
	if err = sourceGuard(); err != nil {
		return nil, err
	}
	for _, guard := range projectionGuards {
		if err = guard(); err != nil {
			return nil, err
		}
	}
	points := 0
	for _, result := range response.Results {
		points += len(result.Points)
	}
	if points > sdk.MaxFinitePoints {
		return nil, finiteError("RESOURCE_LIMIT", "Merged metric sample limit exceeded.")
	}
	if encoded, err := json.Marshal(response); err != nil || len(encoded) > finiteMaxBytes {
		return nil, finiteError("RESOURCE_LIMIT", "Merged metric response byte limit exceeded.")
	}
	if capture != nil {
		catalog, err := mergeFiniteCatalogs(catalogs)
		if err != nil {
			return nil, err
		}
		catalog.Source = lanes[0].catalogSource
		capture(catalog)
	}
	return response, nil
}
func (c *controller) readFiniteLane(ctx context.Context, spec MetricsObservationSpec, lane finiteSourceLane, catalog *sdk.ResourceMetricsCatalog, refresh bool, observation *finiteObservation, generation, serial uint64, configurationGuard func() error, captureGuard func(func() error)) (*sdk.ResourceMetricsResponse, *sdk.ResourceMetricsCatalog, error) {
	admitted, q, err := c.admitFinite(ctx, spec)
	if err != nil {
		return nil, nil, err
	}
	q.Context = lane.context
	q, guard, err := c.projectFinite(admitted, spec.OwnerPluginID, spec.OwnerConnectionID, q)
	if err != nil {
		return nil, nil, err
	}
	captureGuard(guard)
	if err = sdk.ValidateResourceMetricsQuery(q); err != nil {
		return nil, nil, err
	}
	if err = validateFiniteSelection(q, catalog); err != nil {
		return nil, nil, err
	}
	request, ok := invocation.FromContext(admitted)
	if !ok {
		return nil, nil, finiteError("DENIED", "Admitted metric identity is required.")
	}
	// A partition isolates authority, connection generations and evaluation domain.
	partition := metricDigest([]any{request.Principal().Owner(), request.Principal().Generation(), spec.OwnerPluginID, spec.OwnerConnectionID, q.Source, q.Context, lane.configurationKeys, spec.ResourceKey, q.Shape, q.StartTime, q.EndTime, q.Step, catalog})
	canonical := q
	canonical.Targets = make([]sdk.ResourceMetricTarget, len(q.Targets))
	copy(canonical.Targets, q.Targets)
	for i := range canonical.Targets {
		canonical.Targets[i].Token = finiteTargetKey(canonical.Targets[i])
	}
	w := &finiteWaiter{ctx: admitted, query: canonical, spec: spec, partition: partition, done: map[finitePair]bool{}, results: map[finitePair]sdk.ResourceMetricResult{}, complete: true, reply: make(chan finiteReply, 1), queued: time.Now(), maxTargets: catalog.MaxTargets}
	w.pairs, w.workTargets, w.workPairs = finiteWaiterPairs(canonical)
	w.configuration = generation
	w.configurationKeys = lane.configurationKeys
	w.configurationSerial = serial
	w.configurationGuard = configurationGuard
	w.missing = len(w.pairs)
	f := c.finiteCoordinator()
	key := metricStreamKey{spec.OwnerPluginID, spec.OwnerConnectionID}
	sourceKey := metricStreamKey{q.Source.PluginID, q.Source.ConnectionID}
	f.mu.Lock()
	if f.stopped || f.configurationChanges > 0 || f.configuration != generation || f.blocked[key] > 0 || f.blocked[sourceKey] > 0 || !f.configurationCurrentLocked(w.configurationKeys, serial) {
		f.mu.Unlock()
		return nil, nil, profileChangingError()
	}
	interests, pairs := f.interestBoundsLocked()
	if interests >= finiteMaxInterests || pairs+len(w.pairs) > 32768 {
		f.mu.Unlock()
		return nil, nil, finiteError("RESOURCE_LIMIT", "Metric coordinator interest or pair limit exceeded.")
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
	w.sourceEpoch = f.epochs[sourceKey]
	f.epochs[sourceKey] = w.sourceEpoch
	if !refresh {
		now := time.Now()
		for index := len(f.cache) - 1; index >= 0; index-- {
			entry := f.cache[index]
			if entry.partition != partition || entry.configuration != generation || entry.epoch != w.epoch || entry.sourceEpoch != w.sourceEpoch || !now.Before(entry.until) {
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
			if job.retired || job.partition != partition || job.configuration != generation || job.epoch != w.epoch || job.sourceEpoch != w.sourceEpoch {
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
			return nil, nil, result.err
		}
		if _, _, err = c.admitFinite(ctx, spec); err != nil {
			return nil, nil, err
		}
		if err = configurationGuard(); err != nil {
			return nil, nil, err
		}
		if err = guard(); err != nil {
			return nil, nil, err
		}
		f.mu.Lock()
		current := !f.stopped && f.configurationChanges == 0 && f.configuration == w.configuration && f.blocked[key] == 0 && f.blocked[sourceKey] == 0 && f.epochs[key] == w.epoch && f.epochs[sourceKey] == w.sourceEpoch && f.configurationCurrentLocked(w.configurationKeys, w.configurationSerial)
		f.mu.Unlock()
		if !current {
			return nil, nil, profileChangingError()
		}
		// Projection never exposes another subscriber's target tokens or pairs.
		tokens := map[string]string{}
		for _, t := range q.Targets {
			tokens[finiteTargetKey(t)] = t.Token
		}
		ownerNative := sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, DatasourceKind: "metrics-server"}
		for i := range result.data.Results {
			result.data.Results[i] = cloneFiniteResult(result.data.Results[i])
			result.data.Results[i].ResourceToken = tokens[result.data.Results[i].ResourceToken]
			if q.Source == ownerNative {
				// A single owner-native lane has unambiguous request/catalog
				// provenance. Avoid expanding its bounded provider payload with
				// redundant source metadata. Mixed responses fill every source.
				result.data.Results[i].Source = nil
			} else {
				source := q.Source
				result.data.Results[i].Source = &source
			}
		}
		if encoded, encodeErr := json.Marshal(result.data); encodeErr != nil || len(encoded) > finiteMaxBytes {
			return nil, nil, finiteError("RESOURCE_LIMIT", "Projected metric response byte limit exceeded.")
		}
		return result.data, catalog, nil
	case <-ctx.Done():
		f.detach(w)
		return nil, nil, ctx.Err()
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
			if r, ok := w.results[w.workPairs[finitePair{t.Token, m}]]; ok {
				r.ResourceToken = t.Token
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
		if o.attached && !f.configurationCurrentLocked(o.configurationKeys, f.configurationSerial) {
			continue
		}
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
		for token, target := range w.workTargets {
			targets[token] = target
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
				seenReferences := map[string]bool{}
				remaining := list[:0]
				for _, id := range list {
					target := targets[id]
					reference := finiteTargetKey(target)
					if len(q.Targets) >= count || seenReferences[reference] {
						remaining = append(remaining, id)
						continue
					}
					seenReferences[reference] = true
					q.Targets = append(q.Targets, target)
				}
				list = remaining
				key := metricStreamKey{base.spec.OwnerPluginID, base.spec.OwnerConnectionID}
				workCtx, cancel := context.WithTimeout(context.WithoutCancel(base.ctx), resourceMetricsTimeout)
				sourceKey := metricStreamKey{q.Source.PluginID, q.Source.ConnectionID}
				job := &finiteJob{partition: partition, query: q, pairs: finitePairs(q), waiters: map[*finiteWaiter]bool{}, cancel: cancel, key: key, epoch: base.epoch, sourceKey: sourceKey, sourceEpoch: base.sourceEpoch, configuration: base.configuration}
				job.configurationKeys = base.configurationKeys
				job.configurationSerial = base.configurationSerial
				job.configurationGuard = base.configurationGuard
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
	var guard func() error
	if err == nil {
		var projected sdk.ResourceMetricsQuery
		projected, guard, err = f.c.projectFinite(admitted, base.OwnerPluginID, base.OwnerConnectionID, job.query)
		if err == nil {
			for i, t := range projected.Targets {
				if finiteWorkTargetKey(t) != finiteWorkTargetKey(job.query.Targets[i]) {
					err = profileChangingError()
					break
				}
			}
		}
		if err == nil {
			provider, failure := f.c.finiteProvider(job.query.Source.PluginID)
			err = failure
			if err == nil {
				pc, failure := f.c.finiteSourceContext(admitted, job.query.Source)
				err = failure
				if err == nil {
					err = ctx.Err()
				}
				if err == nil {
					f.mu.Lock()
					current := !f.stopped && f.configurationChanges == 0 && f.configuration == job.configuration && f.epochs[job.key] == job.epoch && f.epochs[job.sourceKey] == job.sourceEpoch && f.blocked[job.key] == 0 && f.blocked[job.sourceKey] == 0 && f.configurationCurrentLocked(job.configurationKeys, job.configurationSerial)
					f.mu.Unlock()
					if !current {
						err = profileChangingError()
					}
				}
				if err == nil {
					err = guard()
				}
				if err == nil {
					err = job.configurationGuard()
				}
				if err == nil {
					response, err = provider.QueryResources(pc, projected)
				}
			}
		}
	}
	if err == nil {
		err = guard()
	}
	if err == nil {
		err = job.configurationGuard()
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
	if f.stopped || f.configurationChanges > 0 || f.configuration != job.configuration || f.epochs[job.key] != job.epoch || f.epochs[job.sourceKey] != job.sourceEpoch || f.blocked[job.key] > 0 || f.blocked[job.sourceKey] > 0 || !f.configurationCurrentLocked(job.configurationKeys, job.configurationSerial) {
		err = profileChangingError()
	}
	resultMap := map[finitePair]sdk.ResourceMetricResult{}
	if err == nil {
		for _, r := range response.Results {
			resultMap[finitePair{r.ResourceToken, r.MetricID}] = r
		}
		entry := finiteCacheEntry{partition: job.partition, pairs: resultMap, complete: response.Complete, warnings: response.Warnings, until: time.Now().Add(finiteCacheTTL), key: job.key, epoch: job.epoch, sourceKey: job.sourceKey, sourceEpoch: job.sourceEpoch, configuration: job.configuration, bytes: size}
		entry.configurationKeys = job.configurationKeys
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
		if matches(read.key) || matches(read.sourceKey) {
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
		if matches(job.key) || matches(job.sourceKey) {
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
		if matches(metricStreamKey{w.spec.OwnerPluginID, w.spec.OwnerConnectionID}) || matches(metricStreamKey{w.query.Source.PluginID, w.query.Source.ConnectionID}) {
			delete(f.pending, w)
			f.finishWaiter(w, profileChangingError())
		}
	}
	kept := f.cache[:0]
	for _, entry := range f.cache {
		if !matches(entry.key) && !matches(entry.sourceKey) {
			kept = append(kept, entry)
		}
	}
	clear(f.cache[len(kept):])
	f.cache = kept
	var publish []*finiteObservation
	for key, o := range f.observations {
		affected := matches(metricStreamKey{o.spec.OwnerPluginID, o.spec.OwnerConnectionID})
		if catalog := o.snapshot.Catalog; catalog != nil {
			affected = affected || matches(metricStreamKey{catalog.Source.PluginID, catalog.Source.ConnectionID})
			for _, d := range catalog.Metrics {
				if d.Source != nil {
					affected = affected || matches(metricStreamKey{d.Source.PluginID, d.Source.ConnectionID})
				}
			}
		}
		if affected {
			f.forgetObservationLocked(key, o)
			o.snapshot.Data = nil
			o.snapshot.Catalog = nil
			if o.spec.DurationMs > 0 {
				o.snapshot.DomainStart = nil
				o.snapshot.DomainEnd = nil
			}
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
