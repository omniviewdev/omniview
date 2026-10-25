package resource

import (
	"context"
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Current provider adapter scope is losslessly represented as a JSON namespace
// selection. This is not canonical identity; invocation core assumes no namespace.
func namespaceScope(namespaces ...string) map[string]string {
	if namespaces == nil {
		namespaces = []string{}
	}
	encoded, _ := json.Marshal(namespaces)
	return map[string]string{"namespace-selection": string(encoded)}
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
	session := &sdkresource.Session{RequestID: request.ID(), RequesterID: string(request.Principal().Origin())}
	if target.Connection != "" {
		session.Connection = &sdktypes.Connection{ID: target.Connection}
	}
	return sdkresource.WithSession(ctx, session), nil
}
