package graph

import (
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// TargetBinding retains the host-admitted target and its exact identity schema.
type TargetBinding struct {
	Target             resource.ReadTarget
	IdentityDimensions []resource.Dimension
}

// DeclarationBindings belongs to one admitted source catalog epoch.
type DeclarationBindings struct {
	Source      TargetBinding
	Targets     []TargetBinding
	SourceEpoch uint64
}

type boundSet struct {
	noRules      bool
	declarations []resource.RelationshipDescriptor
	bindings     DeclarationBindings
}

type unresolvedEntry struct {
	node   GraphNode
	reason string
}

func (g *RelationshipGraph) SetBoundDeclarations(plugin string, route resource.AccessRoute, sourceType string, decls []resource.RelationshipDescriptor, bindings DeclarationBindings) error {
	if route.Connection == "" || sourceType == "" || bindings.Source.Target.Route != route || bindings.Source.Target.Type != sourceType || bindings.Source.Target.Provider == "" || bindings.Source.Target.Authority == "" {
		return fmt.Errorf("invalid graph source binding")
	}
	if err := admitBindingScopeProof(bindings.Source); err != nil {
		return err
	}
	for _, target := range bindings.Targets {
		if err := admitBindingScopeProof(target); err != nil {
			return err
		}
	}
	candidate := boundSet{declarations: decls, bindings: bindings}
	g.mu.Lock()
	defer g.mu.Unlock()
	key := declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType}
	if reflect.DeepEqual(g.boundDeclarations[key], &candidate) {
		delete(g.declarationProblems, key)
		return nil
	}
	snapshot := cloneBoundSet(candidate)
	g.retireDeclarationsLocked(plugin, route, sourceType)
	if g.boundDeclarations == nil {
		g.boundDeclarations = make(map[declMapKey]*boundSet)
	}
	delete(g.declarationProblems, declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType})
	g.markChanged(plugin, route.Connection)
	g.boundDeclarations[declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType}] = &snapshot
	return nil
}

// Registry observations carry exact identity, not native query-filter provenance.
func admitBindingScopeProof(binding TargetBinding) error {
	for _, constraint := range binding.Target.Scope {
		if constraint.Match == resource.ScopeAny {
			continue
		}
		identity := false
		for _, dimension := range binding.IdentityDimensions {
			if dimension.Name == constraint.Dimension {
				identity = true
				break
			}
		}
		if !identity {
			return resource.NewError("UNSUPPORTED", "Graph observations do not prove constrained query-only membership.")
		}
	}
	return nil
}

func cloneTargetBinding(binding TargetBinding) TargetBinding {
	binding.IdentityDimensions = slices.Clone(binding.IdentityDimensions)
	binding.Target.Scope = slices.Clone(binding.Target.Scope)
	for i := range binding.Target.Scope {
		if binding.Target.Scope[i].Values != nil {
			values := slices.Clone(*binding.Target.Scope[i].Values)
			binding.Target.Scope[i].Values = &values
		}
	}
	return binding
}

func cloneBoundSet(set boundSet) boundSet {
	set.declarations = slices.Clone(set.declarations)
	for i := range set.declarations {
		decl := &set.declarations[i]
		decl.TargetScope = slices.Clone(decl.TargetScope)
		decl.ScopeExtractors = slices.Clone(decl.ScopeExtractors)
		if decl.Extractor != nil {
			extractor := *decl.Extractor
			extractor.LabelSelector = maps.Clone(extractor.LabelSelector)
			decl.Extractor = &extractor
		}
	}
	set.bindings.Source = cloneTargetBinding(set.bindings.Source)
	set.bindings.Targets = slices.Clone(set.bindings.Targets)
	for i := range set.bindings.Targets {
		set.bindings.Targets[i] = cloneTargetBinding(set.bindings.Targets[i])
	}
	return set
}

func (g *RelationshipGraph) GetBoundDeclarations(plugin string, route resource.AccessRoute, sourceType string) ([]resource.RelationshipDescriptor, DeclarationBindings, bool) {
	set, ok := g.boundSnapshot(plugin, route, sourceType)
	if !ok {
		return nil, DeclarationBindings{}, false
	}
	copy := cloneBoundSet(*set)
	return copy.declarations, copy.bindings, ok
}

