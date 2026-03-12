package telemetry

import "encoding/json"

// FrontendSignals is the JSON envelope sent by the frontend telemetry transport.
type FrontendSignals struct {
	Logs         []FrontendLog         `json:"logs,omitempty"`
	Errors       []FrontendError       `json:"errors,omitempty"`
	Measurements []FrontendMeasurement `json:"measurements,omitempty"`
}

// FrontendLog represents a single log entry from the frontend.
type FrontendLog struct {
	Message string            `json:"message"`
	Level   string            `json:"level"`
	Context map[string]string `json:"context,omitempty"`
}

// FrontendError represents a frontend exception or unhandled error.
type FrontendError struct {
	Type       string `json:"type"`
	Message    string `json:"message"`
	Stacktrace string `json:"stacktrace,omitempty"`
}

// FrontendMeasurement represents a frontend performance measurement.
type FrontendMeasurement struct {
	Type   string             `json:"type"`
	Values map[string]float64 `json:"values,omitempty"`
}

func parseFrontendSignals(payload string) (FrontendSignals, error) {
	var signals FrontendSignals
	err := json.Unmarshal([]byte(payload), &signals)
	return signals, err
}
