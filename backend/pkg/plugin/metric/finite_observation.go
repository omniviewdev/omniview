package metric

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type finiteObservation struct {
	coordinator        *finiteCoordinator
	owner              invocation.Request
	spec               MetricsObservationSpec
	configurationKeys  []finiteConfigurationKey
	configurationEpoch uint64
	snapshot           MetricsObservationSnapshot
	ctx                context.Context
	cancel             context.CancelFunc
	emit               func(MetricsObservationSnapshot)
	attached           bool
	ready              bool
	running            bool
	refresh            bool
	due                time.Time
	expires            time.Time
	dataBytes          int
	publishMu          sync.Mutex
	waiter             *finiteWaiter
	lastPublished      uint64
}

func (o *finiteObservation) publish() {
	o.publishMu.Lock()
	defer o.publishMu.Unlock()
	f := o.coordinator
	f.mu.Lock()
	snapshot, emit, attached := o.snapshot, o.emit, o.attached
	f.mu.Unlock()
	if attached && emit != nil && snapshot.Sequence > o.lastPublished {
		o.lastPublished = snapshot.Sequence
		emit(snapshot)
	}
}
func (f *finiteCoordinator) forgetObservationLocked(key string, o *finiteObservation) {
	o.cancel()
	f.snapshotBytes -= o.dataBytes
	o.dataBytes = 0
	delete(f.observations, key)
}
func finiteObservationKey(owner invocation.Request, token string) string {
	return owner.Principal().Owner() + "\x00" + owner.Principal().Generation() + "\x00" + token
}
func validateClientToken(token string) error {
	if len(token) < 1 || len(token) > 128 || !utf8.ValidString(token) || strings.ContainsAny(token, "\x00\r\n") {
		return finiteError("INVALID_REQUEST", "Client token must contain 1..128 UTF-8 bytes without NUL or line breaks.")
	}
	return nil
}

