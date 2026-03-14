package registry

import "time"

// ResourceEntry is the lightweight metadata the engine stores per resource.
type ResourceEntry struct {
	PluginID     string
	ConnectionID string
	ResourceKey  string            // e.g. "core::v1::Pod", "ec2::Instance"
	ID           string            // resource name/identifier
	Namespace    string            // scope within connection (empty if unscoped)
	UID          string            // dedup key
	Labels       map[string]string // for selector-based relationship resolution
	CreatedAt    time.Time
}

// EntryKey returns the unique key for this entry within the registry.
// Format: "pluginID/connectionID/resourceKey/namespace/id"
func (e ResourceEntry) EntryKey() string {
	return e.PluginID + "/" + e.ConnectionID + "/" + e.ResourceKey + "/" + e.Namespace + "/" + e.ID
}
