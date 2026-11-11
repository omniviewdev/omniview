package telemetry

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFrontendAttributeSchema(t *testing.T) {
	attrs, err := frontendAttributes("frontend.resource.call", map[string]json.RawMessage{"operation": json.RawMessage(`"get"`), "plugin_id": json.RawMessage(`"plugin-1"`)})
	require.NoError(t, err)
	require.Len(t, attrs, 2)
	for _, attributes := range []map[string]json.RawMessage{
		{"secret": json.RawMessage(`"token"`)},
		{"operation": json.RawMessage(`"../../etc"`)},
		{"plugin_id": json.RawMessage(`"Bad/ID"`)},
	} {
		_, err := frontendAttributes("frontend.resource.call", attributes)
		require.Error(t, err)
	}
}