// OpenMetricsObservation reserves an observation in the authenticated caller's
// session without collecting samples. Open resolves the admitted selected catalog;
// Attach is the sample collection activation barrier.
// Pending reservations expire after 30 seconds. Close-before-Open tombstones
// last 30 seconds and suppress late registration; use a new token to reopen.
// Session lifetime must outlive this finite RPC; disconnect calls RetireMetricsSession.
// At most 512 reservations/active observations and 16 MiB of displayed samples
// are retained. Client-token tombstones are bounded to 1024 entries. The emit
// callback is a native transport sink; it must not synchronously retire the
// observation's source connection (publication drains before source retirement).
func (c *controller) OpenMetricsObservation(ctx context.Context, request OpenMetricsObservationRequest, emit func(MetricsObservationSnapshot)) (MetricsObservationSnapshot, error) {
	ctx, finish := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer finish()
	if err := validateClientToken(request.ClientToken); err != nil {
		return MetricsObservationSnapshot{}, err
	}
	if len(request.Spec.Targets) == 0 || len(request.Spec.Targets) > sdk.MaxFiniteTargets || len(request.Spec.MetricIDs) == 0 || len(request.Spec.MetricIDs) > sdk.MaxFiniteMetrics {
		return MetricsObservationSnapshot{}, finiteError("RESOURCE_LIMIT", "Observation target or metric count is outside bounds.")
	}
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return MetricsObservationSnapshot{}, err
	}
	request.Spec = copyJSON(request.Spec)
	for i := range request.Spec.Targets {
		// Caller projections never become retained host authority.
		request.Spec.Targets[i].PublicData = nil
	}
	life, cancel := context.WithCancel(context.WithoutCancel(ctx))
	if lifetime, ok := ctx.Value(metricSessionLifetimeKey{}).(context.Context); ok {
		stop := context.AfterFunc(lifetime, cancel)
		context.AfterFunc(life, func() { stop() })
	}
	f := c.finiteCoordinator()
	lane := metricStreamKey{request.Spec.OwnerPluginID, request.Spec.OwnerConnectionID}
	key := finiteObservationKey(owner, request.ClientToken)
	f.mu.Lock()
	if err := ctx.Err(); err != nil {
		f.mu.Unlock()
		cancel()
		return MetricsObservationSnapshot{}, err
	}
	if f.stopped || f.blocked[lane] > 0 {
		f.mu.Unlock()
		cancel()
		return MetricsObservationSnapshot{}, profileChangingError()
	}
	if until, closed := f.tombstones[key]; closed && time.Now().Before(until) {
		f.mu.Unlock()
		cancel()
		return MetricsObservationSnapshot{}, finiteError("CANCELLED", "Observation was closed before registration.")
	}
	if f.observations[key] != nil {
		f.mu.Unlock()
		cancel()
		return MetricsObservationSnapshot{}, finiteError("CONFLICT", "Observation token is already registered.")
	}
	if len(f.observations) >= finiteMaxInterests {
		f.mu.Unlock()
		cancel()
		return MetricsObservationSnapshot{}, finiteError("RESOURCE_LIMIT", "Observation limit exceeded.")
	}
	f.generation++
	snapshot := MetricsObservationSnapshot{ClientToken: request.ClientToken, Generation: f.generation, Sequence: 1}
	if request.Spec.Shape == "range" && request.Spec.DurationMs == 0 {
		start, end := request.Spec.StartTime, request.Spec.EndTime
		snapshot.DomainStart = &start
		snapshot.DomainEnd = &end
	}
	observation := &finiteObservation{coordinator: f, owner: owner, spec: request.Spec, snapshot: snapshot, ctx: life, cancel: cancel, emit: emit, expires: time.Now().Add(finitePendingTTL)}
	epoch := f.epochs[lane]
	configurationEpoch := observation.configurationEpoch
	f.observations[key] = observation
	f.mu.Unlock()
	f.signal()
	accepted := false
	defer func() {
		if !accepted {
			f.mu.Lock()
			if f.observations[key] == observation {
				f.forgetObservationLocked(key, observation)
			}
			f.mu.Unlock()
			cancel()
		}
	}()
	// Reserve before I/O so Close/session disconnect also cancel a still-pending
	// Open, including its reference admission and shared catalog reader interest.
	stopOpen := context.AfterFunc(life, finish)
	defer stopOpen()
	admitted, query, err := c.admitFinite(ctx, request.Spec)
	if err != nil {
		return MetricsObservationSnapshot{}, err
	}
	if !owner.OwnedBy(admitted) {
		return MetricsObservationSnapshot{}, finiteError("DENIED", "Reference admission changed observation ownership.")
	}
	catalog, err := c.selectedResourceMetricsCatalog(admitted, ResourceMetricsCatalogRequest{OwnerPluginID: request.Spec.OwnerPluginID, OwnerConnectionID: request.Spec.OwnerConnectionID, ResourceKey: request.Spec.ResourceKey, BindingID: request.Spec.BindingID, Source: request.Spec.Source}, observation)
	if err != nil {
		return MetricsObservationSnapshot{}, err
	}
	if err = validateFiniteSelection(query, catalog); err != nil {
		return MetricsObservationSnapshot{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.observations[key] != observation || life.Err() != nil {
		return MetricsObservationSnapshot{}, finiteError("CANCELLED", "Observation closed while Open was pending.")
	}
	if err := ctx.Err(); err != nil {
		return MetricsObservationSnapshot{}, err
	}
	if f.stopped || f.blocked[lane] > 0 || f.epochs[lane] != epoch || observation.configurationEpoch != configurationEpoch {
		return MetricsObservationSnapshot{}, profileChangingError()
	}
	observation.snapshot.Catalog = cloneFiniteCatalog(catalog)
	observation.ready = true
	snapshot = observation.snapshot
	snapshot.Catalog = cloneFiniteCatalog(snapshot.Catalog)
	accepted = true
	return snapshot, nil
}

// AttachMetricsObservation activates collection after the caller handles Open.
// It is idempotent within the same session. No result event is emitted before
// Attach; other sessions cannot attach even when they know the client token.
func (c *controller) AttachMetricsObservation(ctx context.Context, token string) error {
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return err
	}
	f := c.finiteCoordinator()
	f.mu.Lock()
	o := f.observations[finiteObservationKey(owner, token)]
	if o == nil || !o.owner.OwnedBy(ctx) {
		f.mu.Unlock()
		return finiteError("NOT_FOUND", "Observation is not owned by this session.")
	}
	if !o.ready {
		f.mu.Unlock()
		return finiteError("INVALID_REQUEST", "Wait for Open acknowledgement before Attach.")
	}
	if !o.attached {
		o.attached = true
		o.due = time.Now()
		o.expires = time.Time{}
	}
	f.mu.Unlock()
	f.signal()
	return nil
}

