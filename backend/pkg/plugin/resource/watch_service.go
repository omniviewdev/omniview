package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func (c *controller) providerFeatures(ctx context.Context, pluginID string, provider ResourceProvider) (resourcev2.FeatureSet, error) {
	c.pluginsMu.RLock()
	state := c.plugins[pluginID]
	if state != nil && state.featuresReady {
		features := state.features
		c.pluginsMu.RUnlock()
		return features, nil
	}
	c.pluginsMu.RUnlock()
	return resourcev2.DetectFeatures(ctx, provider)
}

func (c *controller) updateProvider(ctx context.Context, pluginID string) (resourcev2.BestEffortUpdateProvider, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil {
		return nil, err
	}
	if !features.Has(resourcev2.FeatureBestEffortUpdates) {
		return nil, resourcev2.NewError("UNSUPPORTED", "Best-effort updates are not supported.")
	}
	updates, ok := provider.(resourcev2.BestEffortUpdateProvider)
	if !ok {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Provider advertised an unavailable update trait.")
	}
	return updates, nil
}

func (c *controller) admitUpdateTarget(ctx context.Context, pluginID string, target resourcev2.ReadTarget) (context.Context, func(), error) {
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, target.Route)
	if err != nil {
		return ctx, func() {}, err
	}
	ctx, _, err = c.admitOperationCatalog(ctx, pluginID, provider, generation, target.Route, target.Authority, target.Provider, target)
	return ctx, cleanup, err
}

func (c *controller) StartConnectionWatch(ctx context.Context, pluginID string, targets []resourcev2.ReadTarget) (retErr error) {
	ctx, err := c.admit(ctx, "resource.StartConnectionWatch", invocation.Target{Provider: pluginID})
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	if len(targets) == 0 {
		return resourcev2.NewError("INVALID_REQUEST", "Explicit admitted update targets are required.")
	}
	// Complete all authorization and capability admission before starting any
	// source. A later denied target must not leave earlier sources running.
	type watchBatchKey struct {
		route    resourcev2.AccessRoute
		revision string
	}
	type watchBatch struct {
		ctx     context.Context
		targets []resourcev2.ReadTarget
	}
	batches := make([]watchBatch, 0, len(targets))
	batchIndexes := make(map[watchBatchKey]int, len(targets))
	for _, target := range targets {
		targetCtx, err := c.admit(ctx, "resource.StartConnectionWatch", readTarget(pluginID, target))
		if err != nil {
			return err
		}
		targetCtx, cleanup, err := c.admitUpdateTarget(targetCtx, pluginID, target)
		defer cleanup()
		if err != nil {
			return err
		}
		revision, _ := resourcev2.CatalogRevisionFromContext(targetCtx)
		key := watchBatchKey{route: target.Route, revision: revision}
		index, exists := batchIndexes[key]
		if !exists {
			index = len(batches)
			batchIndexes[key] = index
			batches = append(batches, watchBatch{ctx: targetCtx})
		}
		batches[index].targets = append(batches[index].targets, target)
	}
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return err
	}
	for _, batch := range batches {
		if err := provider.StartConnectionWatch(batch.ctx, batch.targets); err != nil {
			return err
		}
	}
	return nil
}
func (c *controller) StopConnectionWatch(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (retErr error) {
	ctx, err := c.admit(ctx, "resource.StopConnectionWatch", invocation.Target{Provider: pluginID, Connection: route.Connection})
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return err
	}
	return provider.StopConnectionWatch(ctx, route)
}
func (c *controller) GetWatchState(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (_result *resourcev2.WatchConnectionSummary, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetWatchState", invocation.Target{Provider: pluginID, Connection: route.Connection})
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	raw, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	features, err := c.providerFeatures(ctx, pluginID, raw)
	if err != nil {
		return nil, err
	}
	provider, ok := raw.(resourcev2.BestEffortUpdateProvider)
	if !ok || !features.Has(resourcev2.FeatureBestEffortUpdates) {
		return nil, resourcev2.NewError("UNSUPPORTED", "Best-effort updates are not supported.")
	}
	catalog, err := raw.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		return nil, err
	}
	if err := resourcev2.ValidateCatalog(catalog); err != nil {
		return nil, err
	}
	if err := c.observeCatalogBinding(ctx, pluginID, route, catalog, captureCatalogAdmission(ctx, generation)); err != nil {
		return nil, err
	}
	ctx = resourcev2.WithCatalogRevision(ctx, catalog.Revision)
	summary, err := provider.GetWatchState(ctx, route)
	if err != nil {
		return nil, err
	}
	if summary == nil || summary.Route != route || summary.Guarantee != resourcev2.BestEffortGuarantee {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Invalid best-effort update summary.")
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return nil, err
	}
	return summary, nil
}
func (c *controller) EnsureResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) (retErr error) {
	ctx, err := c.admit(ctx, "resource.EnsureResourceWatch", readTarget(pluginID, target))
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	ctx, cleanup, err := c.admitUpdateTarget(ctx, pluginID, target)
	defer cleanup()
	if err != nil {
		return err
	}
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return err
	}
	return provider.EnsureResourceWatch(ctx, target)
}
func (c *controller) StopResourceWatch(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (retErr error) {
	ctx, err := c.admit(ctx, "resource.StopResourceWatch", invocation.Target{Provider: pluginID, Connection: route.Connection, ResourceType: resourceType})
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return err
	}
	return provider.StopResourceWatch(ctx, route, resourceType)
}
func (c *controller) RestartResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) (retErr error) {
	ctx, err := c.admit(ctx, "resource.RestartResourceWatch", readTarget(pluginID, target))
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	ctx, cleanup, err := c.admitUpdateTarget(ctx, pluginID, target)
	defer cleanup()
	if err != nil {
		return err
	}
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return err
	}
	return provider.RestartResourceWatch(ctx, target)
}
func (c *controller) IsResourceWatchRunning(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (_result bool, retErr error) {
	ctx, err := c.admit(ctx, "resource.IsResourceWatchRunning", invocation.Target{Provider: pluginID, Connection: route.Connection, ResourceType: resourceType})
	if err != nil {
		return false, err
	}
	defer finishResource(ctx, &retErr)
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return false, err
	}
	return provider.IsResourceWatchRunning(ctx, route, resourceType)
}
