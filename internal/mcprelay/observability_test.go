package mcprelay

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func TestObserveMiddlewareSpansWithoutArguments(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	r := &Relay{log: logging.NewNop(), registered: map[string]bool{"known_tool": true}}
	call := func(name string, result mcp.Result, err error) {
		handler := r.observeMiddleware()(func(context.Context, string, mcp.Request) (mcp.Result, error) {
			return result, err
		})
		req := &mcp.CallToolRequest{Params: &mcp.CallToolParamsRaw{
			Name: name, Arguments: []byte(`{"password":"arg-secret-9"}`),
		}}
		_, _ = handler(context.Background(), "tools/call", req)
	}
	call("known_tool", &mcp.CallToolResult{}, nil)
	call("attacker/../name", nil, errors.New("backend said token=abc123"))
	call("known_tool", &mcp.CallToolResult{IsError: true}, nil)

	spans := exporter.GetSpans()
	require.Len(t, spans, 3)
	for _, span := range spans {
		require.Equal(t, "mcp.relay.tools/call", span.Name)
		for _, kv := range span.Attributes {
			require.NotContains(t, kv.Value.String(), "arg-secret-9")
			require.NotContains(t, kv.Value.String(), "abc123")
			require.NotContains(t, kv.Value.String(), "attacker")
		}
		require.NotContains(t, span.Status.Description, "abc123")
	}
	attrs := func(i int) map[string]string {
		m := map[string]string{}
		for _, kv := range spans[i].Attributes {
			m[string(kv.Key)] = kv.Value.String()
		}
		return m
	}
	require.Equal(t, "known_tool", attrs(0)["tool"])
	require.Equal(t, "success", attrs(0)["outcome"])
	require.Equal(t, "unknown", attrs(1)["tool"])
	require.Equal(t, "failure", attrs(1)["outcome"])
	require.Equal(t, "tool_error", attrs(2)["error_class"])
}

func TestListConnectionsFailureLogsClassOnly(t *testing.T) {
	sink := &logtest.RecordingSink{}
	r := &Relay{
		log: logging.New(logging.Config{
			Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
		}),
		connections: &fakeConnections{stateErr: errors.New("provider said token=abc123 at https://u:pw-secret@cluster")},
	}
	require.Nil(t, r.allowedConnections(context.Background(), &Config{}))
	var warned bool
	for _, rec := range sink.Records() {
		if rec.Message == "mcp relay: list connections" {
			warned = true
			require.Equal(t, logging.LevelWarn, rec.Level)
		}
		for _, f := range rec.Fields {
			require.NotContains(t, fmt.Sprint(f.Value), "abc123")
			require.NotContains(t, fmt.Sprint(f.Value), "pw-secret")
		}
	}
	require.True(t, warned)
	got := errorLogFields(errors.New("x"), "port", 1)
	require.Equal(t, []any{
		"port", 1, "errorClass", telemetryutil.ErrorClass(errors.New("x")), "errorType", "*errors.errorString",
	}, got)
}
