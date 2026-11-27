package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// GuardExtensionRootRoute is a native lifetime fence, not permission to create a shell or use a
// root. Capture it from the authenticated live member during launch, alongside AdmitExtensionRoot
// and ordinary exec reference admission. It deliberately outlives navigation away from that view.
// Input checks require no provider IO, body, source view, catalog acquisition or per-input allocation.
func (c *controller) GuardExtensionRootRoute(ctx context.Context, owner string, proof ExtensionRootProof) (func(context.Context) error, error) {
	if owner != proof.Owner {
		return nil, unavailableExtensionRoot()
	}
	member, err := c.extensionRootMember(ctx, proof, nil)
	if err != nil {
		return nil, err
	}
	window, route, admission := member.window, member.route, member.admission
	address := member.header.reference.Address
	// referenceCurrentLocked needs only this authority binding. Do not retain the source member,
	// its body, an entire observed catalog, or mutable caller-owned reference fields.
	binding := resourcev2.ResourceReference{
		Address:     resourcev2.ResourceAddress{Provider: address.Provider, Authority: address.Authority, Type: address.Type, Scope: nil, ID: ""},
		Incarnation: nil,
	}
	return func(ctx context.Context) error {
		if ctx == nil || !window.OwnedBy(ctx) {
			return unavailableExtensionRoot()
		}
		c.pluginsMu.RLock()
		defer c.pluginsMu.RUnlock()
		if generationErr := c.currentGenerationLocked(ctx, owner, admission.generation); generationErr != nil {
			return generationErr
		}
		g := admission.generation
		if g.ctx.Err() != nil || g.sourceEpoch[route.Connection] != admission.epoch.Epoch || !c.referenceCurrentLocked(owner, route, binding) {
			return resourcev2.NewError("RESET_REQUIRED", "The resource shell connection changed.")
		}
		return nil
	}, nil
}
