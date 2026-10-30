package logs

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

func TestHeadlessNativeBoundaryCannotBorrowUIRealm(t *testing.T) {
	var observed invocation.Origin
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, _ string, _ invocation.Target) error {
		observed = principal.Origin()
		if observed == invocation.ExternalAgent {
			return errors.New("agent denied")
		}
		return nil
	}))
	ui := invocation.NewScope(invocation.TrustedUI)
	ctrl := &controller{clients: make(map[string]Provider)}
	provider := &headlessSourceProvider{controller: ctrl, closed: make(chan struct{})}
	ctrl.clients["plugin"] = provider
	admit := func(ctx context.Context, operation, plugin string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) (context.Context, error) {
		return boundary.Admit(ctx, operation, invocation.Target{Provider: plugin, Connection: route.Connection, ResourceType: reference.Address.Type, Object: reference.Address.ID})
	}
	ctrl.SetReferenceAdmitter(admit)
	ctrl.SetUIReferenceAdmitter(func(ctx context.Context, operation, plugin string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) (context.Context, error) {
		return admit(ui.Context(ctx), operation, plugin, route, reference)
	})
	ctx := invocation.NewScope(invocation.ExternalAgent).Context(context.Background())
	_, err := ctrl.ReadResourceLogs(ctx, "plugin", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"}, Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{}}}})
	if err == nil || observed != invocation.ExternalAgent {
		t.Fatalf("headless native authorization borrowed UI identity: origin=%q error=%v", observed, err)
	}
	if provider.id != "" {
		t.Fatal("denied agent reached native session creation")
	}
}
