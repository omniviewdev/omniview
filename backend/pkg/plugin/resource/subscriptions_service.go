package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func (c *controller) SubscribeResource(ctx context.Context, pluginID string, subscription HostSubscription) (retErr error) {
	ctx, err := c.admit(ctx, "resource.SubscribeResource", readTarget(pluginID, subscription.Target))
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	if err := c.validateReadTarget(ctx, pluginID, subscription.Target); err != nil {
		return err
	}
	_, catalog, err := c.routeCatalog(ctx, pluginID, subscription.Target.Route)
	if err != nil {
		return err
	}
	if _, err := resourcev2.AdmitCatalogOperation(catalog, subscription.Target); err != nil {
		return err
	}
	request, _ := invocation.FromContext(ctx)
	return c.subs.Subscribe(ctx, request.Principal(), pluginID, subscription)
}

func (c *controller) UnsubscribeResource(ctx context.Context, pluginID string, subscription HostSubscription) (retErr error) {
	ctx, err := c.admit(ctx, "resource.UnsubscribeResource", readTarget(pluginID, subscription.Target))
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	request, _ := invocation.FromContext(ctx)
	return c.subs.Unsubscribe(request.Principal(), pluginID, subscription)
}

func (c *controller) isSubscribed(pluginID, connectionID, resourceType string) bool {
	return c.subs.IsSubscribed(pluginID, connectionID, resourceType)
}
