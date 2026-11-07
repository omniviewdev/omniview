package diagnostics

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

func metricName(name string) string {
	var b strings.Builder
	for i, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '_' || r == ':' || i > 0 && r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "_"
	}
	return b.String()
}
func labelValue(value string) string {
	return "\"" + strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\"", "\\\"").Replace(value) + "\""
}
func labels(attrs map[string]string, extra, value string) string {
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys)+1)
	for _, k := range keys {
		parts = append(parts, metricName(k)+"="+labelValue(attrs[k]))
	}
	if extra != "" {
		parts = append(parts, extra+"="+labelValue(value))
	}
	if len(parts) == 0 {
		return ""
	}
	return "{" + strings.Join(parts, ",") + "}"
}
func emittedNames(m Metric) []string {
	name := metricName(m.Name)
	if m.Kind == "histogram" {
		return []string{name, name + "_bucket", name + "_count", name + "_sum"}
	}
	return []string{name}
}

// Fresh reports whether collection is current, so scrapes can fail instead of
// republishing cached values under new scrape timestamps.
func (s *Service) Fresh() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return !s.lastSuccess.IsZero() && time.Since(s.lastSuccess) <= 3*s.opts.Interval
}

func (s *Service) Prometheus() string {
	snapshot := s.GetSnapshot()
	// Sanitization and histogram suffixes can collide. Omit every conflicting family.
	names := map[string]int{}
	for _, m := range snapshot.Metrics {
		for _, name := range emittedNames(m) {
			names[name]++
		}
	}
	var b strings.Builder
	for _, m := range snapshot.Metrics {
		collision := false
		for _, name := range emittedNames(m) {
			if names[name] > 1 {
				collision = true
			}
		}
		if collision {
			b.WriteString("# diagnostics omitted conflicting metric family\n")
			continue
		}
		name := metricName(m.Name)
		description := strings.NewReplacer("\\", "\\\\", "\n", "\\n").Replace(m.Description)
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", name, description, name, m.Kind)
		for _, p := range m.Points {
			if m.Kind != "histogram" {
				fmt.Fprintf(&b, "%s%s %g\n", name, labels(p.Attributes, "", ""), p.Value)
				continue
			}
			if len(p.BucketCounts) != len(p.Bounds)+1 {
				continue
			}
			var cumulative uint64
			for i, count := range p.BucketCounts {
				cumulative += count
				bound := "+Inf"
				if i < len(p.Bounds) {
					bound = strconv.FormatFloat(p.Bounds[i], 'g', -1, 64)
				}
				fmt.Fprintf(&b, "%s_bucket%s %d\n", name, labels(p.Attributes, "le", bound), cumulative)
			}
			fmt.Fprintf(&b, "%s_count%s %d\n%s_sum%s %g\n", name, labels(p.Attributes, "", ""), p.Count, name, labels(p.Attributes, "", ""), p.Sum)
		}
	}
	return b.String()
}
