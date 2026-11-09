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
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/internal/telemetry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

const finiteMaxInterests = 512
const finiteMaxJobs = 4

// Coordinator policy applies equally to every provider and metric.
const finiteCacheTTL = 30 * time.Second
const finiteCoalesceDelay = 25 * time.Millisecond
const finiteDispatchInterval = 250 * time.Millisecond
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
	rangeToCurrentKey   string
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
	maxSampleAge        time.Duration
	done                map[finitePair]bool
	epoch               uint64
	cachedPairs         map[finitePair]bool
	sourceEpoch         uint64
	configuration       uint64
	configurationKeys   []finiteConfigurationKey
	configurationSerial uint64
	configurationGuard  func() error
	finished            bool
	rangeReuse          bool
	rangeCoverage       map[finitePair][]finiteRangeSpan
	rangePoints         int
	progress            chan struct{}
}
type finiteJob struct {
	partition           string
	rangeToCurrentKey   string
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
	maxSampleAge        time.Duration
	rangeReuse          bool
}
type finiteCacheEntry struct {
	partition         string
	rangeToCurrentKey string
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
	rangeReuse        bool
	start, end        time.Time
	evaluated         time.Time
	reached           time.Time
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
	nextDispatch          time.Time
	unregisterDiagnostics func()
}

