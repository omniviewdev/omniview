package window

import (
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
)

//nolint:gochecknoglobals // Package tracer follows the host telemetry convention.
var tracer = otel.Tracer("omniview.window")

// endWindowSpan records the closed outcome/error_class vocabulary and ends the
// span. Error text is never exported.
func endWindowSpan(span trace.Span, err error) {
	if err == nil {
		span.SetAttributes(attribute.String("outcome", "success"))
		span.End()
		return
	}
	class := telemetryutil.ErrorClass(err)
	outcome := "failure"
	if class == "canceled" {
		outcome = "canceled"
	}
	span.SetAttributes(attribute.String("outcome", outcome), attribute.String("error_class", class))
	span.SetStatus(codes.Error, class)
	span.End()
}

// errorLogFields returns log fields describing err by class and Go type only;
// persist/restore errors embed file paths and decoder text that are not logged.
func errorLogFields(err error, kv ...any) []any {
	return append(kv, "errorClass", telemetryutil.ErrorClass(err), "errorType", fmt.Sprintf("%T", err))
}
