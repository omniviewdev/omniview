package metric

import (
	"context"
	"errors"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
)

// startOp starts an operation span and returns a finisher that records the
// outcome and a bounded error classification. Call it as
// "defer end(&err)" with a named error result. A nil context is replaced by
// context.Background().
func startOp(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, func(*error)) {
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, span := tracer.Start(ctx, name, trace.WithAttributes(attrs...))
	return ctx, func(errp *error) { finishOp(span, errp) }
}

func finishOp(span trace.Span, errp *error) {
	defer span.End()
	var err error
	if errp != nil {
		err = *errp
	}
	switch {
	case err == nil:
		span.SetAttributes(attribute.String("outcome", "success"))
	case errors.Is(err, context.Canceled):
		span.SetAttributes(attribute.String("outcome", "canceled"))
		telemetryutil.RecordError(span, err)
	default:
		span.SetAttributes(attribute.String("outcome", "failure"))
		telemetryutil.RecordError(span, err)
	}
}
