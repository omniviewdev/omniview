package resource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// These host envelopes add acquisition membership, never a second resource
// identity. Source cursors remain native cursors, not host query continuations.
type HostRecord struct {
	Key        string                 `json:"key"`
	AddressKey string                 `json:"addressKey"`
	TargetID   string                 `json:"targetId"`
	Record     resourcev2.Record      `json:"record"`
	Route      resourcev2.AccessRoute `json:"route"`
}
type HostSourcePage struct {
	Records    []HostRecord       `json:"records"`
	SourcePage SourcePageMetadata `json:"sourcePage"`
}
type SourcePageMetadata struct {
	NextCursor     *string             `json:"nextCursor,omitempty"`
	Count          resourcev2.Count    `json:"count"`
	Coverage       resourcev2.Coverage `json:"coverage"`
	Consistency    string              `json:"consistency"`
	SourceRevision *string             `json:"sourceRevision,omitempty"`
}
type ResolveTargetRequest struct {
	Route          resourcev2.AccessRoute `json:"route"`
	Type           string                 `json:"type"`
	Representation string                 `json:"representation,omitempty"`
	Scope          resourcev2.QueryScope  `json:"scope"`
}
type AuthorityEvidence struct {
	Continuity  string   `json:"continuity"`
	Limitations []string `json:"limitations"`
}
type ResolvedTarget struct {
	TargetID        string                `json:"targetId"`
	Target          resourcev2.ReadTarget `json:"target"`
	Authority       AuthorityEvidence     `json:"authority"`
	CatalogRevision string                `json:"catalogRevision"`
}
type HostGetRequest struct {
	TargetID string                `json:"targetId"`
	Request  resourcev2.GetRequest `json:"request"`
}
type HostEnumerateRequest struct {
	TargetID string                      `json:"targetId"`
	Request  resourcev2.EnumerateRequest `json:"request"`
}
type HostNativeQueryRequest struct {
	TargetID string                        `json:"targetId"`
	Request  resourcev2.NativeQueryRequest `json:"request"`
}

type finiteState struct {
	mu          sync.Mutex
	authorities map[string]*AuthorityResolver
}

func (c *controller) getLifecycle(ctx context.Context, pluginID string) (resourcev2.ConnectionLifecycle, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil {
		return nil, err
	}
	if !features.Has(resourcev2.FeatureConnections) {
		return nil, resourcev2.NewError("UNSUPPORTED", "Connection lifecycle is not supported.")
	}
	lifecycle, ok := provider.(resourcev2.ConnectionLifecycle)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Connection lifecycle is not supported.")
	}
	return lifecycle, nil
}

func (c *controller) Catalog(ctx context.Context, pluginID string, request resourcev2.CatalogRequest) (_result resourcev2.Catalog, retErr error) {
	ctx, err := c.admit(ctx, "resource.Catalog", invocation.Target{Provider: pluginID, Connection: request.Route.Connection})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	_, catalog, err := c.routeCatalog(ctx, pluginID, request.Route)
	return catalog, err
}

// ResolveTarget makes missing query dimensions explicit as route-local any.
// Omitted representation requires an explicit provider-declared default.
func (c *controller) ResolveTarget(ctx context.Context, pluginID string, request ResolveTargetRequest) (_result ResolvedTarget, retErr error) {
	ctx, err := c.admit(ctx, "resource.ResolveTarget", invocation.Target{Provider: pluginID, Connection: request.Route.Connection, ResourceType: request.Type})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	generation, catalog, err := c.routeCatalog(ctx, pluginID, request.Route)
	if err != nil {
		return _result, err
	}
	var descriptor *resourcev2.ResourceType
	for i := range catalog.Types {
		if catalog.Types[i].Type == request.Type {
			descriptor = &catalog.Types[i]
			break
		}
	}
	if descriptor == nil {
		return _result, resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
	}
	if err := resourcev2.ValidateScope(request.Scope); err != nil {
		return _result, err
	}
	scope := make(resourcev2.QueryScope, 0, len(descriptor.QueryDimensions))
	used := make(map[string]bool, len(request.Scope))
	for _, dimension := range descriptor.QueryDimensions {
		constraint := resourcev2.ScopeConstraint{Dimension: dimension.Name, Match: resourcev2.ScopeAny}
		for _, supplied := range request.Scope {
			if supplied.Dimension == dimension.Name {
				constraint = supplied
				used[supplied.Dimension] = true
				break
			}
		}
		scope = append(scope, constraint)
	}
	if len(used) != len(request.Scope) {
		return _result, resourcev2.NewError("INVALID_REQUEST", "Unknown query scope dimension.")
	}
	if err := resourcev2.ValidateScope(scope, descriptor.QueryDimensions); err != nil {
		return _result, err
	}
	representation := request.Representation
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
	authority, err := c.resolveAuthority(ctx, pluginID, request.Route, catalog, generation, request.Type)
	if err != nil {
		return _result, err
	}
	if err := ctx.Err(); err != nil {
		return _result, err
	}
	return ResolvedTarget{TargetID: uuid.NewString(), Target: resourcev2.ReadTarget{Route: request.Route, Provider: catalog.Provider, Authority: authority.Authority, Type: request.Type, Scope: scope, Representation: representation}, Authority: AuthorityEvidence{Continuity: authority.Continuity, Limitations: authority.Limitations}, CatalogRevision: catalog.Revision}, nil
}

