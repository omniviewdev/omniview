package resource

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type ResolveReferenceRequest struct {
	Route          resourcev2.AccessRoute  `json:"route"`
	Type           string                  `json:"type"`
	Scope          []resourcev2.ScopeEntry `json:"scope"`
	ID             string                  `json:"id"`
	Incarnation    *string                 `json:"incarnation,omitempty"`
	Representation string                  `json:"representation,omitempty"`
}
type ResolvedReference struct {
	Reference      resourcev2.ResourceReference `json:"reference"`
	Route          resourcev2.AccessRoute       `json:"route"`
	Key            string                       `json:"key"`
	AddressKey     string                       `json:"addressKey"`
	TargetID       string                       `json:"targetId"`
	Representation string                       `json:"representation"`
	Authority      AuthorityEvidence            `json:"authority"`
}

// ResolveReference admits an exact native identity. It never splits IDs, derives
// an incarnation, or uses any/multiple query values to invent an exact reference.
func (c *controller) ResolveReference(ctx context.Context, pluginID string, input ResolveReferenceRequest) (_result ResolvedReference, retErr error) {
	encodedScope, _ := json.Marshal(input.Scope)
	ctx, err := c.admit(ctx, "resource.ResolveReference", invocation.Target{Provider: pluginID, Connection: input.Route.Connection, ResourceType: input.Type, Object: input.ID, Scope: map[string]string{"resource-scope": string(encodedScope)}})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, input.Route)
	if err != nil {
		return _result, err
	}
	defer cleanup()
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: input.Route})
	if err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateCatalog(catalog); err != nil {
		return _result, err
	}
	var descriptor *resourcev2.ResourceType
	for i := range catalog.Types {
		if catalog.Types[i].Type == input.Type {
			descriptor = &catalog.Types[i]
			break
		}
	}
	if descriptor == nil {
		return _result, resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
	}
	representation := input.Representation
	if representation == "" {
		representation = descriptor.DefaultRepresentation
	}
	found := false
	for _, candidate := range descriptor.Representations {
		if candidate.ID == representation {
			found = true
			break
		}
	}
	if !found {
		return _result, resourcev2.NewError("INVALID_REQUEST", "Select an explicit catalog representation.")
	}
	authority, err := c.resolveAuthority(ctx, pluginID, input.Route, catalog, captureCatalogAdmission(ctx, generation), descriptor.Type)
	if err != nil {
		return _result, err
	}
	address := resourcev2.ResourceAddress{Provider: catalog.Provider, Authority: authority.Authority, Type: input.Type, Scope: input.Scope, ID: input.ID}
	if err := resourcev2.ValidateAddress(address, descriptor.IdentityDimensions); err != nil {
		return _result, err
	}
	reference := resourcev2.ResourceReference{Address: address, Incarnation: input.Incarnation}
	request := resourcev2.GetRequest{Route: input.Route, Reference: reference, Representation: representation}
	if err := resourcev2.ValidateGetRequest(request); err != nil {
		return _result, err
	}
	target, err := exactReadTarget(request, *descriptor)
	if err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	principal, _ := invocation.FromContext(ctx)
	targetID := uuid.NewString()
	key, addressKey, err := rowIdentity(generation.generationID, principal.Principal().Owner(), targetID, target, reference)
	if err != nil {
		return _result, err
	}
	return ResolvedReference{Reference: reference, Route: input.Route, Key: key, AddressKey: addressKey, TargetID: targetID, Representation: representation, Authority: AuthorityEvidence{Continuity: authority.Continuity, Limitations: authority.Limitations}}, nil
}

// ValidateReference is native graph-service wiring, not a Wails-bound grant.
// The graph service performs its own invocation admission before calling it.
func (c *controller) ValidateReference(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) error {
	return c.validateReference(ctx, pluginID, route, reference)
}

func (c *controller) Features(ctx context.Context, pluginID string) (_result resourcev2.FeatureSet, retErr error) {
	ctx, err := c.admit(ctx, "resource.Features", invocation.Target{Provider: pluginID})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return _result, err
	}
	return resourcev2.DetectFeatures(ctx, provider)
}
