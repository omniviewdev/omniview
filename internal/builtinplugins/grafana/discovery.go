package grafana

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

var metricName = regexp.MustCompile(`^[a-zA-Z_:][a-zA-Z0-9_:]*$`)

// DiscoverMetricLabels applies exact matchers only. It never accepts raw selector syntax.
func (p *Provider) DiscoverMetricLabels(ctx *metric.QueryContext, req metric.MetricDiscoveryRequest) (*metric.MetricDiscoveryResult, error) {
	if ctx == nil || ctx.Context == nil || ctx.ConnectionID != req.Source.ConnectionID || req.Source.PluginID != "grafana" {
		return nil, errors.New("provider discovery context mismatch")
	}
	if req.Limit < 1 || req.Limit > 100 {
		return nil, errors.New("discovery limit must be 1..100")
	}
	if req.Source.DatasourceKind != "" && req.Source.DatasourceKind != "prometheus" {
		return nil, errors.New("only Prometheus datasource discovery supported")
	}
	if len(req.Matchers) > 8 {
		return nil, errors.New("discovery supports at most eight exact matchers")
	}
	end := req.EndTime
	if end.IsZero() {
		end = time.Now()
	}
	start := req.StartTime
	if start.IsZero() {
		start = end.Add(-time.Hour)
	}
	if !end.After(start) || end.Sub(start) > 24*time.Hour {
		return nil, errors.New("discovery time range must be positive and at most 24 hours")
	}
	if req.MetricName != "" && !metricName.MatchString(req.MetricName) {
		return nil, errors.New("invalid metric name")
	}
	keys := make([]string, 0, len(req.Matchers))
	for key, v := range req.Matchers {
		if !labelName.MatchString(key) || len(v) == 0 || len(v) > 1024 {
			return nil, errors.New("discovery matchers need valid labels and bounded nonempty values")
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	matchers := make([]string, 0, len(keys)+1)
	for _, key := range keys {
		matchers = append(matchers, key+"="+strconv.Quote(req.Matchers[key]))
	}
	if req.MetricName != "" {
		matchers = append(matchers, "__name__="+strconv.Quote(req.MetricName))
	}
	suffix := "labels"
	if req.LabelName != "" {
		if !labelName.MatchString(req.LabelName) {
			return nil, errors.New("invalid discovery label")
		}
		suffix = "label/" + req.LabelName + "/values"
	}
	params := url.Values{"start": {fmt.Sprintf("%.3f", float64(start.UnixMilli())/1000)}, "end": {fmt.Sprintf("%.3f", float64(end.UnixMilli())/1000)}, "limit": {strconv.Itoa(req.Limit + 1)}}
	if len(matchers) > 0 {
		params.Set("match[]", "{"+strings.Join(matchers, ",")+"}")
	}
	t, err := p.connection(req.Source.ConnectionID)
	if err != nil {
		return nil, err
	}
	defer t.close()
	if t.mode == "prometheus" && req.Source.DatasourceUID != "direct" {
		return nil, errors.New("direct datasource UID must be direct")
	}
	path, err := t.apiPath(req.Source.DatasourceUID, suffix)
	if err != nil {
		return nil, err
	}
	call, done, err := p.begin(ctx.Context)
	if err != nil {
		return nil, err
	}
	defer done()
	var raw struct {
		Status   string   `json:"status"`
		Data     []string `json:"data"`
		Warnings []string `json:"warnings"`
	}
	if err = t.get(call, path, params, &raw); err != nil {
		return nil, err
	}
	if raw.Status != "success" {
		return nil, errors.New("label discovery rejected; check permission and datasource compatibility")
	}
	result := &metric.MetricDiscoveryResult{Values: []string{}, Truncated: len(raw.Data) > req.Limit}
	if result.Truncated {
		raw.Data = raw.Data[:req.Limit]
	}
	for _, v := range raw.Data {
		if len(v) > 1024 {
			return nil, errors.New("discovery value exceeds 1024 bytes")
		}
		if t.token != "" && strings.Contains(v, t.token) {
			return nil, errors.New("discovery returned unsafe credential material")
		}
		result.Values = append(result.Values, v)
	}
	if len(raw.Warnings) > 16 {
		raw.Warnings = raw.Warnings[:16]
	}
	for _, w := range raw.Warnings {
		if t.token != "" {
			w = strings.ReplaceAll(w, t.token, "[redacted]")
		}
		if len(w) > 512 {
			w = w[:512]
		}
		result.Warnings = append(result.Warnings, w)
	}
	if result.Truncated {
		result.Warnings = append(result.Warnings, "Discovery truncated; narrow metric and exact identity matchers.")
	}
	return result, nil
}

var _ metric.MetricDiscoveryProvider = (*Provider)(nil)
