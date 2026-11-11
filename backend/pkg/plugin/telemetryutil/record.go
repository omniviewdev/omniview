package telemetryutil

import (
	"context"
	"errors"
	"fmt"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"go.opentelemetry.io/otel/attribute"
	otelcodes "go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// ErrorClass returns a bounded classification without provider-controlled text.
func ErrorClass(err error) string {
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

// RecordError records an error on a span and sets the span status to Error.
// It is a no-op if err is nil.
func RecordError(span trace.Span, err error) {
	if err == nil {
		return
	}
	class := ErrorClass(err)
	span.AddEvent("exception", trace.WithAttributes(attribute.String("exception.type", fmt.Sprintf("%T", err)), attribute.String("error_class", class)))
	span.SetAttributes(attribute.String("error_class", class))
	span.SetStatus(otelcodes.Error, class)
}
