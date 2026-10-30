package mcprelay

import (
	hostlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ResourceOperationResult adds host route provenance without rewriting native
// records, canonical scalar tags, source revisions or coverage claims.
type ResourceOperationResult struct {
	Operation  string                        `json:"operation"`
	Route      resourcev2.AccessRoute        `json:"route"`
	TypeTarget *resourcev2.TypeActionTarget  `json:"typeTarget,omitempty"`
	Reference  *resourcev2.ResourceReference `json:"reference,omitempty"`
	Action     string                        `json:"action,omitempty"`
	Record     *resourcev2.Record            `json:"record,omitempty"`
	Value      *resourcev2.Value             `json:"value,omitempty"`
}

type ResourceLogsResult struct {
	Route     resourcev2.AccessRoute       `json:"route"`
	Reference resourcev2.ResourceReference `json:"reference"`
	Logs      *hostlogs.HeadlessResult     `json:"logs"`
}
type ResourceScopeValuesResult struct {
	Route     resourcev2.AccessRoute `json:"route"`
	Dimension string                 `json:"dimension"`
	Values    []string               `json:"values"`
}
