package telemetry

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseFrontendSignals(t *testing.T) {
	payload := `{"logs":[{"message":"test log","level":"info","context":{"component":"TestComponent"}}]}`
	signals, err := parseFrontendSignals(payload)
	assert.NoError(t, err)
	assert.Len(t, signals.Logs, 1)
	assert.Equal(t, "test log", signals.Logs[0].Message)
	assert.Equal(t, "info", signals.Logs[0].Level)
	assert.Equal(t, "TestComponent", signals.Logs[0].Context["component"])
}

func TestParseFrontendSignals_Errors(t *testing.T) {
	payload := `{"errors":[{"type":"TypeError","message":"cannot read property","stacktrace":"at foo.js:12"}]}`
	signals, err := parseFrontendSignals(payload)
	assert.NoError(t, err)
	assert.Len(t, signals.Errors, 1)
	assert.Equal(t, "TypeError", signals.Errors[0].Type)
	assert.Equal(t, "cannot read property", signals.Errors[0].Message)
	assert.Equal(t, "at foo.js:12", signals.Errors[0].Stacktrace)
}

func TestParseFrontendSignals_Measurements(t *testing.T) {
	payload := `{"measurements":[{"type":"web-vital","values":{"lcp":1234.5,"fid":12.3}}]}`
	signals, err := parseFrontendSignals(payload)
	assert.NoError(t, err)
	assert.Len(t, signals.Measurements, 1)
	assert.Equal(t, "web-vital", signals.Measurements[0].Type)
	assert.InDelta(t, 1234.5, signals.Measurements[0].Values["lcp"], 0.01)
}

func TestParseFrontendSignals_InvalidJSON(t *testing.T) {
	_, err := parseFrontendSignals(`{invalid`)
	assert.Error(t, err)
}

func TestParseFrontendSignals_EmptyPayload(t *testing.T) {
	signals, err := parseFrontendSignals(`{}`)
	assert.NoError(t, err)
	assert.Empty(t, signals.Logs)
	assert.Empty(t, signals.Errors)
	assert.Empty(t, signals.Measurements)
}
