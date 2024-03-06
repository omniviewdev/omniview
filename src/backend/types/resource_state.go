package types

import (
	"encoding/json"
	"fmt"
)

type ResourceStateEventType int

const (
	ResourceAdded ResourceStateEventType = iota
	ResourceRemoved
	ResourceReady
	ResourceNotReady
	ResourceError
	ClusterContextResourceReady
	ClusterContextResourceNotReady
	ClusterContextResourceError
)

var resourceStateEventTypes = map[ResourceStateEventType]string{
	ResourceAdded:                  "ResourceAdded",
	ResourceRemoved:                "ResourceRemoved",
	ResourceReady:                  "ResourceReady",
	ResourceNotReady:               "ResourceNotReady",
	ResourceError:                  "ResourceError",
	ClusterContextResourceReady:    "ClusterContextResourceReady",
	ClusterContextResourceNotReady: "ClusterContextResourceNotReady",
	ClusterContextResourceError:    "ClusterContextResourceError",
}

var resourceStateEventTypesReverse = map[string]ResourceStateEventType{
	"ResourceAdded":                  ResourceAdded,
	"ResourceRemoved":                ResourceRemoved,
	"ResourceReady":                  ResourceReady,
	"ResourceNotReady":               ResourceNotReady,
	"ResourceError":                  ResourceError,
	"ClusterContextResourceReady":    ClusterContextResourceReady,
	"ClusterContextResourceNotReady": ClusterContextResourceNotReady,
	"ClusterContextResourceError":    ClusterContextResourceError,
}

func (e ResourceStateEventType) String() string {
	if str, ok := resourceStateEventTypes[e]; ok {
		return str
	}
	return "unknown"
}

func (e ResourceStateEventType) MarshalJSON() ([]byte, error) {
	if str, ok := resourceStateEventTypes[e]; ok {
		return json.Marshal(str)
	}
	return nil, fmt.Errorf("unknown state: %v", e)
}

func (e *ResourceStateEventType) UnmarshalJSON(data []byte) error {
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		return fmt.Errorf("ResourceStateEventType should be a string, got %s", data)
	}

	if val, ok := resourceStateEventTypesReverse[str]; ok {
		*e = val
		return nil
	}

	return fmt.Errorf("unknown resource state event type: %s", str)
}
