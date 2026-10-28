package registry

import resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

// Store isolates observations by plugin ownership and access route, while using
// exact canonical address identity within each projection.
type Store interface {
	Put(entry ResourceEntry) (old *ResourceEntry, existed bool)
	PutIfAbsent(entry ResourceEntry) (existing *ResourceEntry, loaded bool)
	Get(pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute) (*ResourceEntry, bool)
	Delete(pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute) (*ResourceEntry, bool)
	DeleteByConnection(pluginID, connectionID string) []ResourceEntry
	ScanByLabel(pluginID, connectionID, resourceType string, selector map[string]string) []ResourceEntry
	ScanByResourceKey(pluginID, connectionID, resourceType string) []ResourceEntry
}
