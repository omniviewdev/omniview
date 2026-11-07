package diagnostics

import (
	"encoding/json"
	"fmt"
	"sort"
)

func pointKey(name string, p Point) string {
	data, _ := json.Marshal(p.Attributes)
	return name + string(data)
}
func summarize(c Capture) map[string]MetricComparison {
	out := map[string]MetricComparison{}
	if len(c.Samples) < 2 {
		return out
	}
	first, last := c.Samples[0], c.Samples[len(c.Samples)-1]
	seconds := last.ElapsedSeconds - first.ElapsedSeconds
	starts := map[string]Point{}
	for _, m := range first.Metrics {
		for _, p := range m.Points {
			starts[pointKey(m.Name, p)] = p
		}
	}
	gaugeSums := map[string]float64{}
	gaugeCounts := map[string]int{}
	for _, sample := range c.Samples {
		for _, metric := range sample.Metrics {
			if metric.Kind != "gauge" {
				continue
			}
			for _, point := range metric.Points {
				key := pointKey(metric.Name, point)
				gaugeSums[key] += point.Value
				gaugeCounts[key]++
			}
		}
	}
	for _, m := range last.Metrics {
		for _, p := range m.Points {
			k := pointKey(m.Name, p)
			v := MetricComparison{Name: m.Name, Unit: m.Unit, Kind: m.Kind, Attributes: p.Attributes, Valid: true}
			switch m.Kind {
			case "counter":
				a, ok := starts[k]
				v.Semantics = "endpoint increase per second"
				if !ok || seconds <= 0 || !a.StartTime.Equal(p.StartTime) || p.Value < a.Value {
					v.Valid = false
					v.Warning = "counter reset or endpoint unavailable"
				} else {
					v.Baseline = (p.Value - a.Value) / seconds
				}
			case "histogram":
				a, ok := starts[k]
				v.Semantics = "endpoint observation mean"
				if !ok || !a.StartTime.Equal(p.StartTime) || p.Count <= a.Count || p.Sum < a.Sum {
					v.Valid = false
					v.Warning = "histogram reset or no observations"
				} else {
					v.Baseline = (p.Sum - a.Sum) / float64(p.Count-a.Count)
				}
			default:
				v.Semantics = "arithmetic mean of collected gauge samples"
				if gaugeCounts[k] == 0 {
					v.Valid = false
				} else {
					v.Baseline = gaugeSums[k] / float64(gaugeCounts[k])
				}
			}
			out[k] = v
		}
	}
	return out
}
func (s *Service) CompareCaptures(baseline, candidate string) (Comparison, error) {
	a, err := s.GetCapture(baseline)
	if err != nil {
		return Comparison{}, err
	}
	b, err := s.GetCapture(candidate)
	if err != nil {
		return Comparison{}, err
	}
	out := Comparison{Baseline: a.ID, Candidate: b.ID, Compatible: true, Warnings: []string{}, Metrics: []MetricComparison{}}
	warn := func(text string) { out.Warnings = append(out.Warnings, text); out.Compatible = false }
	if a.Identity.SessionID == "" || b.Identity.SessionID == "" {
		out.Warnings = append(out.Warnings, "process session identity unavailable")
	} else if a.Identity.SessionID != b.Identity.SessionID {
		out.Warnings = append(out.Warnings, "process sessions differ; endpoint rates are calculated independently")
	}
	if a.Identity.SourceState != "clean" || b.Identity.SourceState != "clean" {
		out.Warnings = append(out.Warnings, "modified or unknown source state; revision is not a complete source fingerprint")
	}
	if a.Status != "complete" || b.Status != "complete" || !a.Coverage.Complete || !b.Coverage.Complete {
		warn("captures have incomplete coverage")
	}
	if a.Identity.ConfigID != b.Identity.ConfigID {
		warn("configuration differs")
	}
	if a.Workload != b.Workload {
		warn("workload differs")
	}
	if a.Identity.Revision != b.Identity.Revision {
		out.Warnings = append(out.Warnings, "build revision differs (expected for before/after comparisons)")
	}
	if len(a.Samples) < 2 || len(b.Samples) < 2 {
		warn("at least two samples required")
	}
	left, right := summarize(a), summarize(b)
	for key, x := range left {
		y, ok := right[key]
		if !ok {
			x.Valid = false
			x.Warning = "candidate series missing"
		} else if x.Unit != y.Unit || x.Kind != y.Kind {
			x.Valid = false
			x.Warning = "unit or kind differs"
			warn(fmt.Sprintf("%s has incompatible units or kind", x.Name))
		} else {
			x.Candidate = y.Baseline
			x.Delta = x.Candidate - x.Baseline
			x.Valid = x.Valid && y.Valid
			if y.Warning != "" {
				x.Warning = y.Warning
			}
		}
		out.Metrics = append(out.Metrics, x)
	}
	for key, y := range right {
		if _, ok := left[key]; !ok {
			y.Valid = false
			y.Warning = "baseline series missing"
			y.Candidate = y.Baseline
			y.Baseline = 0
			out.Metrics = append(out.Metrics, y)
		}
	}
	sort.Slice(out.Metrics, func(i, j int) bool {
		return pointKey(out.Metrics[i].Name, Point{Attributes: out.Metrics[i].Attributes}) < pointKey(out.Metrics[j].Name, Point{Attributes: out.Metrics[j].Attributes})
	})
	return out, nil
}
