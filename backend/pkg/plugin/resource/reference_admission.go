package resource

import (
	"context"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ReferenceAdmitter admits a native utility against one exact resource catalog.
// It does not fetch a resource body or grant resource Get permission.
type ReferenceAdmitter func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (context.Context, error)

// AdmitReference is native-only; utilities supply their actual fixed operation.
func (c *controller) AdmitReference(ctx context.Context, operation string, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (admitted context.Context, retErr error) {
	switch operation {
	case "exec.CreateSession", "logs.CreateSession", "networker.StartResourcePortForwardingSession", "metric.Query", "metric.Subscribe":
	default:
		return ctx, resourcev2.NewError("INVALID_REQUEST", "Unsupported resource reference utility operation.")
	}
	ctx, err := c.admit(ctx, operation, referenceTarget(pluginID, route, reference))
	if err != nil {
		return ctx, err
	}
	defer finishResource(ctx, &retErr)
	if route.Connection == "" || !utf8.ValidString(route.Connection) {
		return ctx, resourcev2.NewError("INVALID_REQUEST", "An explicit access route is required.")
	}
	if err := resourcev2.ValidateAddress(reference.Address); err != nil {
		return ctx, err
	}
	if reference.Incarnation != nil && (*reference.Incarnation == "" || !utf8.ValidString(*reference.Incarnation)) {
		return ctx, resourcev2.NewError("INVALID_REQUEST", "Invalid incarnation token.")
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return ctx, err
	}
	defer cleanup()
	sessionCtx, catalog, err := c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, reference.Address.Type, &reference)
	if err != nil {
		return ctx, err
	}
	if len(catalog.Revision) > resourcev2.MaxCatalogRevisionBytes {
		return ctx, resourcev2.NewError("RESOURCE_LIMIT", "The accepted catalog revision exceeds the transport limit.")
	}
	if err := resourcev2.ValidateCatalogRevision(catalog.Revision); err != nil {
		return ctx, err
	}
	var scope resourcev2.QueryScope
	for _, descriptor := range catalog.Types {
		if descriptor.Type == reference.Address.Type {
			scope, err = resourcev2.ScopeForAddress(reference.Address, descriptor)
			if err != nil {
				return ctx, err
			}
			break
		}
	}
	// Keep the original request lifetime. The temporary catalog acquisition
	// context is canceled on return and must never own the utility operation.
	admitted = context.WithValue(ctx, sourceEpochKey{}, captureCatalogAdmission(sessionCtx, generation).epoch)
	admitted = resourcev2.WithCatalogRevision(admitted, catalog.Revision)
	target := resourcev2.ReadTarget{Route: route, Provider: reference.Address.Provider, Authority: reference.Address.Authority, Type: reference.Address.Type, Scope: scope}
	admitted, err = c.boundary.Reauthorize(admitted, referenceQueryTarget(pluginID, target, reference))
	if err != nil {
		return admitted, err
	}
	if err := c.currentGeneration(admitted, pluginID, generation); err != nil {
		return admitted, err
	}
	request, _ := invocation.FromContext(admitted)
	admitted = resourcev2.WithSession(admitted, resourcev2.Session{Connection: connectionForRoute(route), RequestID: request.ID(), RequesterID: string(request.Principal().Origin()), PluginID: pluginID})
	return admitted, nil
}
