package telemetry

import (
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
)

func TestNewResource(t *testing.T) {
	res, err := NewResource("1.0.0", "abc123", "2026-03-11", true)
	require.NoError(t, err)

	attrs := res.Attributes()
	attrMap := make(map[string]attribute.Value, len(attrs))
	for _, a := range attrs {
		attrMap[string(a.Key)] = a.Value
	}

	assert.Equal(t, "omniview", attrMap["service.name"].AsString())
	assert.Equal(t, "1.0.0", attrMap["service.version"].AsString())
	assert.Equal(t, "abc123", attrMap["omniview.git_commit"].AsString())
	assert.Equal(t, "2026-03-11", attrMap["omniview.build_date"].AsString())
	assert.True(t, attrMap["omniview.development"].AsBool())
	assert.NotEmpty(t, attrMap["service.instance.id"].AsString())
	assert.Equal(t, runtime.GOOS, attrMap["os.type"].AsString())
	assert.Equal(t, runtime.GOARCH, attrMap["host.arch"].AsString())
}
