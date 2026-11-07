package diagnostics

func captureCoverage(c *Capture) Health {
	health := Health{Complete: true}
	if len(c.Samples) < 2 {
		health.Complete = false
		health.LastError = "at least two collection endpoints required"
		return health
	}
	first, last := c.Samples[0], c.Samples[len(c.Samples)-1]
	health.Gaps = last.Health.Gaps - first.Health.Gaps
	health.Dropped = last.Health.Dropped - first.Health.Dropped
	health.Errors = last.Health.Errors - first.Health.Errors
	if health.Gaps > 0 {
		health.Complete = false
		health.LastError = "collection gaps occurred"
	}
	if health.Errors > 0 || health.Dropped > 0 {
		health.Complete = false
		health.LastError = "collection errors or truncated series occurred"
	}
	for _, sample := range c.Samples {
		if !sample.Health.Complete {
			health.Complete = false
			health.LastError = "capture includes an incomplete collection sample"
		}
		if sample.Identity.ConfigID != c.Identity.ConfigID {
			health.Complete = false
			health.LastError = "configuration changed during capture"
		}
	}
	starts := map[string]Point{}
	for _, metric := range first.Metrics {
		if metric.Kind != "counter" && metric.Kind != "histogram" {
			continue
		}
		for _, point := range metric.Points {
			starts[pointKey(metric.Name, point)] = point
		}
	}
	for _, metric := range last.Metrics {
		if metric.Kind != "counter" && metric.Kind != "histogram" {
			continue
		}
		for _, point := range metric.Points {
			start, ok := starts[pointKey(metric.Name, point)]
			delete(starts, pointKey(metric.Name, point))
			if !ok || !start.StartTime.Equal(point.StartTime) || metric.Kind == "counter" && point.Value < start.Value || metric.Kind == "histogram" && point.Count < start.Count {
				health.Complete = false
				health.LastError = "counter reset or endpoint unavailable"
			}
		}
	}
	if len(starts) > 0 {
		health.Complete = false
		health.LastError = "counter reset or endpoint unavailable"
	}
	return health
}
