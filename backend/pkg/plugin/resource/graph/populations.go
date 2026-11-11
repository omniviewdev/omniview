package graph

import resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

// SelectorDemand is one actual node/direction in a bounded graph traversal.
// It does not grant access; the resource owner admits each resulting target.
type SelectorDemand struct {
	Node      GraphNode
	Direction Direction
}

// VisitSelectorTargets derives populations from extracted selector scopes, not
// guessed namespace conventions. The callback must not mutate this graph.
func (g *RelationshipGraph) VisitSelectorTargets(demands []SelectorDemand, visit func(resource.ReadTarget) error) error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	for _, entries := range g.selectorCache {
		for _, entry := range entries {
			required := false
			for _, demand := range demands {
				from, to := entry.node.Reference.Address.Type, entry.decl.TargetType
				if entry.decl.Direction == resource.EdgeIncoming {
					from, to = to, from
				}
				if !((demand.Direction == Outgoing && from == demand.Node.Reference.Address.Type) || (demand.Direction == Incoming && to == demand.Node.Reference.Address.Type)) {
					continue
				}
				declaring := (demand.Direction == Outgoing && entry.decl.Direction != resource.EdgeIncoming) || (demand.Direction == Incoming && entry.decl.Direction == resource.EdgeIncoming)
				if declaring {
					required = entry.node.PluginID == demand.Node.PluginID && entry.node.Route == demand.Node.Route && entry.node.Key() == demand.Node.Key()
				} else {
					required = bindingMatches(entry.binding, demand.Node) && scopeMatches(entry.decl.TargetScope, demand.Node.Reference.Address.Scope)
				}
				if required {
					break
				}
			}
			if !required {
				continue
			}
			target := entry.binding.Target
			target.Scope = make(resource.QueryScope, len(entry.binding.Target.Scope))
			for i, constraint := range entry.binding.Target.Scope {
				target.Scope[i] = constraint
				for _, scope := range entry.decl.TargetScope {
					if scope.Dimension == constraint.Dimension {
						values := []string{scope.Value}
						target.Scope[i].Match, target.Scope[i].Values = resource.ScopeOneOf, &values
						break
					}
				}
			}
			if err := visit(target); err != nil {
				return err
			}
		}
	}
	return nil
}

// SelectorScratchBytes bounds the temporary immutable selector-entry snapshot
// used while matching one changed candidate, including slice growth.
func (g *RelationshipGraph) SelectorScratchBytes() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return 1024 + 1024*g.selectorCount
}
