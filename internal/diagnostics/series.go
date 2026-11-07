package diagnostics

// Reject ambiguous series rather than incorrectly adding gauges or mixing histograms.
func unambiguousMetrics(metrics []Metric) ([]Metric, bool) {
	names := make(map[string]int, len(metrics))
	for _, metric := range metrics {
		names[metric.Name]++
	}
	out := make([]Metric, 0, len(metrics))
	rejected := false
	for _, metric := range metrics {
		if names[metric.Name] != 1 {
			rejected = true
			continue
		}
		seen := make(map[string]bool, len(metric.Points))
		ambiguous := false
		for _, point := range metric.Points {
			key := pointKey(metric.Name, point)
			if seen[key] {
				ambiguous = true
				break
			}
			seen[key] = true
		}
		if ambiguous {
			rejected = true
			continue
		}
		out = append(out, metric)
	}
	return out, rejected
}
func sampledElapsed(c *Capture) float64 {
	if len(c.Samples) < 2 {
		return 0
	}
	return c.Samples[len(c.Samples)-1].ElapsedSeconds - c.Samples[0].ElapsedSeconds
}
