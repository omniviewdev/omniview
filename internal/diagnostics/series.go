package diagnostics

import (
	"math"
	"slices"
)

// Histograms remain additive when labels are removed only if their bucket layout
// and cumulative start time agree. Other ambiguous series must not be guessed.
func normalizedPoints(metric Metric) ([]Point, bool) {
	out := make([]Point, 0, len(metric.Points))
	positions := make(map[string]int, len(metric.Points))
	for _, point := range metric.Points {
		key := pointKey(metric.Name, point)
		position, exists := positions[key]
		if !exists {
			positions[key] = len(out)
			out = append(out, point)
			continue
		}
		if metric.Kind != "histogram" {
			return nil, false
		}
		current := &out[position]
		if !current.StartTime.Equal(point.StartTime) || !slices.Equal(current.Bounds, point.Bounds) || len(current.BucketCounts) != len(current.Bounds)+1 || len(point.BucketCounts) != len(current.BucketCounts) {
			return nil, false
		}
		if ^uint64(0)-current.Count < point.Count {
			return nil, false
		}
		sum := current.Sum + point.Sum
		if math.IsNaN(sum) || math.IsInf(sum, 0) {
			return nil, false
		}
		for i, count := range point.BucketCounts {
			if ^uint64(0)-current.BucketCounts[i] < count {
				return nil, false
			}
		}
		current.Count += point.Count
		current.Sum = sum
		// convert owns these bucket slices, never the SDK's aggregation buffers.
		for i, count := range point.BucketCounts {
			current.BucketCounts[i] += count
		}
	}
	return out, true
}
func unambiguousMetrics(metrics []Metric) ([]Metric, bool, bool) {
	names := make(map[string]int, len(metrics))
	for _, metric := range metrics {
		names[metric.Name]++
	}
	out := make([]Metric, 0, len(metrics))
	rejected, limited := false, false
	for _, metric := range metrics {
		if names[metric.Name] != 1 {
			rejected = true
			continue
		}
		points, valid := normalizedPoints(metric)
		if !valid {
			rejected = true
			continue
		}
		if len(points) > 16 {
			points = points[:16]
			limited = true
		}
		metric.Points = points
		out = append(out, metric)
	}
	return out, rejected, limited
}
func sampledElapsed(c *Capture) float64 {
	if len(c.Samples) < 2 {
		return 0
	}
	return c.Samples[len(c.Samples)-1].ElapsedSeconds - c.Samples[0].ElapsedSeconds
}