func (c *controller) finiteCoordinator() *finiteCoordinator {
	c.finiteOnce.Do(func() {
		f := &finiteCoordinator{c: c, pending: map[*finiteWaiter]bool{}, jobs: map[*finiteJob]bool{}, epochs: map[metricStreamKey]uint64{}, blocked: map[metricStreamKey]int{}, observations: map[string]*finiteObservation{}, tombstones: map[string]time.Time{}, wake: make(chan struct{}, 1)}
		f.unregisterDiagnostics = telemetry.RegisterPipelineState(f.diagnosticsState)
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
	started := time.Now()
	catalog, err := p.GetResourceMetricsCatalog(pc, providerRequest)
	telemetry.RecordPipelineProvider(telemetry.WithPlugin(ctx, lane.source.PluginID), "catalog", started, err)
	if err != nil {
		return nil, finiteProviderFailure{err}
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
	lanes, err := c.resolveFiniteSources(ctx, request, nil, nil)
	if err != nil {
		return nil, err
	}
	sourceGuard, err := f.fenceFiniteSources(ctx, request, lanes, generation, serial, nil)
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
	q := sdk.ResourceMetricsQuery{Source: sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, Native: true}, Targets: spec.Targets, MetricIDs: spec.MetricIDs, Shape: spec.Shape, StartTime: spec.StartTime, EndTime: spec.EndTime, Step: time.Duration(spec.StepMs) * time.Millisecond}
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
	// One admission instant per call: targets share the route catalog while each
	// reference is still individually authorized. Delivery re-admits with a new batch.
	batch := resource.WithAdmissionBatch(ctx)
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
		admitted, err := c.referenceAdmitter(batch, "metric.Query", spec.OwnerPluginID, t.Route, t.Reference)
		if err != nil {
			return ctx, q, finiteAuthorityError(err)
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
// interests and 32768 requested pairs. A response is at most 4 MiB/10000 points,
// and a coverage-reusing range reader that has assembled more across its pairs
// fails at once and retires any work no other reader needs.
// Completed exact-pair cache retains samples for at most 30 seconds, within
// 64 entries/8 MiB and the source's known live-sample age policy. Catalogs retain
// at most 64 entries of 64 KiB for 30 seconds.
// Catalog admission shares oldest-demand scheduling with samples: 25 ms
// coalescing, one global start per 250 ms, no catch-up burst. Queue/cache holds
// at most 64 catalog keys and 512 readers. Canceled providers keep their slots
// until returning. These bounds limit jobs, not provider HTTP calls: native
// namespace scans can visit unrequested inventory and repeat across groups.
// Overflow returns RESOURCE_LIMIT, never silent truncation or a legacy fallback.
func (c *controller) ReadFiniteResourceMetrics(ctx context.Context, spec MetricsObservationSpec) (*sdk.ResourceMetricsResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	return c.readFinite(ctx, spec, false)
}
func (c *controller) readFinite(ctx context.Context, spec MetricsObservationSpec, refresh bool) (*sdk.ResourceMetricsResponse, error) {
	return c.readFiniteResolved(ctx, spec, refresh, nil, nil, nil, nil)
}
func (c *controller) readFiniteResolved(ctx context.Context, spec MetricsObservationSpec, refresh bool, capture func(*sdk.ResourceMetricsCatalog), observation *finiteObservation, preview *sdk.MetricDefinition, progress finiteProgress) (*sdk.ResourceMetricsResponse, error) {
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
	// Sample admission and fences cover only participating source lanes.
	// Observation discovery metadata is retained separately from execution.
	lanes, err := c.resolveFiniteSources(admitted, request, spec.MetricIDs, preview)
	if err != nil {
		return nil, finiteAuthorityError(err)
	}
	if preview != nil {
		for _, lane := range lanes {
			if lane.source.Native {
				return nil, finiteError("UNSUPPORTED", "Definition previews require a mapping-capable selected source.")
			}
		}
	}
	sourceGuard, err := f.fenceFiniteSources(admitted, request, lanes, generation, serial, preview)
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
	// Validate every lane before collecting or publishing any sample.
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
		if len(query.MetricIDs) > 0 {
			err = finiteAuthorityError(validateFiniteSelection(query, catalog))
		}
		if err != nil {
			return nil, err
		}
		preparedCatalogs[i] = catalog
	}
	if observation != nil {
		f.mu.Lock()
		observation.configurationKeys = finiteLaneConfigurationKeys(lanes)
		f.mu.Unlock()
	}
	var sampleCatalog *sdk.ResourceMetricsCatalog
	if capture != nil || progress != nil {
		catalogs := make([]*sdk.ResourceMetricsCatalog, 0, len(lanes))
		for i, lane := range lanes {
			filtered := cloneFiniteCatalog(preparedCatalogs[i])
			filtered.Metrics = nil
			for _, descriptor := range preparedCatalogs[i].Metrics {
				if slices.Contains(lane.metrics, descriptor.ID) {
					filtered.Metrics = append(filtered.Metrics, descriptor)
				}
			}
			catalogs = append(catalogs, filtered)
		}
		sampleCatalog, err = mergeFiniteCatalogs(catalogs)
		if err != nil {
			return nil, err
		}
		sampleCatalog.Source = lanes[0].catalogSource
	}
	projectionGuards := []func() error{}
	deliveryGuard := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		f.mu.Lock()
		current := !f.stopped && f.configuration == generation && f.configurationChanges == 0
		f.mu.Unlock()
		if !current {
			return profileChangingError()
		}
		if _, _, err := c.admitFinite(ctx, spec); err != nil {
			return err
		}
		if err := finiteAuthorityError(sourceGuard()); err != nil {
			return err
		}
		for _, guard := range projectionGuards {
			if err := finiteAuthorityError(guard()); err != nil {
				return err
			}
		}
		return nil
	}
	response := &sdk.ResourceMetricsResponse{Results: nil, Complete: true, Warnings: nil}
	for i, lane := range lanes {
		laneSpec := spec
		source := lane.source
		laneSpec.Source = &source
		laneSpec.MetricIDs = lane.metrics
		laneGuard, err := f.fenceFiniteSources(admitted, request, []finiteSourceLane{lane}, generation, serial, preview)
		if err != nil {
			return nil, err
		}
		var laneProgress func(*sdk.ResourceMetricsResponse) error
		if progress != nil && spec.Shape == "range" {
			laneProgress = func(data *sdk.ResourceMetricsResponse) error {
				partial := &sdk.ResourceMetricsResponse{
					Results:  make([]sdk.ResourceMetricResult, 0, len(response.Results)+len(data.Results)),
					Complete: false,
					Warnings: mergeFiniteWarnings(slices.Clone(response.Warnings), data.Warnings),
				}
				partial.Results = append(partial.Results, response.Results...)
				for _, result := range data.Results {
					if len(lanes) > 1 {
						result.Source = &source
					}
					partial.Results = append(partial.Results, result)
				}
				return progress(partial, sampleCatalog, deliveryGuard)
			}
		}
		data, err := c.readFiniteLane(admitted, laneSpec, lane, preparedCatalogs[i], refresh, observation, generation, serial, laneGuard, func(guard func() error) { projectionGuards = append(projectionGuards, guard) }, laneProgress)
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
		if progress != nil && spec.Shape == "range" && i+1 < len(lanes) {
			if err := progress(response, sampleCatalog, deliveryGuard); err != nil {
				return nil, err
			}
		}
	}
	if err := deliveryGuard(); err != nil {
		return nil, err
	}
	if _, err := finiteResponseSize(response); err != nil {
		return nil, err
	}
	if capture != nil {
		capture(sampleCatalog)
	}
	return response, nil
}
func (c *controller) readFiniteLane(ctx context.Context, spec MetricsObservationSpec, lane finiteSourceLane, catalog *sdk.ResourceMetricsCatalog, refresh bool, observation *finiteObservation, generation, serial uint64, configurationGuard func() error, captureGuard func(func() error), progress func(*sdk.ResourceMetricsResponse) error) (*sdk.ResourceMetricsResponse, error) {
	admitted, q, err := c.admitFinite(ctx, spec)
	if err != nil {
		return nil, err
	}
	q.Context = lane.context
	q, guard, err := c.projectFinite(admitted, spec.OwnerPluginID, spec.OwnerConnectionID, q)
	if err != nil {
		return nil, finiteAuthorityError(err)
	}
	captureGuard(guard)
	if err = sdk.ValidateResourceMetricsQuery(q); err != nil {
		return nil, err
	}
	if err = finiteAuthorityError(validateFiniteSelection(q, catalog)); err != nil {
		return nil, err
	}
	request, ok := invocation.FromContext(admitted)
	if !ok {
		return nil, finiteError("DENIED", "Admitted metric identity is required.")
	}
	// Bounds may be omitted only when every selected metric explicitly declares
	// pointwise grid semantics. Step, catalog, context and all authority remain.
	rangeReuse, rangeToCurrent := finiteReuseCapabilities(q, catalog)
	start, end := q.StartTime, q.EndTime
	if rangeReuse {
		start, end = time.Time{}, time.Time{}
	}
	parts := []any{request.Principal().Owner(), request.Principal().Generation(), spec.OwnerPluginID, spec.OwnerConnectionID, q.Source, q.Context, lane.configurationKeys, spec.ResourceKey, catalog, q.Shape, start, end, q.Step}
	var rangeToCurrentKey, partition string
	if rangeToCurrent {
		// Only explicit instant-equivalence permits omitting shape, bounds and
		// step. Every authority, definition, source and projection fence remains.
		rangeToCurrentKey = metricDigest(parts[:len(parts)-4])
		partition = metricDigest([]any{rangeToCurrentKey, q.Shape, start, end, q.Step})
	} else {
		partition = metricDigest(parts)
	}
	canonical := q
	canonical.Targets = make([]sdk.ResourceMetricTarget, len(q.Targets))
	copy(canonical.Targets, q.Targets)
	for i := range canonical.Targets {
		canonical.Targets[i].Token = finiteTargetKey(canonical.Targets[i])
	}
	w := &finiteWaiter{ctx: admitted, query: canonical, spec: spec, partition: partition, done: map[finitePair]bool{}, results: map[finitePair]sdk.ResourceMetricResult{}, complete: true, reply: make(chan finiteReply, 1), queued: time.Now(), maxTargets: catalog.MaxTargets}
	w.rangeReuse = rangeReuse
	w.rangeToCurrentKey = rangeToCurrentKey
	if rangeReuse {
		w.rangeCoverage = map[finitePair][]finiteRangeSpan{}
	}
	if progress != nil && q.Shape == "range" {
		w.progress = make(chan struct{}, 1)
	}
	w.maxSampleAge = catalog.MaxSampleAge
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
	w.sourceEpoch = f.epochs[sourceKey]
	f.epochs[sourceKey] = w.sourceEpoch
	if !refresh {
		now := time.Now()
		for index := len(f.cache) - 1; index >= 0; index-- {
			entry := f.cache[index]
			if entry.partition != partition || entry.configuration != generation || entry.epoch != w.epoch || entry.sourceEpoch != w.sourceEpoch || !now.Before(entry.until) {
				continue
			}
			if w.rangeReuse {
				if err := f.applyRangeCacheLocked(w, entry); err != nil {
					f.mu.Unlock()
					return nil, err
				}
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
		if q.Shape == "current" && rangeToCurrentKey != "" && w.missing > 0 {
			// Exact current results, including absence, always take precedence.
			f.applyCurrentRangeCacheLocked(w, catalog, now)
		}
	}
	telemetry.RecordPipelineEvent(ctx, "cache_hit_pairs", int64(len(w.cachedPairs)))
	telemetry.RecordPipelineEvent(ctx, "cache_miss_pairs", int64(w.missing))
	if w.missing > 0 {
		if w.rangeReuse {
			// Attach in-flight overlap while the lock that guards cancellation is
			// still held, not at the next dispatch scan.
			f.joinRangeJobsLocked(w)
		}
		for job := range f.jobs {
			if job.retired || job.partition != partition || job.configuration != generation || job.epoch != w.epoch || job.sourceEpoch != w.sourceEpoch || w.rangeReuse {
				continue
			}
			for pair := range w.pairs {
				if !w.done[pair] && job.pairs[pair] {
					job.waiters[w] = true
				}
			}
		}
		f.pending[w] = true
		f.progressWaiterLocked(w)
	}
	ready := w.missing == 0
	if ready {
		f.finishWaiter(w, nil)
	}
	f.mu.Unlock()
	f.signal()
	deliver := func(result finiteReply) (*sdk.ResourceMetricsResponse, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if result.err != nil {
			return nil, result.err
		}
		if _, _, err = c.admitFinite(ctx, spec); err != nil {
			return nil, err
		}
		if err = finiteAuthorityError(configurationGuard()); err != nil {
			return nil, err
		}
		if err = finiteAuthorityError(guard()); err != nil {
			return nil, err
		}
		f.mu.Lock()
		current := !f.stopped && f.configurationChanges == 0 && f.configuration == w.configuration && f.blocked[key] == 0 && f.blocked[sourceKey] == 0 && f.epochs[key] == w.epoch && f.epochs[sourceKey] == w.sourceEpoch && f.configurationCurrentLocked(w.configurationKeys, w.configurationSerial)
		f.mu.Unlock()
		if !current {
			return nil, profileChangingError()
		}
		// Projection never exposes another subscriber's target tokens or pairs.
		tokens := map[string]string{}
		for _, t := range q.Targets {
			tokens[finiteTargetKey(t)] = t.Token
		}
		ownerNative := sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, Native: true}
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
			return nil, finiteError("RESOURCE_LIMIT", "Projected metric response byte limit exceeded.")
		}
		return result.data, nil
	}
	for {
		select {
		case result := <-w.reply:
			return deliver(result)
		case <-w.progress:
			f.mu.Lock()
			var reply finiteReply
			if !w.finished {
				reply = finiteWaiterReply(w, true)
			}
			f.mu.Unlock()
			if reply.data == nil && reply.err == nil {
				continue
			}
			data, err := deliver(reply)
			if err == nil {
				err = progress(data)
			}
			if err != nil {
				f.detach(w)
				return nil, err
			}
		case <-ctx.Done():
			telemetry.RecordPipelineEvent(ctx, "cancel_interest", 1)
			f.detach(w)
			return nil, ctx.Err()
		}
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
	w.finished = true
	f.removeWaiterLocked(w)
}

func (f *finiteCoordinator) removeWaiterLocked(w *finiteWaiter) {
	delete(f.pending, w)
	for j := range f.jobs {
		delete(j.waiters, w)
		if len(j.waiters) == 0 && !j.retired {
			j.retireLocked()
		}
	}
}
func (f *finiteCoordinator) finishWaiter(w *finiteWaiter, err error) {
	if w.finished {
		return
	}
	if w.rangeReuse && err == nil {
		// Another overlapping job may finish this reader first. It must not
		// keep unrelated remainder work alive after its last real reader leaves.
		for job := range f.jobs {
			delete(job.waiters, w)
			if len(job.waiters) == 0 && !job.retired {
				job.retireLocked()
			}
		}
	}
	w.finished = true
	reply := finiteReply{data: nil, err: err}
	if err == nil {
		reply = finiteWaiterReply(w, false)
	}
	select {
	case w.reply <- reply:
	default:
	}
}

func finiteWaiterReply(w *finiteWaiter, partial bool) finiteReply {
	response := &sdk.ResourceMetricsResponse{Results: make([]sdk.ResourceMetricResult, 0, len(w.results)), Complete: w.complete && !partial, Warnings: slices.Clone(w.warnings)}
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
	return reply
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
	admission := func(queued time.Time) {
		if len(f.jobs)+f.activeCatalogs >= finiteMaxJobs {
			return
		}
		earlier(maxFiniteTime(now, queued.Add(finiteCoalesceDelay), f.nextDispatch))
	}
	for w := range f.pending {
		if deadline, ok := w.ctx.Deadline(); ok {
			earlier(deadline)
		}
		for pair := range w.pairs {
			if _, uncovered := f.uncoveredLocked(w, pair); uncovered {
				admission(w.queued)
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
		} else if !read.started {
			admission(read.queued)
			if deadline, ok := read.ctx.Deadline(); ok {
				earlier(deadline)
			}
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
		if !read.finished && !read.started && read.ctx.Err() != nil {
			f.finishCatalogLocked(key, read, nil, read.ctx.Err())
		}
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
func maxFiniteTime(values ...time.Time) time.Time {
	var latest time.Time
	for _, value := range values {
		if value.After(latest) {
			latest = value
		}
	}
	return latest
}

func (f *finiteCoordinator) uncoveredLocked(w *finiteWaiter, pair finitePair) (finiteRangeSpan, bool) {
	if w.done[pair] {
		return finiteNoSpan(), false
	}
	if w.rangeReuse {
		return f.nextFiniteRangeLocked(w, pair, true)
	}
	for job := range f.jobs {
		if !job.retired && job.partition == w.partition && job.pairs[pair] {
			job.waiters[w] = true
			return finiteNoSpan(), false
		}
	}
	return finiteNoSpan(), true
}

func (f *finiteCoordinator) dispatchLocked() {
	f.dispatchAtLocked(time.Now())
}

// One start per interval, without catch-up bursts. Catalogs and exact-pair
// groups share oldest-demand admission; active polling never resets older age.
func (f *finiteCoordinator) dispatchAtLocked(now time.Time) {
	if len(f.jobs)+f.activeCatalogs >= finiteMaxJobs || now.Before(f.nextDispatch) {
		return
	}
	var base *finiteWaiter
	var seed finitePair
	var seedRange finiteRangeSpan
	for w := range f.pending {
		if w.ctx.Err() != nil || now.Before(w.queued.Add(finiteCoalesceDelay)) {
			continue
		}
		for pair := range w.pairs {
			span, uncovered := f.uncoveredLocked(w, pair)
			if !uncovered {
				continue
			}
			if base == nil || w.queued.Before(base.queued) ||
				(w.queued.Equal(base.queued) && (w.partition < base.partition ||
					(w.partition == base.partition && (pair.target < seed.target ||
						(pair.target == seed.target && pair.metric < seed.metric))))) {
				base, seed, seedRange = w, pair, span
			}
		}
	}
	var catalog *finiteCatalogRead
	var catalogID string
	for id, read := range f.catalogs {
		if read.finished || read.started || read.callers == 0 || read.ctx.Err() != nil || now.Before(read.queued.Add(finiteCoalesceDelay)) {
			continue
		}
		if catalog == nil || read.queued.Before(catalog.queued) || (read.queued.Equal(catalog.queued) && id < catalogID) {
			catalog, catalogID = read, id
		}
	}
	if catalog != nil && (base == nil || !base.queued.Before(catalog.queued)) {
		catalog.started = true
		f.activeCatalogs++
		f.nextDispatch = now.Add(finiteDispatchInterval)
		go f.runCatalog(catalogID, catalog)
		return
	}
	if base == nil {
		return
	}
	// Exact union within the oldest partition. Only targets with identical
	// outstanding metric sets share a query; never form a Cartesian superset.
	byTarget := map[string]map[string]bool{}
	targets := map[string]sdk.ResourceMetricTarget{}
	ages := map[string]time.Time{}
	for w := range f.pending {
		if w.partition != base.partition || w.ctx.Err() != nil || now.Before(w.queued.Add(finiteCoalesceDelay)) {
			continue
		}
		for pair := range w.pairs {
			span, uncovered := f.uncoveredLocked(w, pair)
			if !uncovered || !span.start.Equal(seedRange.start) || !span.end.Equal(seedRange.end) {
				continue
			}
			if byTarget[pair.target] == nil {
				byTarget[pair.target] = map[string]bool{}
			}
			byTarget[pair.target][pair.metric] = true
			targets[pair.target] = w.workTargets[pair.target]
			if ages[pair.target].IsZero() || w.queued.Before(ages[pair.target]) {
				ages[pair.target] = w.queued
			}
		}
	}
	ids := make([]string, 0, len(byTarget[seed.target]))
	for id := range byTarget[seed.target] {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	list := make([]string, 0, len(byTarget))
	for target, metrics := range byTarget {
		if len(metrics) != len(ids) {
			continue
		}
		match := true
		for _, id := range ids {
			match = match && metrics[id]
		}
		if match {
			list = append(list, target)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		if ages[list[i]].Equal(ages[list[j]]) {
			return list[i] < list[j]
		}
		return ages[list[i]].Before(ages[list[j]])
	})
	q := base.query
	if base.rangeReuse {
		q = finiteRangeQuery(q, seedRange)
	}
	q.Targets = make([]sdk.ResourceMetricTarget, 0, min(len(list), base.maxTargets))
	q.MetricIDs = ids
	seenReferences := map[string]bool{}
	for _, id := range list {
		target := targets[id]
		reference := finiteTargetKey(target)
		if seenReferences[reference] {
			continue
		}
		seenReferences[reference] = true
		q.Targets = append(q.Targets, target)
		if len(q.Targets) == base.maxTargets {
			break
		}
	}
	key := metricStreamKey{base.spec.OwnerPluginID, base.spec.OwnerConnectionID}
	workCtx, cancel := context.WithTimeout(context.WithoutCancel(base.ctx), resourceMetricsTimeout)
	sourceKey := metricStreamKey{q.Source.PluginID, q.Source.ConnectionID}
	job := &finiteJob{partition: base.partition, query: q, pairs: finitePairs(q), waiters: map[*finiteWaiter]bool{}, cancel: cancel, key: key, epoch: base.epoch, sourceKey: sourceKey, sourceEpoch: base.sourceEpoch, configuration: base.configuration}
	job.configurationKeys = base.configurationKeys
	job.configurationSerial = base.configurationSerial
	job.configurationGuard = base.configurationGuard
	job.maxSampleAge = base.maxSampleAge
	job.rangeReuse = base.rangeReuse
	job.rangeToCurrentKey = base.rangeToCurrentKey
	for w := range f.pending {
		if w.partition == base.partition && w.ctx.Err() == nil {
			for pair := range job.pairs {
				if w.pairs[pair] && !w.done[pair] {
					if w.rangeReuse {
						span, overlaps := finiteIntersectSpan(finiteQuerySpan(w.query), finiteQuerySpan(q))
						if !overlaps || !finiteCompatibleGrid(finiteQuerySpan(w.query), finiteQuerySpan(q), q.Step) || !finiteSpanNeeded(w.rangeCoverage[pair], span, q.Step) {
							continue
						}
					}
					job.waiters[w] = true
					break
				}
			}
		}
	}
	f.jobs[job] = true
	telemetry.RecordPipelineDispatch(workCtx, base.queued, len(q.Targets), len(job.pairs))
	f.nextDispatch = now.Add(finiteDispatchInterval)
	go f.runJob(workCtx, job, base.spec)
}
func (f *finiteCoordinator) runJob(ctx context.Context, job *finiteJob, base MetricsObservationSpec) {
	defer job.cancel()
	defer f.releaseDiagnosticsIfStopped()
	spec := base
	spec.Targets = job.query.Targets
	spec.MetricIDs = job.query.MetricIDs
	spec.Shape, spec.DurationMs = job.query.Shape, 0
	spec.StartTime, spec.EndTime = job.query.StartTime, job.query.EndTime
	spec.StepMs = int(job.query.Step / time.Millisecond)
	admitted, _, err := f.c.admitFinite(ctx, spec)
	var response *sdk.ResourceMetricsResponse
	var guard func() error
	if err == nil {
		var projected sdk.ResourceMetricsQuery
		projected, guard, err = f.c.projectFinite(admitted, base.OwnerPluginID, base.OwnerConnectionID, job.query)
		err = finiteAuthorityError(err)
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
					err = finiteAuthorityError(guard())
				}
				if err == nil {
					err = finiteAuthorityError(job.configurationGuard())
				}
				if err == nil {
					started := time.Now()
					response, err = provider.QueryResources(pc, projected)
					telemetry.RecordPipelineProvider(telemetry.WithPlugin(ctx, job.query.Source.PluginID), "query", started, err)
					if err != nil {
						err = finiteProviderFailure{err}
					}
				}
			}
		}
	}
	if err == nil {
		err = finiteAuthorityError(guard())
	}
	if err == nil {
		err = finiteAuthorityError(job.configurationGuard())
	}
	if err == nil {
		err = sdk.ValidateResourceMetricsResponse(job.query, response)
	}
	if err == nil && job.rangeReuse {
		span := finiteQuerySpan(job.query)
		for _, result := range response.Results {
			if result.Status == "ok" && !finitePureRangeResult(result, span, job.query.Step) {
				err = finiteError("INVALID_REQUEST", "Range reuse requires pure, aligned point series.")
				break
			}
		}
	}
	var size int
	if err == nil {
		bytes, encodeErr := json.Marshal(response)
		size = len(bytes)
		if encodeErr != nil || size > finiteMaxBytes {
			err = finiteError("RESOURCE_LIMIT", "Metric response byte limit exceeded.")
		}
	}
	if err == nil {
		telemetry.RecordPipelineResponse(ctx, size, len(response.Results))
	}
	f.mu.Lock()
	if !f.jobs[job] {
		f.mu.Unlock()
		return
	}
	delete(f.jobs, job)
	// Cancellation may win before its reader goroutine detaches. Such readers
	// cannot authorize an otherwise abandoned result to enter completed reuse.
	for w := range job.waiters {
		if failure := w.ctx.Err(); failure != nil {
			delete(job.waiters, w)
			f.removeWaiterLocked(w)
			f.finishWaiter(w, failure)
		}
	}
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
			pair := finitePair{r.ResourceToken, r.MetricID}
			for w := range job.waiters {
				if w.pairs[pair] && !w.done[pair] {
					resultMap[pair] = r
					break
				}
			}
		}
		landed := time.Now()
		entry := finiteCacheEntry{partition: job.partition, pairs: resultMap, complete: response.Complete, warnings: response.Warnings, until: landed.Add(finiteCacheTTL), key: job.key, epoch: job.epoch, sourceKey: job.sourceKey, sourceEpoch: job.sourceEpoch, configuration: job.configuration, bytes: size}
		entry.configurationKeys = job.configurationKeys
		entry.rangeReuse = job.rangeReuse
		if job.rangeReuse {
			entry.start, entry.end = job.query.StartTime, job.query.EndTime
			entry.bytes += 64 // Account for the retained range descriptor.
		}
		if job.query.Shape == "range" && job.rangeToCurrentKey != "" {
			entry.rangeToCurrentKey = job.rangeToCurrentKey
			// A complete answer settles every grid point through the last one its
			// domain evaluates. Range-to-current reuse reads a gap or an omission
			// there as absence instead of falling back to an older sample. An
			// answer with no point settles only the grid points its source had
			// reached when it landed, never ones a later lookup finds in the past.
			entry.evaluated = finiteQuerySpan(job.query).end
			entry.reached = finiteReachedPoint(job.query, landed)
			entry.bytes += len(entry.rangeToCurrentKey) + 16
		}
		if job.query.Shape == "current" && job.maxSampleAge > 0 {
			for _, result := range resultMap {
				if result.ObservedAt != nil {
					expiry := result.ObservedAt.Add(job.maxSampleAge)
					if expiry.Before(entry.until) {
						entry.until = expiry
					}
				}
			}
		}
		total := entry.bytes
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
			if w.rangeReuse && finiteOperationalFailure(err) && !f.finiteRangeOwnsAnyLocked(w, job) {
				// A borrowed provider failure describes the job's domain, not this
				// reader's. The reader stays pending and fetches its own domain.
				continue
			}
			delete(f.pending, w)
			for other := range f.jobs {
				delete(other.waiters, w)
				if len(other.waiters) == 0 && !other.retired {
					other.retireLocked()
				}
			}
			f.finishWaiter(w, err)
			continue
		}
		if w.rangeReuse {
			// Recount before adding: a refresh can have dropped cache-served pairs
			// since this reader last assembled.
			w.recountRange()
		} else {
			w.complete = w.complete && response.Complete
			w.warnings = mergeFiniteWarnings(w.warnings, response.Warnings)
		}
		merged := false
		for pair := range job.pairs {
			if !w.pairs[pair] || w.done[pair] {
				continue
			}
			if w.rangeReuse {
				r, present := resultMap[pair]
				failure := f.acceptRangeResultLocked(w, job, pair, r, present, response.Complete, response.Warnings)
				if failure != nil {
					f.removeWaiterLocked(w)
					f.finishWaiter(w, failure)
					break
				}
				merged = true
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
		if merged && !w.finished {
			// One check per delivery, after every answer and warning of the job
			// has landed and before this reader can wait on anything else.
			if failure := w.checkRange(); failure != nil {
				f.removeWaiterLocked(w)
				f.finishWaiter(w, failure)
			}
		}
		if w.finished {
			continue
		}
		if w.missing == 0 {
			delete(f.pending, w)
			f.finishWaiter(w, nil)
		} else {
			f.progressWaiterLocked(w)
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
			f.cancelCatalogLocked(id, read)
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
			job.retireLocked()
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
	for id, read := range f.catalogs {
		f.cancelCatalogLocked(id, read)
	}
	clear(f.catalogs)
	for job := range f.jobs {
		job.retireLocked()
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
	clear(f.pending)
	clear(f.observations)
	f.cache = nil
	f.mu.Unlock()
	f.releaseDiagnosticsIfStopped()
	f.signal()
}