// CloseMetricsObservation closes pending or active work and is idempotent.
// Cancellation affects a shared provider request only after its final reader
// leaves. Bounded tombstones also cover Close arriving before Open registration.
func (c *controller) CloseMetricsObservation(ctx context.Context, token string) error {
	if err := validateClientToken(token); err != nil {
		return err
	}
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return err
	}
	f := c.finiteCoordinator()
	key := finiteObservationKey(owner, token)
	f.mu.Lock()
	defer f.mu.Unlock()
	if o := f.observations[key]; o != nil {
		if !o.owner.OwnedBy(ctx) {
			return finiteError("DENIED", "Observation is not owned by this session.")
		}
		f.forgetObservationLocked(key, o)
	}
	if _, exists := f.tombstones[key]; !exists && len(f.tombstones) >= 2*finiteMaxInterests {
		return finiteError("RESOURCE_LIMIT", "Observation close tombstone limit exceeded.")
	}
	f.tombstones[key] = time.Now().Add(finitePendingTTL)
	f.signal()
	return nil
}

// RefreshMetricsObservation bypasses completed cache, but joins compatible
// in-flight collection. It does not change other observers' polling deadlines.
func (c *controller) RefreshMetricsObservation(ctx context.Context, token string) error {
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return err
	}
	f := c.finiteCoordinator()
	f.mu.Lock()
	defer f.mu.Unlock()
	o := f.observations[finiteObservationKey(owner, token)]
	if o == nil || !o.owner.OwnedBy(ctx) {
		return finiteError("NOT_FOUND", "Observation is not owned by this session.")
	}
	if !o.attached {
		return finiteError("INVALID_REQUEST", "Attach observation before refreshing.")
	}
	// Upgrade cache-served pairs in an active waiter while preserving its current
	// in-flight interests. A settled/preparing read instead queues/consumes the
	// refresh flag, so manual refresh never gets mistaken for a cache delivery.
	if !o.running || o.waiter == nil || o.waiter.finished {
		o.refresh = true
		f.signal()
		return nil
	}
	for pair := range o.waiter.cachedPairs {
		delete(o.waiter.results, pair)
		delete(o.waiter.done, pair)
		o.waiter.missing++
		delete(o.waiter.cachedPairs, pair)
	}
	f.pending[o.waiter] = true
	f.signal()
	return nil
}

