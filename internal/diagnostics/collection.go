package diagnostics

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

type Options struct {
	Directory      string
	Identity       Identity
	Interval       time.Duration
	RemoteInterval time.Duration
	HistoryLimit   int
}
type exportJob struct {
	flush chan error
	ctx   context.Context
}
type Service struct {
	mu             sync.RWMutex
	opts           Options
	started        time.Time
	lastSuccess    time.Time
	samples        []Snapshot
	captures       map[string]*Capture
	timers         map[string]*time.Timer
	health         Health
	sequence       uint64
	remote         sdkmetric.Exporter
	remoteDisabled bool
	remoteFailure  error
	queue          chan exportJob
	pending        *metricdata.ResourceMetrics
	notify         chan struct{}
	cancel         context.CancelFunc
	done           chan struct{}
	closed         bool
}

func New(opts Options) (*Service, error) {
	if opts.HistoryLimit <= 0 {
		opts.HistoryLimit = 300
	}
	if opts.HistoryLimit > 600 {
		opts.HistoryLimit = 600
	}
	if opts.Interval <= 0 {
		opts.Interval = 2 * time.Second
	}
	opts.RemoteInterval = resolveRemoteInterval(opts.RemoteInterval)
	if opts.Identity.SessionID == "" {
		session, err := newSessionID()
		if err != nil {
			return nil, fmt.Errorf("create diagnostics session identity: %w", err)
		}
		opts.Identity.SessionID = session
	}
	s := &Service{opts: opts, started: time.Now(), samples: []Snapshot{}, captures: map[string]*Capture{}, timers: map[string]*time.Timer{}, health: Health{Complete: true}, queue: make(chan exportJob, 1), notify: make(chan struct{}, 1), done: make(chan struct{})}
	s.opts.Identity.ConfigScope = configScope
	s.opts.Identity.ConfigID = s.configIdentity(opts.Identity.ConfigID)
	if s.opts.Identity.SourceState == "" {
		s.opts.Identity.SourceState = "unknown"
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.forward(ctx)
	return s, nil
}
func (s *Service) SetRemote(exp sdkmetric.Exporter) { s.mu.Lock(); defer s.mu.Unlock(); s.remote = exp }
func (s *Service) SetConfigID(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.opts.Identity.ConfigID = s.configIdentity(id)
}
func (s *Service) SetRemoteEnabled(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.remoteDisabled = !enabled
	if !enabled {
		s.pending = nil
	}
}
func (s *Service) Temporality(k sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}
func (s *Service) Aggregation(k sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return sdkmetric.DefaultAggregationSelector(k)
}
func (s *Service) ForceFlush(ctx context.Context) error {
	result := make(chan error, 1)
	select {
	case <-s.done:
		return failure("closed", "diagnostics closed")
	case <-ctx.Done():
		return ctx.Err()
	case s.queue <- exportJob{flush: result, ctx: ctx}:
	}
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-s.done:
		return failure("closed", "diagnostics closed")
	}
}
func (s *Service) Shutdown(ctx context.Context) error { return s.closeWithContext(ctx) }
func (s *Service) recordError(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.health.Errors++
	s.health.LastError = message
	s.health.Complete = false
}
func safeAttributes(set attribute.Set) map[string]string {
	result := map[string]string{}
	for _, kv := range set.ToSlice() {
		key := string(kv.Key)
		switch key {
		case "operation", "outcome", "controller", "provider", "phase", "state", "kind", "status", "reason", "cache", "queue", "direction", "type", "event", "work", "cpu.mode", "go.memory.type", "domain", "rpc.system.name", "rpc.response.status_code":
		default:
			continue
		}
		value := kv.Value.AsString()
		if !safeProtocolDimension(key, value) {
			continue
		}
		if key == "go.memory.type" && value != "stack" && value != "other" {
			continue
		}
		if len(value) > 64 {
			continue
		}
		if len(result) < 8 {
			result[key] = value
		}
	}
	return result
}
func numeric[N int64 | float64](p metricdata.DataPoint[N]) Point {
	return Point{Attributes: safeAttributes(p.Attributes), Value: float64(p.Value), StartTime: p.StartTime}
}
func histogram[N int64 | float64](p metricdata.HistogramDataPoint[N]) Point {
	return Point{Attributes: safeAttributes(p.Attributes), Count: p.Count, Sum: float64(p.Sum), Bounds: append([]float64{}, p.Bounds...), BucketCounts: append([]uint64{}, p.BucketCounts...), StartTime: p.StartTime}
}
func convert(data *metricdata.ResourceMetrics) ([]Metric, bool) {
	metrics := []Metric{}
	truncated := false
	for _, scope := range data.ScopeMetrics {
		for _, m := range scope.Metrics {
			if len(metrics) >= 128 {
				truncated = true
				break
			}
			out := Metric{Name: m.Name, Description: m.Description, Unit: m.Unit, Points: []Point{}}
			switch d := m.Data.(type) {
			case metricdata.Gauge[int64]:
				out.Kind = "gauge"
				for _, p := range d.DataPoints {
					out.Points = append(out.Points, numeric(p))
				}
			case metricdata.Gauge[float64]:
				out.Kind = "gauge"
				for _, p := range d.DataPoints {
					out.Points = append(out.Points, numeric(p))
				}
			case metricdata.Sum[int64]:
				out.Kind = "counter"
				if !d.IsMonotonic {
					out.Kind = "gauge"
				}
				for _, p := range d.DataPoints {
					out.Points = append(out.Points, numeric(p))
				}
			case metricdata.Sum[float64]:
				out.Kind = "counter"
				if !d.IsMonotonic {
					out.Kind = "gauge"
				}
				for _, p := range d.DataPoints {
					out.Points = append(out.Points, numeric(p))
				}
			case metricdata.Histogram[int64]:
				out.Kind = "histogram"
				for _, p := range d.DataPoints {
					out.Points = append(out.Points, histogram(p))
				}
			case metricdata.Histogram[float64]:
				out.Kind = "histogram"
				for _, p := range d.DataPoints {
					out.Points = append(out.Points, histogram(p))
				}
			default:
				continue
			}
			metrics = append(metrics, out)
		}
	}
	return metrics, truncated
}
func (s *Service) Export(ctx context.Context, data *metricdata.ResourceMetrics) error {
	// OTel owns data buffers. Convert local values and deep-copy remote data before returning.
	metrics, truncated := convert(data)
	now := time.Now()
	var ambiguous, limited bool
	metrics, ambiguous, limited = unambiguousMetrics(metrics)
	truncated = truncated || limited
	encoded, err := json.Marshal(metrics)
	if err != nil {
		s.recordError("non-finite measurement rejected")
		return fmt.Errorf("invalid measurement: %w", err)
	}
	if len(encoded) > 256<<10 {
		s.recordError("sample exceeds 256 KiB limit")
		return fmt.Errorf("sample exceeds 256 KiB limit")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("diagnostics closed")
	}
	// Completeness describes this collection; lifetime counters remain cumulative.
	s.health.Complete = true
	s.health.LastError = ""
	if truncated || ambiguous {
		s.health.Dropped++
		s.health.Complete = false
		switch {
		case truncated && ambiguous:
			s.health.LastError = "ambiguous normalized series rejected; metric or series limit reached"
		case ambiguous:
			s.health.LastError = "ambiguous normalized metric series rejected"
		default:
			s.health.LastError = "metric or series limit reached"
		}
	}
	if len(s.samples) > 0 && now.Sub(s.samples[len(s.samples)-1].Timestamp) > s.opts.Interval*3 {
		s.health.Gaps++
		s.health.Complete = false
		s.health.LastError = "collection gap before this sample"
	}
	s.sequence++
	s.lastSuccess = now
	sample := Snapshot{SchemaVersion: SchemaVersion, Identity: s.opts.Identity, Sequence: s.sequence, Timestamp: now, ElapsedSeconds: now.Sub(s.started).Seconds(), Metrics: metrics, Health: s.health}
	s.samples = append(s.samples, sample)
	if len(s.samples) > s.opts.HistoryLimit {
		s.samples = s.samples[1:]
	}
	for _, c := range s.captures {
		if c.Status != "running" {
			continue
		}
		if len(c.Samples) >= 302 {
			c.Status = "incomplete"
			c.Error = "capture sample limit reached"
			c.Coverage.Complete = false
			c.EndedAt = now
			_ = s.persist(c)
			continue
		}
		c.Samples = append(c.Samples, sample)
		if len(c.Samples) == 1 {
			c.StartedAt = sample.Timestamp
		}
		c.ElapsedSeconds = sampledElapsed(c)
		c.Coverage = captureCoverage(c)
		if c.ElapsedSeconds >= float64(c.DurationSeconds) {
			c.Status = "complete"
			c.EndedAt = now
			if !c.Coverage.Complete {
				c.Status = "incomplete"
				if c.Coverage.LastError == "counter reset or endpoint unavailable" {
					c.Status = "reset"
				}
			}
		}
		if err := s.persist(c); err != nil {
			c.Status = "error"
			c.Error = "capture persistence failed or storage limit reached"
			c.Coverage.Complete = false
			c.Samples = c.Samples[:len(c.Samples)-1]
			_ = s.persist(c)
		}
		if c.Status != "running" {
			s.stopTimer(c.ID)
		}
	}
	if s.remote != nil && !s.remoteDisabled {
		owned := copyResource(data)
		s.pending = &owned
		select {
		case s.notify <- struct{}{}:
		default:
		}
	}
	s.mu.Unlock()
	return nil
}
func (s *Service) GetSnapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.samples) == 0 {
		health := s.health
		health.Complete = false
		if health.LastError == "" {
			health.LastError = "waiting for first collection"
		}
		return Snapshot{SchemaVersion: SchemaVersion, Identity: s.opts.Identity, Metrics: []Metric{}, Health: health}
	}
	out := clone(s.samples[len(s.samples)-1])
	out.Health = s.healthAt(time.Now())
	return out
}
func (s *Service) GetHistory() History {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clone(History{Samples: s.samples, Health: s.healthAt(time.Now())})
}
func (s *Service) GetCatalog() Catalog {
	s.mu.RLock()
	defer s.mu.RUnlock()
	metrics := []MetricDescriptor{}
	if len(s.samples) > 0 {
		current := s.samples[len(s.samples)-1].Metrics
		metrics = make([]MetricDescriptor, len(current))
		for i, metric := range current {
			metrics[i] = MetricDescriptor{Name: metric.Name, Description: metric.Description, Unit: metric.Unit, Kind: metric.Kind}
		}
	}
	return Catalog{SchemaVersion: SchemaVersion, Identity: s.opts.Identity, Metrics: metrics, Limits: Limits{HistorySamples: s.opts.HistoryLimit, CaptureCount: 20, CaptureSeconds: 300, ConcurrentCaptures: 2, DiskBytes: 64 << 20, Metrics: 128, SeriesPerMetric: 16, SampleBytes: 256 << 10, CaptureBytes: 8 << 20}}
}
func (s *Service) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.closeWithContext(ctx)
}
func (s *Service) closeWithContext(ctx context.Context) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	for id := range s.timers {
		s.stopTimer(id)
	}
	var first error
	for _, c := range s.captures {
		if c.Status == "running" {
			c.Status = "interrupted"
			c.EndedAt = time.Now()
			c.ElapsedSeconds = sampledElapsed(c)
			c.Coverage.Complete = false
			if err := s.persist(c); err != nil && first == nil {
				first = err
			}
		}
	}
	remote := s.remote
	s.mu.Unlock()
	if err := s.ForceFlush(ctx); err != nil && first == nil {
		first = err
	}
	s.cancel()
	<-s.done
	if remote != nil {
		// Honor the same caller deadline used to drain pending exports.
		if err := remote.Shutdown(ctx); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// stopTimer requires s.mu.
func (s *Service) stopTimer(id string) {
	if timer := s.timers[id]; timer != nil {
		timer.Stop()
		delete(s.timers, id)
	}
}

// healthAt requires s.mu. Reading stale state never changes timestamps or counters.
func (s *Service) healthAt(now time.Time) Health {
	health := s.health
	if s.lastSuccess.IsZero() {
		health.Complete = false
		if health.LastError == "" {
			health.LastError = "waiting for first collection"
		}
		return health
	}
	if now.Sub(s.lastSuccess) > 3*s.opts.Interval {
		health.Complete = false
		health.LastError = "collection stale: no recent successful sample"
		health.Gaps++
	}
	return health
}
