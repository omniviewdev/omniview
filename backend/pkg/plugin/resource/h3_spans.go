package resource

import (
	"context"
	"errors"
	"io"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func h3StartOperation(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, func(*error)) {
	ctx, span := tracer.Start(ctx, name, trace.WithAttributes(attrs...))
	return ctx, func(err *error) {
		defer span.End()
		outcome := resourceOutcomeSuccess
		if err != nil && *err != nil {
			outcome = resourceOutcomeFailure
			if errors.Is(*err, context.Canceled) {
				outcome = resourceOutcomeCanceled
			}
			telemetryutil.RecordError(span, *err)
		}
		span.SetAttributes(attribute.String("outcome", outcome))
	}
}

func h3Close(closer io.Closer, operation string) {
	if err := closer.Close(); err != nil {
		logging.Default().Debugw(
			context.Background(),
			"resource cleanup failed",
			"operation",
			operation,
			"errorClass",
			telemetryutil.ErrorClass(err),
		)
	}
}
