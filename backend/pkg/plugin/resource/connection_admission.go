package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// admitConnectionCatalog settles native identity and durable authority before
// readiness. Relationship declarations and object acquisition are not admission.
func (c *controller) admitConnectionCatalog(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (catalogAdmission, resourcev2.Catalog, error) {
	ctx, cancel := context.WithTimeout(ctx, connectionAdmissionTimeout)
	defer cancel()
	return c.admitConnectionCatalogCurrent(ctx, pluginID, route, true, nil)
}

func (c *controller) admitConnectionCatalogCurrent(parent context.Context, pluginID string, route resourcev2.AccessRoute, reacquire bool, expected *catalogAdmission) (catalogAdmission, resourcev2.Catalog, error) {
	provider, generation, ctx, cleanup, err := c.operationGenerationExpected(parent, pluginID, route, expected)
	if err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	defer cleanup()
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err == nil {
		err = resourcev2.ValidateCatalog(catalog)
	}
	if err == nil && catalog.Coverage.Kind != "complete" {
		err = resourcev2.NewError("UNAVAILABLE", "Connection admission requires complete discovered support.")
	}
	if err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	admission := captureCatalogAdmission(ctx, generation)
	_, err = c.resolveCatalogAuthorities(ctx, pluginID, route, catalog, admission)
	if err == nil {
		return admission, catalog, c.currentGeneration(ctx, pluginID, generation)
	}
	if !reacquire || resourcev2.ErrorCode(err) != "RESET_REQUIRED" {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	// Only this observation's single retirement permits reacquisition. An
	// intervening reset, provider replacement, or configuration change cannot.
	binding, bindingErr := resourcev2.CatalogBindingEpoch(catalog.Revision)
	c.pluginsMu.RLock()
	retiredByObservation := bindingErr == nil &&
		c.plugins[pluginID] == generation && generation.ctx.Err() == nil &&
		!generation.sourceChanging[route.Connection] &&
		generation.sourceEpoch[route.Connection] == admission.epoch.Epoch+1 &&
		generation.catalogBindings[route.Connection].active == binding
	c.pluginsMu.RUnlock()
	if !retiredByObservation {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	next := catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: route.Connection, Epoch: admission.epoch.Epoch + 1}}
	return c.admitConnectionCatalogCurrent(parent, pluginID, route, false, &next)
}
