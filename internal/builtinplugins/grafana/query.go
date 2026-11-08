package grafana

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

func samplePoint(pair []json.RawMessage) (metric.DataPoint, error) {
	var ts float64
	var raw string
	if len(pair) != 2 || json.Unmarshal(pair[0], &ts) != nil || json.Unmarshal(pair[1], &raw) != nil {
		return metric.DataPoint{}, errors.New("invalid sample encoding")
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || math.IsNaN(ts) || math.IsInf(ts, 0) || ts < 0 || ts > 253402300799 {
		return metric.DataPoint{}, errors.New("invalid finite sample")
	}
	return metric.DataPoint{Timestamp: time.UnixMilli(int64(ts * 1000)), Value: v}, nil
}
func validateSampleTime(t time.Time, q metric.ResourceMetricsQuery, end, now time.Time) error {
	if t.After(now.Add(2*time.Second)) || t.After(end.Add(2*time.Second)) {
		return errors.New("sample timestamp exceeds evaluation time")
	}
	if q.Shape == "range" && (t.Before(q.StartTime) || t.After(end)) {
		return errors.New("sample outside requested range")
	}
	return nil
}
func (p *Provider) GetResourceMetricsCatalog(ctx *types.PluginContext, req metric.ResourceMetricsCatalogRequest) (*metric.ResourceMetricsCatalog, error) {
	if req.Source.Native || req.Source.PluginID != "grafana" || req.Source.ConnectionID == "" || req.Source.DatasourceKind != "prometheus" {
		return nil, errors.New("explicit Grafana Prometheus source required")
	}
	if _, err := p.GetDataSources(ctx, req.Source); err != nil {
		return nil, err
	}
	out := &metric.ResourceMetricsCatalog{Source: req.Source, MaxTargets: metric.MaxFiniteTargets}
	defs := req.Context.Definitions
	for _, d := range defs {
		for _, key := range d.ResourceKeys {
			if key == req.ResourceKey {
				if err := definitionError(d); err != nil {
					return nil, err
				}
				// The host clears owner declarations on effective-definition edits.
				// This provider implements pure, grid-aligned point evaluations;
				// it does not infer independence by parsing arbitrary query text.
				out.Metrics = append(out.Metrics, metric.FiniteMetricDescriptor{ID: d.ID, Name: d.Name, ResourceKey: key, Unit: d.Unit, Shapes: d.SupportedShapes, RangeReuse: d.RangeReuse})
			}
		}
	}
	return out, nil
}
func (p *Provider) QueryResources(ctx *types.PluginContext, q metric.ResourceMetricsQuery) (*metric.ResourceMetricsResponse, error) {
	if ctx == nil || ctx.Context == nil {
		return nil, errors.New("query context required")
	}
	if q.Source.Native || q.Source.PluginID != "grafana" || q.Source.ConnectionID == "" || q.Source.DatasourceKind != "prometheus" {
		return nil, errors.New("explicit Grafana Prometheus source required")
	}
	if err := metric.ValidateResourceMetricsQuery(q); err != nil {
		return nil, err
	}
	call, done, err := p.begin(ctx.Context)
	if err != nil {
		return nil, err
	}
	defer done()
	tr, err := p.connection(q.Source.ConnectionID)
	if err != nil {
		return nil, err
	}
	defer tr.close()
	if tr.mode == "prometheus" && q.Source.DatasourceUID != "direct" {
		return nil, errors.New("direct datasource UID must be direct")
	}
	defs := map[string]metric.MetricDefinition{}
	for _, d := range q.Context.Definitions {
		if _, ok := defs[d.ID]; ok {
			return nil, errors.New("duplicate mapping ID")
		}
		defs[d.ID] = d
	}
	end := q.EndTime
	if end.IsZero() {
		end = time.Now()
	}
	out := &metric.ResourceMetricsResponse{Complete: true}
	pointCount := 0
	for _, id := range q.MetricIDs {
		d, ok := defs[id]
		if !ok {
			return nil, errors.New("resolved metric definition missing")
		}
		mappingErr := validateResourceMapping(d, q.Targets, q.Context.PublicScope, q.Shape)
		indices := map[string]int{}
		for _, target := range q.Targets {
			indices[target.Token] = len(out.Results)
			out.Results = append(out.Results, metric.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "missing", IdentityScope: "name"})
		}
		fail := func(status, message string) {
			for _, index := range indices {
				out.Results[index].Status = status
				out.Results[index].Message = message
				out.Results[index].Value = nil
				out.Results[index].Points = nil
			}
		}
		if mappingErr != nil {
			status := "invalid_mapping"
			var field *fieldContextError
			if errors.As(mappingErr, &field) {
				status = "invalid_context"
			}
			fail(status, mappingErr.Error())
			continue
		}
		expression, identities, err := compile(d, q.Targets, q.Context.PublicScope)
		if err != nil {
			return nil, err
		}
		response, err := tr.query(call, q.Source.DatasourceUID, expression, q.StartTime, end, q.Step, q.Shape == "range")
		if err != nil {
			if call.Err() != nil {
				return nil, call.Err()
			}
			status := "failed"
			var httpErr *HTTPError
			if errors.As(err, &httpErr) && httpErr.Denied() {
				status = "denied"
			}
			fail(status, err.Error())
			continue
		}
		seen := map[string]bool{}
		for _, series := range response.Data.Result {
			key, err := identity(series.Metric, d.IdentityLabels)
			if err != nil {
				out.Warnings = append(out.Warnings, err.Error())
				continue
			}
			token, ok := identities[key]
			if !ok {
				continue
			}
			r := &out.Results[indices[token]]
			if seen[token] {
				r.Status = "ambiguous"
				r.Value = nil
				r.Points = nil
				r.ObservedAt = nil
				r.Message = "multiple series for one target; use explicit unit-preserving aggregation"
				continue
			}
			seen[token] = true
			dimensions := map[string]string{}
			bad := false
			for _, name := range d.Dimensions {
				value := series.Metric[name]
				if value == "" {
					bad = true
				}
				dimensions[name] = value
			}
			if bad {
				r.Status = "failed"
				r.Message = "missing declared dimension"
				continue
			}
			r.Dimensions = dimensions
			pairs := series.Values
			if q.Shape == "current" {
				pairs = [][]json.RawMessage{series.Value}
			}
			if q.Shape == "range" {
				pointCount += len(pairs)
				if pointCount > metric.MaxFinitePoints {
					return nil, errors.New("finite response sample limit exceeded")
				}
			}
			var previous time.Time
			for _, pair := range pairs {
				point, err := samplePoint(pair)
				if err == nil {
					err = validateSampleTime(point.Timestamp, q, end, time.Now())
				}
				if err != nil || (!previous.IsZero() && !point.Timestamp.After(previous)) {
					bad = true
					break
				}
				previous = point.Timestamp
				value := point.Value
				if q.Shape == "current" {
					r.Value = &value
				} else {
					r.Points = append(r.Points, metric.ResourceMetricPoint{Time: point.Timestamp, Value: &value})
				}
			}
			if bad {
				r.Status = "failed"
				r.Value = nil
				r.Points = nil
				r.Message = "invalid source samples"
				continue
			}
			// PromQL returns evaluation timestamps, not underlying source sample age.
			if previous.IsZero() {
				continue
			}
			r.Status = "ok"
		}
		out.Warnings = append(out.Warnings, response.Warnings...)
	}
	return out, nil
}
