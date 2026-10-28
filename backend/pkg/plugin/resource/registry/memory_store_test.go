package registry

import (
	"fmt"
	"sync"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func makeEntry(plugin, connection, resourceType, scope, id string, labels map[string]string) ResourceEntry {
	return ResourceEntry{PluginID: plugin, Route: resourcev2.AccessRoute{Connection: connection}, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "provider", Authority: "host-issued", Type: resourceType, Scope: []resourcev2.ScopeEntry{{Dimension: "region", Value: scope}}, ID: id}}, Labels: labels}
}

func TestMemoryStoreCanonicalCRUDAndLabelIndexes(t *testing.T) {
	store := NewMemoryStore()
	entry := makeEntry("plugin", "route", "opaque/type", "scope/雪", "id/a", map[string]string{"app": "one", "env": "prod"})
	old, existed := store.Put(entry)
	require.Nil(t, old)
	require.False(t, existed)
	got, exists := store.Get(entry.PluginID, entry.Reference, entry.Route)
	require.True(t, exists)
	require.Equal(t, entry, *got)
	// Writes and reads must not lend mutable metadata or address slices.
	entry.Labels["app"] = "mutated"
	entry.Reference.Address.Scope[0].Value = "mutated"
	require.Equal(t, "one", got.Labels["app"])
	require.Equal(t, "scope/雪", got.Reference.Address.Scope[0].Value)
	got.Labels["app"] = "two"
	old, existed = store.Put(*got)
	require.True(t, existed)
	require.Equal(t, "one", old.Labels["app"])
	require.Empty(t, store.ScanByLabel("plugin", "route", "opaque/type", map[string]string{"app": "one"}))
	require.Len(t, store.ScanByLabel("plugin", "route", "opaque/type", map[string]string{"app": "two", "env": "prod"}), 1)
	require.Empty(t, store.ScanByLabel("plugin", "route", "opaque/type", map[string]string{"app": "two", "env": "other"}))
	require.Nil(t, store.ScanByLabel("plugin", "route", "opaque/type", nil))
	require.Empty(t, store.ScanByResourceKey("plugin", "route", "other/type"))
	require.Len(t, store.ScanByResourceKey("plugin", "route", "opaque/type"), 1)
	candidate := *got
	candidate.Labels = map[string]string{"app": "three"}
	prior, loaded := store.PutIfAbsent(candidate)
	require.True(t, loaded)
	require.Equal(t, "two", prior.Labels["app"])
	removed, exists := store.Delete(got.PluginID, got.Reference, got.Route)
	require.True(t, exists)
	require.Equal(t, "two", removed.Labels["app"])
	_, exists = store.Get(got.PluginID, got.Reference, got.Route)
	require.False(t, exists)
	_, exists = store.Delete(got.PluginID, got.Reference, got.Route)
	require.False(t, exists)
	require.Empty(t, store.ScanByLabel("plugin", "route", "opaque/type", map[string]string{"app": "two"}))
	_, loaded = store.PutIfAbsent(candidate)
	require.False(t, loaded)
}

func TestMemoryStoreRouteIsolationOpaqueKeysAndBulkDelete(t *testing.T) {
	store := NewMemoryStore()
	one := makeEntry("a/b", "c", "type", "scope", "id", map[string]string{"a=b": "c"})
	two := one
	two.PluginID = "a"
	two.Route.Connection = "b/c"
	alias := one
	alias.Route.Connection = "alias"
	alias.Labels = map[string]string{"a": "b=c"}
	for _, entry := range []ResourceEntry{one, two, alias} {
		store.Put(entry)
	}
	require.Equal(t, one.EntryKey(), alias.EntryKey())
	require.Len(t, store.ScanByLabel("a/b", "c", "type", map[string]string{"a=b": "c"}), 1)
	require.Empty(t, store.ScanByLabel("a/b", "c", "type", map[string]string{"a": "b=c"}))
	require.Len(t, store.DeleteByConnection("a/b", "c"), 1)
	for _, entry := range []ResourceEntry{two, alias} {
		got, exists := store.Get(entry.PluginID, entry.Reference, entry.Route)
		require.True(t, exists)
		require.Equal(t, entry, *got)
	}
	require.Empty(t, store.DeleteByConnection("a/b", "c"))
}

func TestMemoryStoreIncarnationAndDuplicateScope(t *testing.T) {
	store := NewMemoryStore()
	entry := makeEntry("p", "c", "type", "scope", "id", nil)
	incarnation := "opaque/incarnation"
	entry.Reference.Incarnation = &incarnation
	store.Put(entry)
	wrong := entry.Reference
	other := "other"
	wrong.Incarnation = &other
	_, exists := store.Get("p", wrong, entry.Route)
	require.False(t, exists)
	_, exists = store.Delete("p", wrong, entry.Route)
	require.False(t, exists)
	without := entry.Reference
	without.Incarnation = nil
	_, exists = store.Get("p", without, entry.Route)
	require.True(t, exists)
	entry.Reference.Address.Scope = append(entry.Reference.Address.Scope, entry.Reference.Address.Scope[0])
	_, existed := store.Put(entry)
	require.False(t, existed)
	require.Len(t, store.ScanByResourceKey("p", "c", "type"), 1)
}

func TestMemoryStoreConcurrentAccess(t *testing.T) {
	store := NewMemoryStore()
	var workers sync.WaitGroup
	for worker := range 20 {
		workers.Add(1)
		go func(worker int) {
			defer workers.Done()
			for n := range 50 {
				entry := makeEntry("p", fmt.Sprint(worker), "type", "scope", fmt.Sprint(n), map[string]string{"worker": fmt.Sprint(worker)})
				store.Put(entry)
				store.Get(entry.PluginID, entry.Reference, entry.Route)
				store.ScanByLabel("p", entry.Route.Connection, "type", entry.Labels)
				store.ScanByResourceKey("p", entry.Route.Connection, "type")
				store.Delete(entry.PluginID, entry.Reference, entry.Route)
			}
		}(worker)
	}
	workers.Wait()
}
