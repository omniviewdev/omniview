package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// These helpers consume one already validated, complete catalog observation.
// They bind source metadata only; they neither acquire target resources nor infer
// a locator or scope from a provider's opaque type or ID.
func (c *controller) relationshipTypeTarget(ctx context.Context, pluginID string, route resourcev2.AccessRoute, catalog resourcev2.Catalog, admission catalogAdmission, resourceType, operation string) (resourcev2.ReadTarget, []resourcev2.Dimension, error) {
	var descriptor *resourcev2.ResourceType
	for i := range catalog.Types {
		if catalog.Types[i].Type == resourceType {
			descriptor = &catalog.Types[i]
			break
		}
	}
	if descriptor == nil || descriptor.DefaultRepresentation == "" {
		return resourcev2.ReadTarget{}, nil, resourcev2.NewError("UNSUPPORTED", "Relationship binding requires a catalog type and an explicit default representation.")
	}
	target := resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Type: descriptor.Type, Representation: descriptor.DefaultRepresentation, Scope: make(resourcev2.QueryScope, 0, len(descriptor.QueryDimensions))}
	for _, dimension := range descriptor.QueryDimensions {
		target.Scope = append(target.Scope, resourcev2.ScopeConstraint{Dimension: dimension.Name, Match: resourcev2.ScopeAny})
	}
	admitted, err := c.admit(ctx, operation, readTarget(pluginID, target))
	if err != nil {
		return resourcev2.ReadTarget{}, nil, err
	}
	authority, err := c.resolveAuthority(admitted, pluginID, route, catalog, admission, descriptor.Type)
	if err != nil {
		return resourcev2.ReadTarget{}, nil, err
	}
	target.Authority = authority.Authority
	return target, descriptor.IdentityDimensions, nil
}

func (c *controller) relationshipTargets(ctx context.Context, pluginID string, route resourcev2.AccessRoute, catalog resourcev2.Catalog, admission catalogAdmission, declarations []resourcev2.RelationshipDescriptor, operation string) ([]resourcev2.ReadTarget, error) {
	if catalog.Coverage.Kind != "complete" {
		return nil, resourcev2.NewError("UNSUPPORTED", "Relationship target binding requires a complete route catalog.")
	}
	targets := make([]resourcev2.ReadTarget, 0, min(len(declarations), resourcev2.MaxRelationshipTargets))
	seen := make(map[string]bool, min(len(declarations), resourcev2.MaxRelationshipTargets))
	for _, declaration := range declarations {
		if seen[declaration.TargetType] {
			continue
		}
		seen[declaration.TargetType] = true
		if len(targets) >= resourcev2.MaxRelationshipTargets {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Too many relationship target bindings.")
		}
		target, _, err := c.relationshipTypeTarget(ctx, pluginID, route, catalog, admission, declaration.TargetType, operation)
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, nil
}
