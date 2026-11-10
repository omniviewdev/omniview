package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOTLPSignalURL(t *testing.T) {
	tests := []struct {
		endpoint string
		signal   string
		want     string
	}{
		{"localhost:4318", "traces", "http://localhost:4318/v1/traces"},
		{"https://gateway.example/otlp", "traces", "https://gateway.example/otlp/v1/traces"},
		{"https://gateway.example/otlp/", "metrics", "https://gateway.example/otlp/v1/metrics"},
		{"https://gateway.example/otlp/v1/traces", "logs", "https://gateway.example/otlp/v1/logs"},
		{"https://gateway.example/custom", "traces", "https://gateway.example/custom"},
	}
	for _, tt := range tests {
		t.Run(tt.endpoint+"/"+tt.signal, func(t *testing.T) {
			assert.Equal(t, tt.want, otlpSignalURL(tt.endpoint, tt.signal))
		})
	}
}

func TestNewTraceExporter(t *testing.T) {
	exp, err := NewTraceExporter(context.Background(), "localhost:14318", "", "")
	require.NoError(t, err)
	assert.NotNil(t, exp)
	assert.NoError(t, exp.Shutdown(context.Background()))
}

func TestNewTraceExporterWithAuth(t *testing.T) {
	exp, err := NewTraceExporter(context.Background(), "localhost:14318", "Authorization", "Basic dGVzdA==")
	require.NoError(t, err)
	assert.NotNil(t, exp)
	assert.NoError(t, exp.Shutdown(context.Background()))
}

func TestNewMetricExporter(t *testing.T) {
	exp, err := NewMetricExporter(context.Background(), "localhost:14318", "", "")
	require.NoError(t, err)
	assert.NotNil(t, exp)
	assert.NoError(t, exp.Shutdown(context.Background()))
}

func TestNewLogExporter(t *testing.T) {
	exp, err := NewLogExporter(context.Background(), "localhost:14318", "", "", "")
	require.NoError(t, err)
	assert.NotNil(t, exp)
	assert.NoError(t, exp.Shutdown(context.Background()))
}

func TestNewLogExporterRejectsTenantAuthConflict(t *testing.T) {
	_, err := NewLogExporter(context.Background(), "http://localhost:14318", "x-scope-orgid", "credential", "tenant")
	require.ErrorContains(t, err, "conflicts")
}

func TestNoopTraceExporter(t *testing.T) {
	exp := NewNoopTraceExporter()
	assert.NotNil(t, exp)
	assert.NoError(t, exp.ExportSpans(context.Background(), nil))
	assert.NoError(t, exp.Shutdown(context.Background()))
}