func (c *controller) validateReference(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) error {
	if err := resourcev2.ValidateAddress(reference.Address); err != nil {
		return err
	}
	if reference.Incarnation != nil && (*reference.Incarnation == "" || !utf8.ValidString(*reference.Incarnation)) {
		return resourcev2.NewError("INVALID_REQUEST", "Invalid incarnation token.")
	}
	generation, catalog, err := c.routeCatalog(ctx, pluginID, route)
	if err != nil {
		return err
	}
	authority, err := c.resolveAuthority(ctx, pluginID, route, catalog, generation, reference.Address.Type)
	if err != nil {
		return err
	}
	if reference.Address.Provider != catalog.Provider {
		return resourcev2.NewError("INVALID_REQUEST", "Reference provider is not bound to this route.")
	}
	if reference.Address.Authority != authority.Authority {
		return resourcev2.NewError("RESET_REQUIRED", "Reference authority is not current for this route.")
	}
	for _, descriptor := range catalog.Types {
		if descriptor.Type == reference.Address.Type {
			return resourcev2.ValidateAddress(reference.Address, descriptor.IdentityDimensions)
		}
	}
	return resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
}

func (c *controller) validateReadTarget(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error {
	generation, catalog, err := c.routeCatalog(ctx, pluginID, target.Route)
	if err != nil {
		return err
	}
	authority, err := c.resolveAuthority(ctx, pluginID, target.Route, catalog, generation, target.Type)
	if err != nil {
		return err
	}
	if target.Provider != catalog.Provider {
		return resourcev2.NewError("INVALID_REQUEST", "Target provider is not bound to this route.")
	}
	if target.Authority != authority.Authority {
		return resourcev2.NewError("RESET_REQUIRED", "Target authority is not current for this route.")
	}
	for _, descriptor := range catalog.Types {
		if descriptor.Type != target.Type {
			continue
		}
		if err := resourcev2.ValidateScope(target.Scope, descriptor.QueryDimensions); err != nil {
			return err
		}
		for _, representation := range descriptor.Representations {
			if representation.ID == target.Representation {
				return nil
			}
		}
		return resourcev2.NewError("INVALID_REQUEST", "Representation is not in the route catalog.")
	}
	return resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
}

// targetId is a bounded request-local membership label, not a capability or
// lease. Every operation re-admits its full canonical request independently.
func validateTargetLabel(id string) error {
	if id == "" || len(id) > 128 || !utf8.ValidString(id) {
		return resourcev2.NewError("INVALID_REQUEST", "Invalid target membership label.")
	}
	return nil
}

func rowIdentity(generationID, owner, targetID string, target resourcev2.ReadTarget, reference resourcev2.ResourceReference) (string, string, error) {
	addressKey, err := registry.CanonicalAddressKey(reference.Address)
	if err != nil {
		return "", "", err
	}
	membership, err := json.Marshal([]any{generationID, owner, targetID, target.Route, target.Representation, addressKey, reference.Incarnation})
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(membership)
	return "row:" + hex.EncodeToString(digest[:]), addressKey, nil
}

func envelopeRecord(generationID, owner, targetID string, target resourcev2.ReadTarget, record resourcev2.Record) (HostRecord, error) {
	key, addressKey, err := rowIdentity(generationID, owner, targetID, target, record.Reference)
	if err != nil {
		return HostRecord{}, err
	}
	return HostRecord{Key: key, AddressKey: addressKey, TargetID: targetID, Record: record, Route: target.Route}, nil
}