func (g *RelationshipGraph) boundSnapshot(plugin string, route resource.AccessRoute, sourceType string) (*boundSet, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	key := declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType}
	if g.sourceTypeExcluded(plugin, route, sourceType) {
		return nil, false
	}
	if set, ok := g.boundDeclarations[key]; ok {
		return set, true
	}
	if g.missingSnapshots == nil {
		g.missingSnapshots = make(map[declMapKey]*boundSet)
	}
	if g.missingSnapshots[key] == nil {
		g.missingSnapshots[key] = &boundSet{}
	}
	return g.missingSnapshots[key], false
}

// currentSnapshot is checked while holding g.mu at every derived publication.
func (g *RelationshipGraph) currentSnapshot(source GraphNode, snapshot *boundSet) bool {
	return snapshot != nil && g.boundDeclarations[declMapKey{pluginID: source.PluginID, connectionID: source.Route.Connection, resourceKey: source.Reference.Address.Type}] == snapshot
}

func (g *RelationshipGraph) addBoundEdge(edge GraphEdge, source GraphNode, selector bool, snapshot *boundSet) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.currentSnapshot(source, snapshot) {
		return
	}
	g.addEdgeLocked(storedEdge{GraphEdge: edge, declarer: source.Key(), selector: selector})
}

func (g *RelationshipGraph) ClearDeclarationsForConnection(plugin string, route resource.AccessRoute) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.declarationCatalogs, ConnectionRef{plugin, route.Connection})
	g.retireDeclarationsLocked(plugin, route, "")
	for key := range g.boundDeclarations {
		if key.pluginID == plugin && key.connectionID == route.Connection {
			delete(g.boundDeclarations, key)
		}
	}
	for key, entries := range g.selectorCache {
		for _, entry := range entries {
			if entry.node.PluginID == plugin && entry.node.Route == route {
				delete(g.selectorCache, key)
			}
			break
		}
	}
	for key, entry := range g.unresolved {
		if entry.node.PluginID == plugin && entry.node.Route == route {
			delete(g.unresolved, key)
		}
	}
	for key := range g.declarationProblems {
		if key.pluginID == plugin && key.connectionID == route.Connection {
			delete(g.declarationProblems, key)
		}
	}
}

func (g *RelationshipGraph) unresolvedNode(node GraphNode, reason string, snapshot *boundSet) {
	g.mu.Lock()
	defer g.mu.Unlock()
	// Missing declarations also have a snapshot token. Retirement changes that
	// token, so absence -> publication -> absence cannot admit an old error.
	key := declMapKey{pluginID: node.PluginID, connectionID: node.Route.Connection, resourceKey: node.Reference.Address.Type}
	current := g.boundDeclarations[key]
	if current == nil {
		current = g.missingSnapshots[key]
	}
	if snapshot == nil || current != snapshot {
		return
	}
	if g.unresolved == nil {
		g.unresolved = make(map[string]unresolvedEntry)
	}
	g.unresolved[node.Key()] = unresolvedEntry{node, reason}
	g.markChanged(node.PluginID, node.Route.Connection)
}

// CheckComplete rejects whole-result reads when this route has unresolved extraction.
func (g *RelationshipGraph) CheckComplete(plugin string, route resource.AccessRoute) error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	var first error
	for key, err := range g.declarationProblems {
		if key.pluginID != plugin || key.connectionID != route.Connection {
			continue
		}
		code := resource.ErrorCode(err)
		var host *apperror.AppError
		if code == "FORBIDDEN" || code == "UNAUTHORIZED" || code == "PERMISSION_DENIED" || (errors.As(err, &host) && (host.Status == 401 || host.Status == 403)) {
			return err
		}
		if first == nil {
			first = err
		}
	}
	if first != nil {
		return first
	}
	for _, entry := range g.unresolved {
		if entry.node.PluginID == plugin && entry.node.Route == route {
			return resource.NewError("UNAVAILABLE", "graph relationships incomplete: "+entry.reason)
		}
	}
	return nil
}

func bindingMatches(binding TargetBinding, node GraphNode) bool {
	target, address := binding.Target, node.Reference.Address
	if target.Route != node.Route || target.Provider != address.Provider || target.Authority != address.Authority || target.Type != address.Type {
		return false
	}
	return exactScope(binding, address.Scope) && queryScopeMatches(target.Scope, address.Scope)
}

