package metric

import (
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"time"
)

// MetricsObservationSpec describes a finite, reference-bound interest, not a grant.
// OwnerPluginID/OwnerConnectionID select an admitted owner. Source selection is
// independent of resource authority and never grants access to resource data.
// Shape is current or range. Range uses fixed UTC bounds or positive DurationMs,
// never both. The host resolves relative bounds anew for each collection.
// IntervalMs is zero for initial/manual reads, otherwise 1000..3600000 milliseconds.
// At most 256 targets and 32 metric IDs are accepted. Unsupported selections fail
// before collection without retrying through another source.
type MetricsObservationSpec struct {
	OwnerPluginID     string                     `json:"owner_plugin_id"`
	OwnerConnectionID string                     `json:"owner_connection_id"`
	ResourceKey       string                     `json:"resource_key"`
	BindingID         string                     `json:"binding_id"`
	Source            *sdk.MetricSourceRef       `json:"source,omitempty"`
	Targets           []sdk.ResourceMetricTarget `json:"targets"`
	MetricIDs         []string                   `json:"metric_ids"`
	Shape             string                     `json:"shape"`
	DurationMs        int64                      `json:"duration_ms"`
	StartTime         time.Time                  `json:"start_time"`
	EndTime           time.Time                  `json:"end_time"`
	StepMs            int                        `json:"step_ms"`
	IntervalMs        int                        `json:"interval_ms"`
}

// resolveFiniteRange converts a relative interest to one immutable evaluation
// domain. Keep the original observation spec so its next collection can advance.
func resolveFiniteRange(spec MetricsObservationSpec, now time.Time) (MetricsObservationSpec, error) {
	if spec.DurationMs < 0 || spec.DurationMs > int64(sdk.MaxFiniteRange/time.Millisecond) {
		return spec, finiteError("INVALID_REQUEST", "Relative metric duration must be positive and at most 31 days.")
	}
	if spec.DurationMs == 0 {
		return spec, nil
	}
	if spec.Shape != "range" || !spec.StartTime.IsZero() || !spec.EndTime.IsZero() {
		return spec, finiteError("INVALID_REQUEST", "Relative range duration cannot include absolute bounds or current shape.")
	}
	if spec.StepMs <= 0 || spec.StepMs > int(sdk.MaxFiniteRange/time.Millisecond) {
		return spec, finiteError("INVALID_REQUEST", "Relative range step must be positive and at most 31 days.")
	}
	step := int64(spec.StepMs)
	end := now.UTC().UnixMilli()
	end -= end % step
	spec.EndTime = time.UnixMilli(end).UTC()
	spec.StartTime = spec.EndTime.Add(-time.Duration(spec.DurationMs) * time.Millisecond)
	spec.DurationMs = 0
	return spec, nil
}

// ResourceMetricsCatalogRequest selects a source without accepting resource data.
type ResourceMetricsCatalogRequest struct {
	OwnerPluginID     string               `json:"owner_plugin_id"`
	OwnerConnectionID string               `json:"owner_connection_id"`
	ResourceKey       string               `json:"resource_key"`
	BindingID         string               `json:"binding_id"`
	Source            *sdk.MetricSourceRef `json:"source,omitempty"`
}

// OpenMetricsObservationRequest reserves a session-owned correlation token.
// Use a fresh opaque token (for example a UUID) for each logical observation.
// Open does not collect: install the event listener, await Open, then Attach.
type OpenMetricsObservationRequest struct {
	ClientToken string                 `json:"client_token"`
	Spec        MetricsObservationSpec `json:"spec"`
}

// MetricsObservationSnapshot is immutable publication state. Generation fences
// reused tokens; Sequence strictly increases within a generation. Data is absent
// while initially pending, and remains visible while compatible refreshes run.
// Source timestamps and units are unchanged (CPU cores, memory bytes); missing
// samples are not zero. Invalidated clears Data on retirement or lost authority.
// DomainStart/DomainEnd describe the data's actual range. Relative observations
// leave the domain absent until collection succeeds and retain it during refresh.
// Catalog is admitted metadata for the delivered sample lanes, not full metric
// discovery. Consumers derive units/source identity from this snapshot and use
// GetResourceMetricsCatalog independently for available metric choices.
type MetricsObservationSnapshot struct {
	ClientToken string                       `json:"client_token"`
	Generation  uint64                       `json:"generation"`
	Sequence    uint64                       `json:"sequence"`
	Data        *sdk.ResourceMetricsResponse `json:"data"`
	Catalog     *sdk.ResourceMetricsCatalog  `json:"catalog"`
	Fetching    bool                         `json:"fetching"`
	Error       string                       `json:"error"`
	DomainStart *time.Time                   `json:"domain_start"`
	DomainEnd   *time.Time                   `json:"domain_end"`
	Invalidated bool                         `json:"invalidated"`
}

// MetricViewPreferences is profile-durable presentation state shared by owner
// plugin and resource key, never source credentials or resource authority.
// Version is 1. Revision is a compare-and-swap token: load, edit, save the loaded
// revision, then reload. Stale saves return CONFLICT without changing any field.
// MetricIDs is the ordered visible selection; there is no second order array.
// Displays maps IDs to auto, value, capacity, gauge, area, line, or sample-bars.
// Layout is auto, grid, or stack. Capacity requires real owner request/limit data.
// TimeMode is relative (DurationMs, up to 31 days) or absolute (StartMs < EndMs,
// epoch milliseconds, at most 31 days). Details and Displays may retain settings
// for temporarily unselected metrics, bounded to 128 IDs each.
// Unpersisted defaults (Revision 0) contain no selected metric IDs, auto layout,
// and relative one hour. Owning views may supply domain defaults only while
// Revision is 0. A persisted empty selection (Revision > 0) stays empty.
type MetricViewPreferences struct {
	Version    int               `json:"version"`
	Revision   uint64            `json:"revision"`
	MetricIDs  []string          `json:"metric_ids"`
	Displays   map[string]string `json:"displays"`
	Layout     string            `json:"layout"`
	TimeMode   string            `json:"time_mode"`
	DurationMs int64             `json:"duration_ms"`
	StartMs    int64             `json:"start_ms"`
	EndMs      int64             `json:"end_ms"`
	Details    map[string]bool   `json:"details"`
}
