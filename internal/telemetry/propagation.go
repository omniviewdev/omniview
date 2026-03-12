package telemetry

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

// ExtractContext extracts trace context from a string map carrier into the given parent context.
func ExtractContext(parent context.Context, carrier map[string]string) context.Context {
	return otel.GetTextMapPropagator().Extract(parent, propagation.MapCarrier(carrier))
}

// InjectContext injects the current trace context from ctx into a string map carrier.
func InjectContext(ctx context.Context) map[string]string {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	return map[string]string(carrier)
}
