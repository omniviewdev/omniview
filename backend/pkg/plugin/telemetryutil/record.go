package telemetryutil

import (
	otelcodes "go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// RecordError records an error on a span and sets the span status to Error.
// It is a no-op if err is nil.
func RecordError(span trace.Span, err error) {
	if err == nil {
		return
	}
	span.RecordError(err)
	span.SetStatus(otelcodes.Error, err.Error())
}
