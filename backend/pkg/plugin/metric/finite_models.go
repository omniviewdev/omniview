package metric

import (
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"time"
)

// MetricsObservationSpec describes a finite, reference-bound interest, not a grant.
// OwnerPluginID/OwnerConnectionID select an admitted owner; the host selects its
// native source. Targets are canonical observed references with distinct tokens.
// Shape is current or range; range times are UTC instants and StepMs is positive.
// IntervalMs is zero for initial/manual reads, otherwise 1000..3600000 milliseconds.
// Native metrics-server supports current only. At most 256 targets and 32 metric
// IDs are accepted; unsupported catalog IDs/shapes fail before collection.
type MetricsObservationSpec struct {
	OwnerPluginID     string                     `json:"owner_plugin_id"`
	OwnerConnectionID string                     `json:"owner_connection_id"`
	ResourceKey       string                     `json:"resource_key"`
	Targets           []sdk.ResourceMetricTarget `json:"targets"`
	MetricIDs         []string                   `json:"metric_ids"`
	Shape             string                     `json:"shape"`
	StartTime         time.Time                  `json:"start_time"`
	EndTime           time.Time                  `json:"end_time"`
	StepMs            int                        `json:"step_ms"`
	IntervalMs        int                        `json:"interval_ms"`
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
// DomainStart/DomainEnd are supplied only for an actual requested range.
// Catalog is the admitted source metadata used for this observation's data;
// consumers must derive units/source identity from this snapshot, not a racing
// standalone catalog request.
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
// Displays maps IDs to auto, value, capacity, gauge, or chart. Layout is auto,
// grid, or stack. Capacity requires real request/limit data in the owning view.
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
