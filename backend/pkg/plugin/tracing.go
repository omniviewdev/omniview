package plugin

import "go.opentelemetry.io/otel"

var tracer = otel.Tracer("omniview.plugin")
