package grafana

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

const resourceChunk = 100

func samplePoint(pair []json.RawMessage) (metric.DataPoint, error) {
	var ts float64
	var raw string
	if len(pair) != 2 || json.Unmarshal(pair[0], &ts) != nil || json.Unmarshal(pair[1], &raw) != nil {
		return metric.DataPoint{}, errors.New("invalid sample encoding")
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || math.IsNaN(ts) || math.IsInf(ts, 0) || ts < 0 || ts > 253402300799 {
		return metric.DataPoint{}, errors.New("non-finite or invalid sample")
	}
	return metric.DataPoint{Timestamp: time.UnixMilli(int64(ts * 1000)), Value: v}, nil
}
func (p *Provider) QueryResources(ctx *metric.QueryContext, req metric.ResourceSetQueryRequest) (*metric.ResourceSetQueryResponse, error) {
	if ctx == nil || ctx.Context == nil {
		return nil, errors.New("provider query context required")
	}
	if req.Source.PluginID != "grafana" || req.Source.ConnectionID == "" || ctx.ConnectionID != req.Source.ConnectionID {
		return nil, errors.New("provider connection context mismatch")
	}
	call, done, beginErr := p.begin(ctx.Context)
	if beginErr != nil {
		return nil, beginErr
	}
	defer done()
	owned := *ctx
	owned.Context = call
	ctx = &owned
	if req.Source.DatasourceKind != "prometheus" {
		return nil, errors.New("only explicit Prometheus-compatible datasources supported")
	}
	if len(req.Resources) == 0 || len(req.Resources) > 1000 || len(req.MetricIDs) == 0 || len(req.MetricIDs) > 32 {
		return nil, errors.New("query requires 1..1000 resources and 1..32 metrics")
	}
	requested := map[string]bool{}
	for _, id := range req.MetricIDs {
		if requested[id] {
			return nil, errors.New("metric IDs must be unique")
		}
		requested[id] = true
	}
	for _, d := range req.Definitions {
		if requested[d.ID] {
			if err := validateResourceMapping(d, req.Resources, req.PublicScope, req.Shape); err != nil {
				var missing *fieldContextError
				if errors.As(err, &missing) {
					out := &metric.ResourceSetQueryResponse{}
					for _, resource := range req.Resources {
						for _, id := range req.MetricIDs {
							out.Results = append(out.Results, metric.ResourceMetricResult{ResourceToken: resource.Token, MetricID: id, Status: metric.MetricStatusInvalidContext, Provenance: metric.MetricProvenance{Source: req.Source, BindingID: req.BindingID}, MappingRevision: req.MappingRevision, Warnings: []string{err.Error()}})
						}
					}
					return out, nil
				}
				return nil, err
			}
		}
	}
	if req.Shape != metric.ShapeCurrent && req.Shape != metric.ShapeTimeseries {
		return nil, errors.New("mapping supports current or timeseries shape")
	}
	seen := map[string]bool{}
	for _, r := range req.Resources {
		if r.Token == "" || seen[r.Token] {
			return nil, errors.New("resource tokens must be nonempty and unique")
		}
		seen[r.Token] = true
	}
	tr, err := p.connection(req.Source.ConnectionID)
	if err != nil {
		return nil, err
	}
	defer tr.close()
	if tr.mode == "prometheus" && req.Source.DatasourceUID != "direct" {
		return nil, errors.New("direct connection datasource UID must be direct")
	}
	defs := map[string]metric.MetricDefinition{}
	for _, d := range req.Definitions {
		if _, ok := defs[d.ID]; ok {
			return nil, errors.New("duplicate mapping ID")
		}
		defs[d.ID] = d
	}
	end := req.EndTime
	if end.IsZero() {
		end = time.Now()
	}
	out := &metric.ResourceSetQueryResponse{}
	for _, id := range req.MetricIDs {
		d, ok := defs[id]
		if !ok {
			return nil, errors.New("resolved metric definition missing")
		}
		for start := 0; start < len(req.Resources); start += resourceChunk {
			stop := start + resourceChunk
			if stop > len(req.Resources) {
				stop = len(req.Resources)
			}
			resources := req.Resources[start:stop]
			expression, ids, err := compile(d, resources, req.PublicScope)
			if err != nil {
				return nil, err
			}
			baseResult := func(token string) metric.ResourceMetricResult {
				return metric.ResourceMetricResult{ResourceToken: token, MetricID: id, Status: metric.MetricStatusMissing, Provenance: metric.MetricProvenance{Source: req.Source, BindingID: req.BindingID}, MappingRevision: req.MappingRevision}
			}
			response, qerr := tr.query(ctx, req.Source.DatasourceUID, expression, req.StartTime, end, req.Step, req.Shape == metric.ShapeTimeseries)
			if qerr != nil {
				status := metric.MetricStatusFailed
				var he *HTTPError
				if errors.As(qerr, &he) && he.Denied() {
					status = metric.MetricStatusDenied
				}
				for _, resource := range resources {
					result := baseResult(resource.Token)
					result.Status = status
					result.Warnings = []string{qerr.Error()}
					out.Results = append(out.Results, result)
				}
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				continue
			}
			chunk := []metric.ResourceMetricResult{}
			tuples := map[string]int{}
			matched := map[string]bool{}
			for _, series := range response.Data.Result {
				key, identityErr := identity(series.Metric, d.IdentityLabels)
				if identityErr != nil {
					out.Warnings = append(out.Warnings, identityErr.Error())
					continue
				}
				token, exists := ids[key]
				if !exists {
					continue
				}
				matched[token] = true
				dimensionKey, dimensionErr := identity(series.Metric, d.Dimensions)
				if dimensionErr != nil {
					dimensionKey = "!missing"
				}
				tuple := strconv.Quote(token) + "|" + dimensionKey
				if index, duplicate := tuples[tuple]; duplicate {
					chunk[index].Status = metric.MetricStatusFailed
					chunk[index].Value = nil
					chunk[index].Warnings = append(chunk[index].Warnings, "duplicate resource, metric and declared dimension identity")
					continue
				}
				tuples[tuple] = len(chunk)
				chunk = append(chunk, baseResult(token))
				result := &chunk[len(chunk)-1]
				if dimensionErr != nil {
					result.Status = metric.MetricStatusFailed
					result.Warnings = []string{"missing required declared dimension: " + dimensionErr.Error()}
					continue
				}
				if len(d.Dimensions) > 0 {
					result.Dimensions = make(map[string]string, len(d.Dimensions))
					for _, dimension := range d.Dimensions {
						result.Dimensions[dimension] = series.Metric[dimension]
					}
				}
				result.Warnings = append(result.Warnings, response.Warnings...)
				pairs := series.Values
				if req.Shape == metric.ShapeCurrent {
					pairs = [][]json.RawMessage{series.Value}
				}
				if len(pairs) == 0 {
					continue
				}
				points := make([]metric.DataPoint, 0, len(pairs))
				for _, pair := range pairs {
					point, sampleErr := samplePoint(pair)
					if sampleErr == nil {
						sampleErr = validateSampleTime(point.Timestamp, req, end, time.Now())
					}
					if sampleErr != nil {
						result.Warnings = append(result.Warnings, sampleErr.Error())
						continue
					}
					if len(points) > 0 && !point.Timestamp.After(points[len(points)-1].Timestamp) {
						result.Warnings = append(result.Warnings, "samples must have strictly increasing timestamps")
						continue
					}
					point.Labels = series.Metric
					points = append(points, point)
				}
				if len(points) == 0 {
					result.Status = metric.MetricStatusFailed
					continue
				}
				last := points[len(points)-1]
				result.ObservedAt = last.Timestamp
				result.ExpiresAt = last.Timestamp.Add(5 * time.Minute)
				result.Status = metric.MetricStatusOK
				if len(result.Warnings) > 0 || len(points) != len(pairs) {
					result.Status = metric.MetricStatusPartial
				}
				if last.Timestamp.Before(end.Add(-5 * time.Minute)) {
					result.Status = metric.MetricStatusStale
					result.Warnings = append(result.Warnings, "sample older than five minutes")
				}
				if req.Shape == metric.ShapeCurrent {
					result.Value = &metric.MetricResult{CurrentValue: &metric.CurrentValue{MetricID: id, Value: last.Value, Timestamp: last.Timestamp, Labels: series.Metric}}
				} else {
					result.Value = &metric.MetricResult{TimeSeries: &metric.TimeSeries{MetricID: id, DataPoints: points, Labels: series.Metric}}
				}
			}
			for _, resource := range resources {
				if !matched[resource.Token] {
					result := baseResult(resource.Token)
					result.Warnings = append(result.Warnings, response.Warnings...)
					result.Warnings = append(result.Warnings, "no matching series; check exporter and identity labels")
					chunk = append(chunk, result)
				}
			}
			out.Results = append(out.Results, chunk...)
		}
	}
	return out, nil
}

// Instant samples allow at most two seconds of evaluation/clock skew. Matrix
// samples must lie within the requested closed interval without that allowance.
func validateSampleTime(sample time.Time, req metric.ResourceSetQueryRequest, end, now time.Time) error {
	if sample.After(now.Add(2 * time.Second)) {
		return errors.New("sample timestamp exceeds current time by more than two seconds")
	}
	if req.Shape == metric.ShapeTimeseries {
		if sample.Before(req.StartTime) || sample.After(end) {
			return errors.New("matrix sample outside requested time range")
		}
	} else if sample.After(end.Add(2 * time.Second)) {
		return errors.New("sample timestamp exceeds requested evaluation time by more than two seconds")
	}
	return nil
}
