package metric

import (
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"maps"
)

// Each delivery owns its mutable SDK pointers/maps; headless consumers cannot
// mutate another observer or corrupt the coordinator's immutable completed cache.
func cloneFiniteResult(result sdk.ResourceMetricResult) sdk.ResourceMetricResult {
	if result.Value != nil {
		value := *result.Value
		result.Value = &value
	}
	if result.ObservedAt != nil {
		observed := *result.ObservedAt
		result.ObservedAt = &observed
	}
	result.Dimensions = maps.Clone(result.Dimensions)
	if result.Points != nil {
		points := make([]sdk.ResourceMetricPoint, len(result.Points))
		copy(points, result.Points)
		for i := range points {
			if points[i].Value != nil {
				value := *points[i].Value
				points[i].Value = &value
			}
		}
		result.Points = points
	}
	return result
}

func cloneFiniteCatalog(catalog *sdk.ResourceMetricsCatalog) *sdk.ResourceMetricsCatalog {
	if catalog == nil {
		return nil
	}
	cloned := *catalog
	cloned.Metrics = make([]sdk.FiniteMetricDescriptor, len(catalog.Metrics))
	copy(cloned.Metrics, catalog.Metrics)
	for i := range cloned.Metrics {
		cloned.Metrics[i].Shapes = append([]string(nil), cloned.Metrics[i].Shapes...)
	}
	return &cloned
}

func validateFiniteSelection(query sdk.ResourceMetricsQuery, catalog *sdk.ResourceMetricsCatalog) error {
	if len(query.Targets) > catalog.MaxTargets {
		return finiteError("RESOURCE_LIMIT", "Catalog target limit exceeded.")
	}
	for _, id := range query.MetricIDs {
		found := false
		for _, descriptor := range catalog.Metrics {
			if descriptor.ID == id {
				for _, shape := range descriptor.Shapes {
					if shape == query.Shape {
						found = true
					}
				}
			}
		}
		if !found {
			return finiteError("UNSUPPORTED", "Metric or evaluation shape is not in the native catalog.")
		}
	}
	return nil
}
