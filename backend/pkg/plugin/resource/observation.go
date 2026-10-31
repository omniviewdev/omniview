package resource

import (
	"context"
	"crypto/sha256"
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Observation is an opaque, retained advertisement of one native route catalog.
// Its private admission identity cannot be supplied by an external caller.
type Observation struct {
	admission catalogAdmission
	plugin    string
	route     resourcev2.AccessRoute
	digest    [32]byte
}
type observationKey struct{}

// WithObservation retains discovery provenance until the actual native admission.
func WithObservation(ctx context.Context, observation Observation) context.Context {
	return context.WithValue(ctx, observationKey{}, observation)
}

// ObserveCatalog captures catalog and native generation in one acquisition.
func (c *controller) ObserveCatalog(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (resourcev2.Catalog, Observation, error) {
	admission, catalog, err := c.routeCatalog(ctx, pluginID, route)
	if err != nil {
		return resourcev2.Catalog{}, Observation{}, err
	}
	if err := c.observeCatalogBinding(context.WithValue(ctx, sourceEpochKey{}, admission.epoch), pluginID, route, catalog, admission); err != nil {
		return resourcev2.Catalog{}, Observation{}, err
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		return resourcev2.Catalog{}, Observation{}, err
	}
	var retained resourcev2.Catalog
	if err := json.Unmarshal(encoded, &retained); err != nil {
		return resourcev2.Catalog{}, Observation{}, err
	}
	return retained, Observation{admission: admission, plugin: pluginID, route: route, digest: sha256.Sum256(encoded)}, nil
}

func checkObservedCatalog(ctx context.Context, pluginID string, route resourcev2.AccessRoute, catalog resourcev2.Catalog) error {
	if _, present := resourcev2.CatalogRevisionForRouteFromContext(ctx, catalog.Provider, route); present {
		if err := resourcev2.CheckCatalogRevisionForRoute(ctx, catalog, route); err != nil {
			return err
		}
	}
	observed, ok := ctx.Value(observationKey{}).(Observation)
	if !ok {
		return nil
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		return err
	}
	if observed.plugin != pluginID || observed.route != route || observed.digest != sha256.Sum256(encoded) {
		return resourcev2.NewError("RESET_REQUIRED", "Advertised resource catalog changed; discover tools again.")
	}
	return nil
}

// AdmitObservation authorizes delivery of a retained source-page remainder.
// Cached records cannot bypass the same operation's current native admission.
func (c *controller) AdmitObservation(ctx context.Context, pluginID string, route resourcev2.AccessRoute, operation string, target resourcev2.ReadTarget) (retErr error) {
	ctx, err := c.admit(ctx, operation, readTarget(pluginID, target))
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	_, catalog, err := c.routeCatalog(ctx, pluginID, route)
	if err != nil {
		return err
	}
	return checkObservedCatalog(ctx, pluginID, route, catalog)
}

// ResolveToolTarget resolves identity and scope without demanding read support or
// choosing an undeclared representation for independent write-only operations.
func (c *controller) ResolveToolTarget(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (_target resourcev2.ReadTarget, retErr error) {
	ctx, err := c.admit(ctx, "resource.ResolveTarget", invocation.Target{Provider: pluginID, Connection: route.Connection, ResourceType: resourceType})
	if err != nil {
		return _target, err
	}
	defer finishResource(ctx, &retErr)
	admission, catalog, err := c.routeCatalog(ctx, pluginID, route)
	if err != nil {
		return _target, err
	}
	for _, descriptor := range catalog.Types {
		if descriptor.Type != resourceType {
			continue
		}
		authority, err := c.resolveAuthority(ctx, pluginID, route, catalog, admission, resourceType)
		if err != nil {
			return _target, err
		}
		scope := make(resourcev2.QueryScope, 0, len(descriptor.QueryDimensions))
		for _, dimension := range descriptor.QueryDimensions {
			scope = append(scope, resourcev2.ScopeConstraint{Dimension: dimension.Name, Match: resourcev2.ScopeAny})
		}
		return resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Authority: authority.Authority, Type: resourceType, Scope: scope}, nil
	}
	return _target, resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
}
