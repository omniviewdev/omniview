package resource

import (
	"context"
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Admission retains the declared sequence until domain validation rejects
// duplicate dimensions. Invocation targets are route inputs, never grants.
func referenceTarget(pluginID string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) invocation.Target {
	encoded, _ := json.Marshal(reference.Address.Scope)
	return invocation.Target{Provider: pluginID, Connection: route.Connection,
		ResourceType: reference.Address.Type, Object: reference.Address.ID,
		Scope: map[string]string{"resource-scope": string(encoded), "authority": reference.Address.Authority}}
}

func referenceQueryTarget(pluginID string, target sdkresource.ReadTarget, reference sdkresource.ResourceReference) invocation.Target {
	out := referenceTarget(pluginID, target.Route, reference)
	encoded, _ := json.Marshal(target.Scope)
	out.Scope["query-scope"] = string(encoded)
	return out
}

func readTarget(pluginID string, target sdkresource.ReadTarget) invocation.Target {
	encoded, _ := json.Marshal(target.Scope)
	return invocation.Target{Provider: pluginID, Connection: target.Route.Connection,
		ResourceType: target.Type, Scope: map[string]string{"query-scope": string(encoded), "authority": target.Authority}}
}

func finishResource(ctx context.Context, err *error) {
	if *err == nil {
		*err = ctx.Err()
	}
	if *err == nil {
		return
	}
	request, _ := invocation.FromContext(ctx)
	*err = apperror.ForResource(*err, request.ID())
}

func (c *controller) admit(ctx context.Context, operation string, target invocation.Target) (context.Context, error) {
	ctx, err := c.boundary.Admit(ctx, operation, target)
	if err != nil {
		return ctx, err
	}
	request, _ := invocation.FromContext(ctx)
	session := sdkresource.Session{RequestID: request.ID(), RequesterID: string(request.Principal().Origin()), PluginID: target.Provider}
	if target.Connection != "" {
		session.Connection = &sdktypes.Connection{ID: target.Connection}
	}
	return sdkresource.WithSession(ctx, session), nil
}
