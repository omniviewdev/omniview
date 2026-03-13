package registry

// RegistryStore abstracts the storage backend for resource entries.
type RegistryStore interface {
	Put(entry ResourceEntry) (old *ResourceEntry, existed bool)
	Get(pluginID, connectionID, resourceKey, namespace, id string) (*ResourceEntry, bool)
	Delete(pluginID, connectionID, resourceKey, namespace, id string) (*ResourceEntry, bool)
	DeleteByConnection(pluginID, connectionID string) []ResourceEntry
	ScanByLabel(pluginID, connectionID, resourceKey string, selector map[string]string) []ResourceEntry
	ScanByResourceKey(pluginID, connectionID, resourceKey string) []ResourceEntry
}
