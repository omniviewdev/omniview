package telemetry

import (
	"runtime"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// NewResource creates a shared OTel Resource that identifies this Omniview instance.
func NewResource(version, gitCommit, buildDate string, isDev bool) (*resource.Resource, error) {
	return resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("omniview"),
			semconv.ServiceVersion(version),
			attribute.String("omniview.git_commit", gitCommit),
			attribute.String("omniview.build_date", buildDate),
			attribute.Bool("omniview.development", isDev),
			semconv.OSTypeKey.String(runtime.GOOS),
			semconv.HostArchKey.String(runtime.GOARCH),
			attribute.String("service.instance.id", uuid.New().String()),
		),
	)
}
