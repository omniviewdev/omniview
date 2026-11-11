package plugin

import "go.opentelemetry.io/otel"

//nolint:gochecknoglobals // The package tracer is shared by lifecycle operations.
var tracer = otel.Tracer("omniview.plugin")
