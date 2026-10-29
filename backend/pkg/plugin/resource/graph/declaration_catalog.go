package graph

import resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

// declarationCatalog is complete host-admitted membership, not resource inventory.
type declarationCatalog struct {
	revision    string
	sourceEpoch uint64
	types       map[string]struct{}
}

// ObserveDeclarationCatalog publishes complete admitted Type membership. Types
// outside this context cannot make queued observations poison current coverage.
func (g *RelationshipGraph) ObserveDeclarationCatalog(plugin string, route resource.AccessRoute, catalogRevision string, sourceEpoch uint64, types []string) {
	membership := make(map[string]struct{}, len(types))
	for _, typ := range types {
		membership[typ] = struct{}{}
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	ref := ConnectionRef{plugin, route.Connection}
	if g.declarationCatalogs == nil {
		g.declarationCatalogs = make(map[ConnectionRef]declarationCatalog)
	}
	removed := make(map[string]struct{})
	consider := func(typ string) {
		if typ != "" {
			if _, present := membership[typ]; !present {
				removed[typ] = struct{}{}
			}
		}
	}
	for typ := range g.declarationCatalogs[ref].types {
		consider(typ)
	}
	for key := range g.boundDeclarations {
		if key.pluginID == plugin && key.connectionID == route.Connection {
			consider(key.resourceKey)
		}
	}
	for key := range g.missingSnapshots {
		if key.pluginID == plugin && key.connectionID == route.Connection {
			consider(key.resourceKey)
		}
	}
	for key := range g.declarationProblems {
		if key.pluginID == plugin && key.connectionID == route.Connection {
			consider(key.resourceKey)
		}
	}
	for _, entry := range g.unresolved {
		if entry.node.PluginID == plugin && entry.node.Route == route {
			consider(entry.node.Reference.Address.Type)
		}
	}
	for _, entries := range g.selectorCache {
		for _, entry := range entries {
			if entry.node.PluginID == plugin && entry.node.Route == route {
				consider(entry.node.Reference.Address.Type)
			}
			break
		}
	}
	for typ := range removed {
		g.retireDeclarationsLocked(plugin, route, typ)
		key := declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: typ}
		delete(g.boundDeclarations, key)
		delete(g.declarationProblems, key)
	}
	g.declarationCatalogs[ref] = declarationCatalog{revision: catalogRevision, sourceEpoch: sourceEpoch, types: membership}
	g.markChanged(plugin, route.Connection)
}

// sourceTypeExcluded is called with g.mu held. Unknown catalogs retain explicit
// missing-binding errors; only complete host admission can establish exclusion.
func (g *RelationshipGraph) sourceTypeExcluded(plugin string, route resource.AccessRoute, typ string) bool {
	catalog, known := g.declarationCatalogs[ConnectionRef{plugin, route.Connection}]
	if !known {
		return false
	}
	_, present := catalog.types[typ]
	return !present
}
