package telemetry

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestFrontendAttributeSchema(t *testing.T) {
	attrs, err := frontendAttributes("frontend.resource.call", map[string]json.RawMessage{
		"operation": json.RawMessage(`"get"`), "plugin_id": json.RawMessage(`"plugin-1"`),
	})
	require.NoError(t, err)
	require.Len(t, attrs, 2)
	for _, attributes := range []map[string]json.RawMessage{
		{"secret": json.RawMessage(`"token"`)},
		{"operation": json.RawMessage(`"../../etc"`)},
		{"plugin_id": json.RawMessage(`"Bad/ID"`)},
	} {
		_, validationErr := frontendAttributes("frontend.resource.call", attributes)
		require.Error(t, validationErr)
	}
}

func TestFrontendSpanExportsValidatedAttributes(t *testing.T) {
	now := time.Now().Unix()
	s := frontendSpan{
		Name:    "frontend.resource.call",
		TraceID: "0123456789abcdef0123456789abcdef",
		SpanID:  "0123456789abcdef",
		Start:   [2]int64{now, 0}, End: [2]int64{now, 1},
		Attributes: map[string]json.RawMessage{"operation": json.RawMessage(`"get"`)},
	}
	span, err := convertFrontendSpan(s)
	require.NoError(t, err)
	require.Len(t, span.GetAttributes(), 1)
	require.Equal(t, "operation", span.GetAttributes()[0].GetKey())
	require.Equal(t, "get", span.GetAttributes()[0].GetValue().GetStringValue())
	s.Attributes["operation"] = json.RawMessage(`"../../etc"`)
	_, err = convertFrontendSpan(s)
	require.Error(t, err)
}
