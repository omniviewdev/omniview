package resource

import (
	"context"
	"fmt"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func subscriptionTestTarget() HostSubscription {
	return HostSubscription{TargetID: "opaque/target:%2F", Target: resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "route/opaque"}, Provider: "provider", Authority: "authority", Type: "type/opaque", Representation: "native", Scope: resourcev2.QueryScope{}}}
}

func TestSubscriptionMembershipRefcountsAndOwnership(t *testing.T) {
	manager := newSubscriptionManager()
	owner := invocation.NewScope(invocation.TrustedUI)
	foreign := invocation.NewScope(invocation.TrustedUI)
	ctx, cancel := context.WithCancel(owner.Context(context.Background()))
	request := subscriptionTestTarget()
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "plugin", request))
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "plugin", request))
	cancel()
	matches := manager.Matching("plugin", request.Target.Route.Connection, request.Target.Type)
	require.Len(t, matches, 1)
	require.Equal(t, owner.Principal(), matches[0].Owner)
	require.NoError(t, matches[0].Context.Err())
	require.NoError(t, manager.Unsubscribe(foreign.Principal(), "plugin", request))
	require.Len(t, manager.Matching("plugin", request.Target.Route.Connection, request.Target.Type), 1)
	require.NoError(t, manager.Unsubscribe(owner.Principal(), "plugin", request))
	require.True(t, manager.IsSubscribed("plugin", request.Target.Route.Connection, request.Target.Type))
	require.NoError(t, manager.Unsubscribe(owner.Principal(), "plugin", request))
	require.False(t, manager.IsSubscribed("plugin", request.Target.Route.Connection, request.Target.Type))
	require.NoError(t, manager.Unsubscribe(owner.Principal(), "plugin", request))
}

func TestSubscriptionMembershipUsesWholeTargetAndOpaqueComponents(t *testing.T) {
	manager := newSubscriptionManager()
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx := owner.Context(context.Background())
	request := subscriptionTestTarget()
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "a/b", request))
	other := request
	other.Target.Authority = "other"
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "a/b", other))
	otherID := request
	otherID.TargetID = "another"
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "a/b", otherID))
	require.Len(t, manager.Matching("a/b", request.Target.Route.Connection, request.Target.Type), 3)
	manager.RemoveAll("a")
	require.Len(t, manager.Matching("a/b", request.Target.Route.Connection, request.Target.Type), 3)
	manager.RemoveAll("a/b")
	require.Empty(t, manager.Matching("a/b", request.Target.Route.Connection, request.Target.Type))
}

func TestSubscriptionMembershipBoundsAndSnapshotsTargets(t *testing.T) {
	manager := newSubscriptionManager()
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx := owner.Context(context.Background())
	request := subscriptionTestTarget()
	values := []string{"original"}
	request.Target.Scope = resourcev2.QueryScope{{Dimension: "zone", Match: resourcev2.ScopeOneOf, Values: &values}}
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "plugin", request))
	values[0] = "changed"
	matches := manager.Matching("plugin", request.Target.Route.Connection, request.Target.Type)
	require.Equal(t, "original", (*matches[0].Target.Scope[0].Values)[0])
	request = subscriptionTestTarget()
	for i := 1; i < maxResourceSubscriptions; i++ {
		request.TargetID = fmt.Sprint(i)
		require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "plugin", request))
	}
	request.TargetID = "overflow"
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(manager.Subscribe(ctx, owner.Principal(), "plugin", request)))
	require.NoError(t, manager.Unsubscribe(owner.Principal(), "plugin", HostSubscription{TargetID: "1", Target: request.Target}))
	require.NoError(t, manager.Subscribe(ctx, owner.Principal(), "plugin", request))
}
