package resource

import (
	"context"
	"errors"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type actionDiagnosticKey struct{}

type actionDiagnostic struct {
	controller      *controller
	target          invocation.Target
	span            trace.Span
	observationDone chan struct{}
}

func (c *controller) beginActionDiagnostic(ctx context.Context, name, pluginID string, request resourcev2.ActionRequest) (context.Context, *actionDiagnostic) {
	ctx, span := tracer.Start(ctx, name)
	d := &actionDiagnostic{controller: c, target: actionTarget(pluginID, request), span: span}
	span.SetAttributes(attribute.String("plugin_id", d.target.Provider), attribute.String("connection_id", d.target.Connection), attribute.String("resource_type", d.target.ResourceType), attribute.String("resource_id", d.target.Object), attribute.String("action", d.target.Action))
	return context.WithValue(ctx, actionDiagnosticKey{}, d), d
}

// actionErrorClass never exports provider-controlled error text or arbitrary codes.
func actionErrorClass(err error) string {
	if err == nil {
		return "none"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	switch code := apperror.ForResource(err, "").Code; code {
	case "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "UNSUPPORTED", "INVALID_REQUEST", "CONFLICT", "ALREADY_EXISTS", "RESOURCE_LIMIT", "RESET_REQUIRED", "PROVIDER_ERROR", "CANCELLED", "TIMEOUT", "UNAVAILABLE", "INTERNAL":
		return code
	default:
		return "other"
	}
}

func (d *actionDiagnostic) record(ctx context.Context, stage, outcome string, err error) {
	if d == nil {
		return
	}
	class := actionErrorClass(err)
	d.span.AddEvent("resource.action."+stage, trace.WithAttributes(attribute.String("outcome", outcome), attribute.String("error_class", class)))
	if d.controller.logger != nil {
		d.controller.logger.Infow(ctx, "resource action lifecycle", "pluginID", d.target.Provider, "connectionID", d.target.Connection, "resourceType", d.target.ResourceType, "resourceID", d.target.Object, "action", d.target.Action, "stage", stage, "outcome", outcome, "errorClass", class)
	}
}

func (d *actionDiagnostic) finish(ctx context.Context, stage string, err error) {
	outcome := "success"
	if err != nil {
		outcome = "error"
		d.span.SetStatus(codes.Error, "action failed")
	}
	d.record(ctx, stage, outcome, err)
	d.span.SetAttributes(attribute.String("outcome", outcome), attribute.String("error_class", actionErrorClass(err)))
	d.span.End()
}

func actionDiagnosticFromContext(ctx context.Context) *actionDiagnostic {
	d, _ := ctx.Value(actionDiagnosticKey{}).(*actionDiagnostic)
	return d
}
