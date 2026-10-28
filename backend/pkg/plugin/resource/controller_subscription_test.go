package resource

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func subscriptionTestController(t *testing.T, updateSupport bool) (*controller, HostSubscription) {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "pods")
		if updateSupport {
			catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationUpdate, Guarantee: resourcev2.BestEffortGuarantee})
		}
		return catalog, nil
	}})
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target
	return ctrl, HostSubscription{TargetID: "opaque/target", Target: target}
}

func TestControllerSubscriptionRefcountsAndForeignUnsubscribe(t *testing.T) {
	ctrl, subscription := subscriptionTestController(t, true)
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx := owner.Context(context.Background())
	require.NoError(t, ctrl.SubscribeResource(ctx, "p1", subscription))
	require.NoError(t, ctrl.SubscribeResource(ctx, "p1", subscription))
	foreign := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	require.NoError(t, ctrl.UnsubscribeResource(foreign, "p1", subscription))
	require.Len(t, ctrl.subs.Matching("p1", "conn-1", "pods"), 1)
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "p1", subscription))
	require.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "p1", subscription))
	require.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "p1", subscription))
}

func TestControllerSubscriptionRejectsUnsupportedUpdatesAndForgedTarget(t *testing.T) {
	ctrl, subscription := subscriptionTestController(t, false)
	require.Equal(t, "UNSUPPORTED", requireAppError(t, ctrl.SubscribeResource(testInvocationContext(), "p1", subscription)).Code)
	require.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	ctrl, subscription = subscriptionTestController(t, true)
	subscription.Target.Authority = "forged"
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, ctrl.SubscribeResource(testInvocationContext(), "p1", subscription)).Code)
	require.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestControllerSubscriptionsRemovedOnPluginStop(t *testing.T) {
	ctrl, subscription := subscriptionTestController(t, true)
	require.NoError(t, ctrl.SubscribeResource(testInvocationContext(), "p1", subscription))
	require.NoError(t, ctrl.OnPluginStop("p1", defaultMeta()))
	require.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
}

func TestControllerSubscriptionSeparatesOpaqueTargetIDs(t *testing.T) {
	ctrl, subscription := subscriptionTestController(t, true)
	require.NoError(t, ctrl.SubscribeResource(testInvocationContext(), "p1", subscription))
	second := subscription
	second.TargetID = "opaque/target/other"
	require.NoError(t, ctrl.SubscribeResource(testInvocationContext(), "p1", second))
	require.Len(t, ctrl.subs.Matching("p1", "conn-1", "pods"), 2)
	require.NoError(t, ctrl.UnsubscribeResource(testInvocationContext(), "p1", subscription))
	matches := ctrl.subs.Matching("p1", "conn-1", "pods")
	require.Len(t, matches, 1)
	require.Equal(t, second.TargetID, matches[0].TargetID)
}
