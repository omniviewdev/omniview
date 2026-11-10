package telemetry

import (
	"runtime"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

const (
	clientIDResourceKey = attribute.Key("omniview.client.id")
	maxClientIDLength   = 64
)

// IsValidClientID accepts an optional, bounded identifier safe for telemetry labels.
func IsValidClientID(id string) bool {
	if len(id) > maxClientIDLength {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-', c == '.':
		default:
			return false
		}
	}
	return true
}

func clientIDFromResource(res *resource.Resource) string {
	if res == nil {
		return ""
	}
	value, ok := res.Set().Value(clientIDResourceKey)
	if !ok || value.Type() != attribute.STRING {
		return ""
	}
	return value.AsString()
}

func resourceWithClientID(res *resource.Resource, id string) *resource.Resource {
	attrs := make([]attribute.KeyValue, 0, len(res.Attributes())+1)
	for _, kv := range res.Attributes() {
		if kv.Key != clientIDResourceKey {
			attrs = append(attrs, kv)
		}
	}
	if id != "" {
		attrs = append(attrs, clientIDResourceKey.String(id))
	}
	return resource.NewWithAttributes(res.SchemaURL(), attrs...)
}

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