// RetireMetricsSession is a native-only disconnect hook. It removes exactly the
// host-issued session's observations and tombstones, never another window's.
func (c *controller) RetireMetricsSession(ctx context.Context) {
	owner, err := finiteIdentity(ctx)
	if err != nil {
		return
	}
	f := c.finiteCoordinator()
	prefix := owner.Principal().Owner() + "\x00" + owner.Principal().Generation() + "\x00"
	f.mu.Lock()
	defer f.mu.Unlock()
	for key, o := range f.observations {
		if strings.HasPrefix(key, prefix) {
			f.forgetObservationLocked(key, o)
		}
	}
	for key := range f.tombstones {
		if strings.HasPrefix(key, prefix) {
			delete(f.tombstones, key)
		}
	}
}
func (f *finiteCoordinator) pollObservations() {
	now := time.Now()
	var start []*finiteObservation
	f.mu.Lock()
	for key, o := range f.observations {
		if o.ctx.Err() != nil {
			f.forgetObservationLocked(key, o)
			continue
		}
		if !o.attached {
			if !now.Before(o.expires) {
				f.forgetObservationLocked(key, o)
			}
			continue
		}
		if !f.configurationCurrentLocked(o.configurationKeys, f.configurationSerial) {
			continue
		}
		due := !o.due.IsZero() && !now.Before(o.due)
		if o.running || (!o.refresh && !due) {
			continue
		}
		if due {
			o.due = time.Time{}
			if o.spec.IntervalMs > 0 {
				o.due = now.Add(time.Duration(o.spec.IntervalMs) * time.Millisecond)
			}
		}
		o.running = true
		o.snapshot.Fetching = true
		o.snapshot.Error = ""
		o.snapshot.Sequence++
		start = append(start, o)
	}
	f.mu.Unlock()
	for _, o := range start {
		o.publish()
		go f.collectObservation(o)
	}
}
func (f *finiteCoordinator) collectObservation(o *finiteObservation) {
	f.mu.Lock()
	refresh := o.refresh
	epoch := o.configurationEpoch
	o.refresh = false
	f.mu.Unlock()
	ctx, cancel := context.WithTimeout(o.ctx, resourceMetricsTimeout)
	defer cancel()
	var catalog *sdk.ResourceMetricsCatalog
	spec, err := resolveFiniteRange(o.spec, time.Now())
	var data *sdk.ResourceMetricsResponse
	if err == nil {
		data, err = f.c.readFiniteCatalog(ctx, spec, refresh, func(actual *sdk.ResourceMetricsCatalog) { catalog = actual }, o)
	}
	size := 0
	if err == nil {
		encoded, failure := json.Marshal(data)
		if failure != nil {
			err = failure
		} else {
			size = len(encoded)
		}
	}
	f.mu.Lock()
	key := finiteObservationKey(o.owner, o.snapshot.ClientToken)
	if f.observations[key] != o || o.ctx.Err() != nil {
		f.mu.Unlock()
		return
	}
	if o.configurationEpoch != epoch {
		o.waiter = nil
		o.running = false
		o.refresh = true
		o.snapshot.Fetching = false
		f.mu.Unlock()
		f.signal()
		return
	}
	o.waiter = nil
	if err == nil && f.snapshotBytes-o.dataBytes+size > 16<<20 {
		err = finiteError("RESOURCE_LIMIT", "Metric observation snapshot byte budget exceeded.")
	}
	f.snapshotBytes -= o.dataBytes
	o.dataBytes = 0
	if err == nil {
		o.dataBytes = size
		f.snapshotBytes += size
	}
	o.running = false
	o.snapshot.Fetching = false
	o.snapshot.Sequence++
	if err != nil {
		o.snapshot.Error = err.Error()
		o.snapshot.Data = nil
		o.snapshot.Catalog = nil
		o.snapshot.Invalidated = true
		if o.spec.DurationMs > 0 {
			o.snapshot.DomainStart = nil
			o.snapshot.DomainEnd = nil
		}
	} else {
		o.snapshot.Data = data
		o.snapshot.Catalog = cloneFiniteCatalog(catalog)
		o.snapshot.Error = ""
		o.snapshot.Invalidated = false
		if spec.Shape == "range" {
			start, end := spec.StartTime, spec.EndTime
			o.snapshot.DomainStart = &start
			o.snapshot.DomainEnd = &end
		}
	}
	// Polling deadlines advance when due, not when another observer or a manual
	// refresh finishes. Each observer therefore retains its independent cadence.
	f.mu.Unlock()
	f.signal()
	o.publish()
}
