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

func (c *controller) admitUpdateTarget(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error {
	if err := c.validateReadTarget(ctx, pluginID, target); err != nil {
		return err
	}
	_, catalog, err := c.routeCatalog(ctx, pluginID, target.Route)
	if err != nil {
		return err
	}
	_, err = resourcev2.AdmitCatalogOperation(catalog, target)
	return err
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
	for _, target := range targets {
		if _, err := c.admit(ctx, "resource.StartConnectionWatch", readTarget(pluginID, target)); err != nil {
			return err
		}
		if err := c.admitUpdateTarget(ctx, pluginID, target); err != nil {
			return err
		}
	}
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return err
	}
	return provider.StartConnectionWatch(ctx, targets)
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
	provider, err := c.updateProvider(ctx, pluginID)
	if err != nil {
		return nil, err
	}
	summary, err := provider.GetWatchState(ctx, route)
	if err != nil {
		return nil, err
	}
	if summary == nil || summary.Route != route || summary.Guarantee != resourcev2.BestEffortGuarantee {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Invalid best-effort update summary.")
	}
	return summary, nil
}
func (c *controller) EnsureResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) (retErr error) {
	ctx, err := c.admit(ctx, "resource.EnsureResourceWatch", readTarget(pluginID, target))
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	if err := c.admitUpdateTarget(ctx, pluginID, target); err != nil {
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
	if err := c.admitUpdateTarget(ctx, pluginID, target); err != nil {
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
