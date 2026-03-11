package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
	exp, err := NewLogExporter(context.Background(), "localhost:14318", "", "")
	require.NoError(t, err)
	assert.NotNil(t, exp)
	assert.NoError(t, exp.Shutdown(context.Background()))
}

func TestNoopTraceExporter(t *testing.T) {
	exp := NewNoopTraceExporter()
	assert.NotNil(t, exp)
	assert.NoError(t, exp.ExportSpans(context.Background(), nil))
	assert.NoError(t, exp.Shutdown(context.Background()))
}
