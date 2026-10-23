package devcontract

import (
	"encoding/json"
	"errors"
)

const ProtocolVersion = 1

type Error struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
	Exit    int            `json:"-"`
}

func (e *Error) Error() string { return e.Message }
func Fail(exit int, code, message string) *Error {
	return &Error{Code: code, Message: message, Exit: exit}
}
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var target *Error
	if errors.As(err, &target) {
		return target.Exit
	}
	return 5
}

type Request struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestID"`
	WorkspaceID     string          `json:"workspaceID"`
	Generation      string          `json:"generation"`
	Operation       string          `json:"operation"`
	Params          json.RawMessage `json:"params"`
}
type Response struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestID"`
	WorkspaceID     string          `json:"workspaceID"`
	Generation      string          `json:"generation"`
	OperationID     string          `json:"operationID,omitempty"`
	Status          string          `json:"status"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           *Error          `json:"error,omitempty"`
}

func (r Request) ValidateTarget(workspaceID, generation string) error {
	if r.ProtocolVersion != ProtocolVersion || r.RequestID == "" {
		return Fail(2, "invalid_request", "unsupported protocol or missing request ID")
	}
	if r.WorkspaceID != workspaceID || r.Generation != generation || workspaceID == "" || generation == "" {
		return Fail(4, "stale_target", "workspace or instance generation does not match")
	}
	switch r.Operation {
	case "instance.inspect", "plugin.list", "plugin.get", "plugin.install-archive", "plugin.install-version", "plugin.uninstall", "plugin.dev.link", "plugin.dev.unlink", "plugin.dev.start", "plugin.dev.stop", "plugin.dev.restart", "plugin.dev.rebuild", "plugin.dev.dependencies", "plugin.dev.status", "plugin.dev.logs", "settings.schema", "settings.get", "settings.set", "settings.bulk", "operation.get", "operation.wait":
	default:
		return Fail(2, "unknown_operation", "operation is not allowed")
	}
	if len(r.Params) != 0 && !json.Valid(r.Params) {
		return Fail(2, "invalid_params", "parameters must be valid JSON")
	}
	return nil
}
