package grafana

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

var labelName = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
var placeholder = regexp.MustCompile(`\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}`)

func zeroTime() time.Time               { return time.Time{} }
func nowTime() time.Time                { return time.Now() }
func escapeMatcher(value string) string { q := strconv.Quote(value); return q[1 : len(q)-1] }
func definitionError(d metric.MetricDefinition) error {
	if d.ID == "" || len(d.ID) > 128 || d.QueryLanguage != "promql" || len(d.Query) == 0 || len(d.Query) > 32768 {
		return errors.New("mapping needs stable ID and bounded PromQL query")
	}
	if len(d.Dimensions) > 8 {
		return errors.New("mapping supports at most eight declared dimensions")
	}
	dimensions := map[string]bool{}
	for _, dimension := range d.Dimensions {
		if !labelName.MatchString(dimension) || dimensions[dimension] {
			return errors.New("declared dimensions must be valid unique labels")
		}
		dimensions[dimension] = true
	}
	if len(d.FieldBindings) == 0 || len(d.FieldBindings) > 16 {
		return errors.New("mapping requires 1..16 typed bindings")
	}
	identities := map[string]bool{}
	for _, label := range d.IdentityLabels {
		if identities[label] {
			return errors.New("duplicate identity label")
		}
		identities[label] = true
	}
	switch d.Unit {
	case "cores", "bytes", "seconds", "count", "ratio", "percent", "bytes_per_second", "count_per_second":
	default:
		return errors.New("unsupported metric unit")
	}
	if d.Semantics != "gauge" && d.Semantics != "rate" {
		return errors.New("semantics must be gauge or rate")
	}
	if d.Reducer != "none" {
		return errors.New("declare reducer none; perform explicit unit-preserving aggregation in PromQL")
	}
	if d.BatchStrategy != "identity" {
		return errors.New("batch strategy must preserve explicit identity")
	}
	if len(d.IdentityLabels) == 0 || len(d.IdentityLabels) > 8 {
		return errors.New("one to eight identity labels required")
	}
	bindings := map[string]bool{}
	labels := map[string]bool{}
	for _, b := range d.FieldBindings {
		if b.Transform != "" && b.Transform != "identity" && b.Transform != "lowercase" && b.Transform != "uppercase" {
			return errors.New("unsupported field transform")
		}
	}
	for _, b := range d.FieldBindings {
		if !labelName.MatchString(b.Field) || !labelName.MatchString(b.Label) || bindings[b.Field] || labels[b.Label] {
			return errors.New("field and label names must be valid and unique")
		}
		if b.Source != "scope" && b.Source != "resource" {
			return errors.New("field source must be scope or resource")
		}
		if b.ResourcePath != "" {
			if b.Source != "resource" || !validResourcePath(b.ResourcePath) {
				return errors.New("resource_path requires a bounded RFC6901 pointer and resource source")
			}
		}
		if !b.Required {
			return errors.New("matcher fields must be required to avoid unscoped queries")
		}
		bindings[b.Field] = true
		labels[b.Label] = true
	}
	for _, l := range d.IdentityLabels {
		if !labelName.MatchString(l) || !labels[l] {
			return errors.New("identity label requires a typed field binding")
		}
	}
	for _, m := range placeholder.FindAllStringSubmatch(d.Query, -1) {
		if !bindings[m[1]] {
			return fmt.Errorf("unknown query field %s", m[1])
		}
	}
	for _, b := range d.FieldBindings {
		if !identities[b.Label] {
			return fmt.Errorf("matcher label %s must remain in result identity", b.Label)
		}
		if !strings.Contains(d.Query, `{{`+b.Field+`}}`) {
			return fmt.Errorf("unused field binding %s", b.Field)
		}
		if !strings.Contains(d.Query, b.Label+`=~"{{`+b.Field+`}}"`) {
			return fmt.Errorf("field %s must use a typed regex matcher", b.Field)
		}
	}
	if strings.Contains(placeholder.ReplaceAllString(d.Query, ""), "{{") {
		return errors.New("invalid query placeholder")
	}
	return nil
}
func fieldValue(b metric.MetricFieldBinding, r metric.ResourceMetricTarget, scope map[string]string) (string, error) {
	var v string
	if b.Source == "scope" {
		v = scope[b.Field]
	} else {
		switch b.Field {
		case "pod", "id", "name":
			v = r.Reference.Address.ID
		case "uid":
			if r.Reference.Incarnation != nil {
				v = *r.Reference.Incarnation
			}
		case "resource_key", "key":
			v = r.Reference.Address.Type
		default:
			v = r.PublicData[b.Field]
		}
		if b.Field == "namespace" {
			for _, entry := range r.Reference.Address.Scope {
				if entry.Dimension == "namespace" {
					v = entry.Value
				}
			}
		}
		if b.ResourcePath != "" {
			v = r.PublicData[b.Field]
		}
	}
	if v == "" || len(v) > 1024 {
		return "", &fieldContextError{Field: b.Field}
	}
	switch b.Transform {
	case "", "identity":
	case "lowercase":
		v = strings.ToLower(v)
	case "uppercase":
		v = strings.ToUpper(v)
	default:
		return "", errors.New("unsupported field transform")
	}
	return v, nil
}
func identity(labels map[string]string, keys []string) (string, error) {
	parts := make([]string, len(keys))
	for i, k := range keys {
		v := labels[k]
		if v == "" {
			return "", fmt.Errorf("result missing identity label %s", k)
		}
		parts[i] = strconv.Quote(v)
	}
	return strings.Join(parts, "|"), nil
}
func compile(d metric.MetricDefinition, resources []metric.ResourceMetricTarget, scope map[string]string) (string, map[string]string, error) {
	if err := definitionError(d); err != nil {
		return "", nil, err
	}
	expression := d.Query
	identities := map[string]string{}
	values := map[string]map[string]bool{}
	for _, b := range d.FieldBindings {
		values[b.Field] = map[string]bool{}
	}
	for _, r := range resources {
		labels := map[string]string{}
		for _, b := range d.FieldBindings {
			v, err := fieldValue(b, r, scope)
			if err != nil {
				return "", nil, err
			}
			values[b.Field][v] = true
			labels[b.Label] = v
		}
		key, err := identity(labels, d.IdentityLabels)
		if err != nil {
			return "", nil, err
		}
		if _, exists := identities[key]; exists {
			return "", nil, errors.New("duplicate requested resource identity")
		}
		identities[key] = r.Token
	}
	for field, set := range values {
		literals := make([]string, 0, len(set))
		for v := range set {
			literals = append(literals, regexp.QuoteMeta(v))
		}
		sort.Strings(literals)
		expression = strings.ReplaceAll(expression, "{{"+field+"}}", escapeMatcher("^(?:"+strings.Join(literals, "|")+")$"))
	}
	return expression, identities, nil
}
func (p *Provider) ValidateMetricDefinition(ctx *types.PluginContext, source metric.MetricSourceRef, d metric.MetricDefinition) (*metric.MetricValidationResult, error) {
	out := &metric.MetricValidationResult{Valid: true}
	if err := definitionError(d); err != nil {
		out.Valid = false
		out.Issues = append(out.Issues, metric.MetricValidationIssue{Field: "mapping", Code: "invalid", Message: err.Error()})
	}
	out.Issues = append(out.Issues, metric.MetricValidationIssue{Field: "sample", Code: "scope_required", Message: "Static validation only. Run an admitted resource-set query with public scope to validate datasource permission, syntax, identities, freshness and exporter units."})
	return out, nil
}
func (p *Provider) GetMetricDefinitions(*types.PluginContext) ([]metric.MetricDefinition, error) {
	bindings := []metric.MetricFieldBinding{{Field: "cluster", Label: "cluster", Source: "scope", Required: true}, {Field: "namespace", Label: "namespace", Source: "resource", Required: true}, {Field: "pod", Label: "pod", Source: "resource", Required: true}}
	base := metric.MetricDefinition{ResourceKeys: []string{"k8s:/pods"}, Semantics: "gauge", QueryLanguage: "promql", FieldBindings: bindings, IdentityLabels: []string{"cluster", "namespace", "pod"}, Reducer: "none", BatchStrategy: "identity", Revision: "kubernetes-cadvisor-v1", SupportedShapes: []string{"current", "range"}}
	cpu := base
	cpu.ID = "kubernetes.pod.cpu.usage"
	cpu.Name = "CPU usage"
	cpu.Unit = "cores"
	cpu.Semantics = "rate"
	cpu.Query = `sum by (cluster,namespace,pod) (rate(container_cpu_usage_seconds_total{cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}",container!="",container!="POD"}[5m]))`
	memory := base
	memory.FieldBindings = slices.Clone(base.FieldBindings)
	memory.ResourceKeys = slices.Clone(base.ResourceKeys)
	memory.IdentityLabels = slices.Clone(base.IdentityLabels)
	memory.SupportedShapes = slices.Clone(base.SupportedShapes)
	memory.ID = "kubernetes.pod.memory.working_set"
	memory.Name = "Memory working set"
	memory.Unit = "bytes"
	memory.Query = `sum by (cluster,namespace,pod) (container_memory_working_set_bytes{cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}",container!="",container!="POD"})`
	const scope = `cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}"`
	const containers = scope + `,container!="",container!="POD"`
	const group = ` by (cluster,namespace,pod) `
	presets := []struct {
		id, name, semantics, query string
		unit                       string
	}{
		{"memory_rss", "Memory RSS", "gauge", `sum` + group + `(container_memory_rss{` + containers + `})`, "bytes"},
		{"memory_cache", "Memory cache", "gauge", `sum` + group + `(container_memory_cache{` + containers + `})`, "bytes"},
		{"network_receive", "Network receive", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_bytes_total{` + scope + `,interface!="lo"}[5m])))`, "bytes_per_second"},
		{"network_transmit", "Network transmit", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_bytes_total{` + scope + `,interface!="lo"}[5m])))`, "bytes_per_second"},
		{"disk_read", "Disk read", "rate", `sum` + group + `(rate(container_fs_reads_bytes_total{` + containers + `}[5m]))`, "bytes_per_second"},
		{"disk_write", "Disk write", "rate", `sum` + group + `(rate(container_fs_writes_bytes_total{` + containers + `}[5m]))`, "bytes_per_second"},
		{"cpu_throttling", "CPU throttled periods", "gauge", `100 * sum` + group + `(rate(container_cpu_cfs_throttled_periods_total{` + containers + `}[5m])) / (sum` + group + `(rate(container_cpu_cfs_periods_total{` + containers + `}[5m])) > 0)`, "percent"},
		{"restarts", "Container restarts", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_status_restarts_total{` + scope + `}))`, "count"},
		{"cpu_requests", "CPU requests", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_requests{` + scope + `,resource="cpu",unit="core"}))`, "cores"},
		{"cpu_limits", "CPU limits", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_limits{` + scope + `,resource="cpu",unit="core"}))`, "cores"},
		{"memory_requests", "Memory requests", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_requests{` + scope + `,resource="memory",unit="byte"}))`, "bytes"},
		{"memory_limits", "Memory limits", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_limits{` + scope + `,resource="memory",unit="byte"}))`, "bytes"},
		{"network_receive_packets", "Network receive packets", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_packets_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_transmit_packets", "Network transmit packets", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_packets_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_receive_drops", "Network receive drops", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_packets_dropped_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_transmit_drops", "Network transmit drops", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_packets_dropped_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_receive_errors", "Network receive errors", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_errors_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_transmit_errors", "Network transmit errors", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_errors_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"memory_total_usage", "Memory total usage", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (container_memory_usage_bytes{` + containers + `}))`, "bytes"},
		{"filesystem_usage", "Filesystem used", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container,device) (container_fs_usage_bytes{` + containers + `}))`, "bytes"},
		{"processes", "Container processes", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (container_processes{` + containers + `}))`, "count"},
		{"threads", "Container threads", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (container_threads{` + containers + `}))`, "count"},
	}
	definitions := make([]metric.MetricDefinition, 2, len(presets)+2)
	definitions[0], definitions[1] = cpu, memory
	for _, preset := range presets {
		definition := base
		definition.FieldBindings = slices.Clone(base.FieldBindings)
		definition.ResourceKeys = slices.Clone(base.ResourceKeys)
		definition.IdentityLabels = slices.Clone(base.IdentityLabels)
		definition.SupportedShapes = slices.Clone(base.SupportedShapes)
		definition.ID, definition.Name = preset.id, preset.name
		definition.Semantics, definition.Query, definition.Unit = preset.semantics, preset.query, preset.unit
		definitions = append(definitions, definition)
	}
	return definitions, nil
}

func validateResourceMapping(d metric.MetricDefinition, resources []metric.ResourceMetricTarget, scope map[string]string, shape string) error {
	if err := definitionError(d); err != nil {
		return err
	}
	supported := false
	for _, candidate := range d.SupportedShapes {
		if candidate == shape {
			supported = true
		}
	}
	if !supported {
		return errors.New("mapping does not support requested shape")
	}
	seen := map[string]bool{}
	for _, resource := range resources {
		applicable := false
		for _, key := range d.ResourceKeys {
			if key == resource.Reference.Address.Type {
				applicable = true
			}
		}
		if !applicable {
			return errors.New("mapping does not apply to requested resource key")
		}
		labels := make(map[string]string, len(d.FieldBindings))
		for _, binding := range d.FieldBindings {
			value, err := fieldValue(binding, resource, scope)
			if err != nil {
				return err
			}
			labels[binding.Label] = value
		}
		key, err := identity(labels, d.IdentityLabels)
		if err != nil {
			return err
		}
		if seen[key] {
			return errors.New("ambiguous requested identity across resource chunks")
		}
		seen[key] = true
	}
	return nil
}

type fieldContextError struct{ Field string }

func (e *fieldContextError) Error() string {
	return fmt.Sprintf("required public field %s missing, non-scalar or exceeds limit", e.Field)
}

func validResourcePath(path string) bool {
	if len(path) == 0 || len(path) > 512 || path[0] != '/' || strings.Count(path, "/") > 16 {
		return false
	}
	for i := 0; i < len(path); i++ {
		if path[i] < 0x20 {
			return false
		}
		if path[i] == '~' {
			i++
			if i >= len(path) || (path[i] != '0' && path[i] != '1') {
				return false
			}
		}
	}
	return true
}
