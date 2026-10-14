package diagnostics

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

const (
	logTypeApp = "app"
	logTypeUI  = "ui"
)

// unknownLogTypeError is returned when a log type other than app or ui is requested.
func unknownLogTypeError(logType string) error {
	return apperror.New(
		apperror.TypeValidation,
		http.StatusUnprocessableEntity,
		"Unknown log type",
		fmt.Sprintf("Log type '%s' is not recognized. Valid types are: app, ui.", logType),
	)
}

// DiagnosticsClient provides a client to the UI to be able to record ui side logs,
// view ui and backend logs, as well as other diagnostic imformation.
type DiagnosticsClient struct {
	UI *BackendLogger
}

func NewDiagnosticsClient(dev bool, logDir string) *DiagnosticsClient {
	uiLogger, err := NewBackendLogger("ui", dev, logDir)
	if err != nil {
		log.Fatalf("failed to init UI logger: %v", err)
	}

	return &DiagnosticsClient{
		UI: uiLogger,
	}
}

// Debug records a debug level log to the log sink.
func (c *DiagnosticsClient) Debug(msg string, fields map[string]any) {
	ctx := context.TODO()
	c.UI.Debug(ctx, msg, fields)
}

// Info records an info level log to the log sink.
func (c *DiagnosticsClient) Info(msg string, fields map[string]any) {
	ctx := context.TODO()
	c.UI.Info(ctx, msg, fields)
}

// Warn records a warn level log to the log sink.
func (c *DiagnosticsClient) Warn(msg string, fields map[string]any) {
	ctx := context.TODO()
	c.UI.Warn(ctx, msg, fields)
}

// Error records an error level log to the log sink.
func (c *DiagnosticsClient) Error(msg string, fields map[string]any) {
	ctx := context.TODO()
	c.UI.Error(ctx, msg, fields)
}

// Log records an arbitrary log with a set level to the log sink.
func (c *DiagnosticsClient) Log(level, msg string, fields map[string]any) {
	ctx := context.TODO()
	c.UI.Log(ctx, level, msg, fields)
}

// ReadLog returns the string contents of the log requested.
func (c *DiagnosticsClient) ReadLog(logType string) (string, error) {
	ctx := context.TODO()
	switch logType {
	case logTypeApp:
		return "", apperror.NotImplemented("App log reading", "App log reading is not yet supported.")
	case logTypeUI:
		return c.UI.ReadLog(ctx, "ui")
	}
	return "", unknownLogTypeError(logType)
}

// StartTail starts tailing the log to the event stream.
func (c *DiagnosticsClient) StartTail(logType string) error {
	ctx := context.TODO()
	switch logType {
	case logTypeApp:
		return apperror.NotImplemented("App log reading", "App log reading is not yet supported.")
	case logTypeUI:
		return c.UI.StartTail(ctx, "ui")
	}
	return unknownLogTypeError(logType)
}

// StopTail stops tailing the log to the event stream.
func (c *DiagnosticsClient) StopTail(logType string) error {
	ctx := context.TODO()
	switch logType {
	case logTypeApp:
		return apperror.NotImplemented("App log reading", "App log reading is not yet supported.")
	case logTypeUI:
		return c.UI.StopTail(ctx, "ui")
	}
	return unknownLogTypeError(logType)
}