// Query-only any imposes no identity requirement. Restricted dimensions missing
// from identity remain unproven: address matching never establishes native filter
// truth or complete query coverage.
func queryScopeMatches(query resource.QueryScope, scope []resource.ScopeEntry) bool {
	for _, constraint := range query {
		found := constraint.Match == resource.ScopeAny
		for _, item := range scope {
			if item.Dimension == constraint.Dimension {
				if constraint.Match == resource.ScopeAny {
					found = true
				} else if constraint.Match == resource.ScopeOneOf && constraint.Values != nil {
					for _, value := range *constraint.Values {
						if value == item.Value {
							found = true
						}
					}
				}
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func exactScope(binding TargetBinding, scope []resource.ScopeEntry) bool {
	if len(binding.IdentityDimensions) != len(scope) {
		return false
	}
	seen := make(map[string]bool, len(scope))
	for _, item := range scope {
		if seen[item.Dimension] {
			return false
		}
		seen[item.Dimension] = true
		found := false
		for _, dimension := range binding.IdentityDimensions {
			if dimension.Name == item.Dimension && (item.Value != "" || dimension.AllowEmpty) {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// RecordDeclarationError records a failed host admission without inventing identity.
func (g *RelationshipGraph) RecordDeclarationError(plugin string, route resource.AccessRoute, sourceType string, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err == nil {
		delete(g.declarationProblems, declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType})
		return
	}
	g.retireDeclarationsLocked(plugin, route, sourceType)
	if g.declarationProblems == nil {
		g.declarationProblems = make(map[declMapKey]error)
	}
	g.declarationProblems[declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType}] = err
	delete(g.boundDeclarations, declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType})
	if sourceType == "" {
		for key := range g.boundDeclarations {
			if key.pluginID == plugin && key.connectionID == route.Connection {
				delete(g.boundDeclarations, key)
			}
		}
	}
	for key, entries := range g.selectorCache {
		for _, entry := range entries {
			if entry.node.PluginID == plugin && entry.node.Route == route && entry.node.Reference.Address.Type == sourceType {
				delete(g.selectorCache, key)
			}
			break
		}
	}
	g.markChanged(plugin, route.Connection)
}

// retireDeclarationsLocked withdraws derived observations before rules change.
func (g *RelationshipGraph) retireDeclarationsLocked(plugin string, route resource.AccessRoute, sourceType string) {
	for key := range g.missingSnapshots {
		if key.pluginID == plugin && key.connectionID == route.Connection && (sourceType == "" || key.resourceKey == sourceType) {
			delete(g.missingSnapshots, key)
		}
	}
	matches := func(node GraphNode) bool {
		return node.PluginID == plugin && node.Route == route && (sourceType == "" || node.Reference.Address.Type == sourceType)
	}
	for key := range g.forward {
		g.removeMatching(g.forward, g.reverse, key, func(edge storedEdge) bool {
			if edge.declarer == "" {
				return false
			}
			if edge.declarer == edge.Source.Key() {
				return matches(edge.Source)
			}
			return matches(edge.Target)
		}, true)
	}
	for key, entries := range g.selectorCache {
		for _, entry := range entries {
			if matches(entry.node) {
				delete(g.selectorCache, key)
			}
			break
		}
	}
	for key, entry := range g.unresolved {
		if matches(entry.node) {
			delete(g.unresolved, key)
		}
	}
}

// SetNoDeclarations records a successful empty provider declaration response.
// No resource identity is needed because no extraction or citation can follow.
func (g *RelationshipGraph) SetNoDeclarations(plugin string, route resource.AccessRoute, sourceType string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	key := declMapKey{pluginID: plugin, connectionID: route.Connection, resourceKey: sourceType}
	if existing := g.boundDeclarations[key]; existing != nil && existing.noRules {
		delete(g.declarationProblems, key)
		return
	}
	g.retireDeclarationsLocked(plugin, route, sourceType)
	if g.boundDeclarations == nil {
		g.boundDeclarations = make(map[declMapKey]*boundSet)
	}
	g.boundDeclarations[key] = &boundSet{noRules: true}
	delete(g.declarationProblems, key)
	g.markChanged(plugin, route.Connection)
}
