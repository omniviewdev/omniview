package apperror

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// statusClientClosedRequest is the non-standard 499 status used for user-cancelled operations.
const statusClientClosedRequest = 499

// AppError is a structured error type based on RFC 7807 Problem Details.
// Its Error() method returns a JSON string so the structured fields survive
// the Wails IPC boundary (Wails calls .Error() and sends the string to JS).
type AppError struct {
	Err         error     `json:"-"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Status      int       `json:"status"`
	Detail      string    `json:"detail"`
	Instance    string    `json:"instance,omitempty"`
	Suggestions []string  `json:"suggestions,omitempty"`
	Actions     []Action  `json:"actions,omitempty"`
	Code        string    `json:"code,omitempty"`
	RequestID   string    `json:"requestId,omitempty"`
	Recovery    string    `json:"recovery,omitempty"`
	Location    *Location `json:"location,omitempty"`
}

// Error returns a JSON-encoded representation so the structured fields
// survive the Wails IPC boundary.
func (e *AppError) Error() string {
	b, err := json.Marshal(e)
	if err != nil {
		return fmt.Sprintf(`{"type":"%s","title":"%s","status":%d,"detail":"json marshal failed: %s"}`,
			e.Type, e.Title, e.Status, err.Error())
	}
	return string(b)
}

// Unwrap returns the underlying error for use with errors.Is / errors.As.
func (e *AppError) Unwrap() error { return e.Err }

// WithSuggestions appends user-facing suggestions to the error.
func (e *AppError) WithSuggestions(suggestions ...string) *AppError {
	e.Suggestions = append(e.Suggestions, suggestions...)
	return e
}

// WithActions appends frontend-renderable actions to the error.
func (e *AppError) WithActions(actions ...Action) *AppError {
	e.Actions = append(e.Actions, actions...)
	return e
}

// WithInstance sets the instance field (specific occurrence context).
func (e *AppError) WithInstance(instance string) *AppError {
	e.Instance = instance
	return e
}

// --- General constructors ---

// New creates a new AppError with the given fields.
func New(errType string, status int, title, detail string) *AppError {
	return &AppError{
		Type:        errType,
		Status:      status,
		Title:       title,
		Detail:      detail,
		Err:         nil,
		Instance:    "",
		Suggestions: nil,
		Actions:     nil,
	}
}

// Wrap wraps an existing error, using err.Error() as the detail.
func Wrap(err error, errType string, status int, title string) *AppError {
	return &AppError{
		Err:         err,
		Type:        errType,
		Status:      status,
		Title:       title,
		Detail:      err.Error(),
		Instance:    "",
		Suggestions: nil,
		Actions:     nil,
	}
}

// WrapWithDetail wraps an existing error with a custom detail message.
func WrapWithDetail(err error, errType string, status int, title, detail string) *AppError {
	return &AppError{
		Err:         err,
		Type:        errType,
		Status:      status,
		Title:       title,
		Detail:      detail,
		Instance:    "",
		Suggestions: nil,
		Actions:     nil,
	}
}

// --- Status-based constructors ---

// NotFound creates a 404 error.
func NotFound(title, detail string) *AppError {
	return New(TypeResourceNotFound, http.StatusNotFound, title, detail)
}

// Forbidden creates a 403 error.
func Forbidden(title, detail string) *AppError {
	return New(TypeResourceForbidden, http.StatusForbidden, title, detail)
}

// Internal wraps an unexpected error as a 500.
func Internal(err error, title string) *AppError {
	return Wrap(err, TypeInternal, http.StatusInternalServerError, title)
}

// Cancelled creates an error for user-cancelled operations.
func Cancelled() *AppError {
	return &AppError{
		Type:        TypeCancelled,
		Status:      statusClientClosedRequest,
		Title:       "Cancelled",
		Detail:      "The operation was cancelled by the user.",
		Err:         nil,
		Instance:    "",
		Suggestions: nil,
		Actions:     nil,
	}
}

// NotImplemented creates a 501 error for features not yet implemented.
func NotImplemented(title, detail string) *AppError {
	return New(TypeNotImplemented, http.StatusNotImplemented, title, detail)
}

// --- Domain-specific constructors ---

// PluginNotFound creates a structured error for a missing plugin.
func PluginNotFound(pluginID string) *AppError {
	return &AppError{
		Type:        TypePluginNotFound,
		Status:      http.StatusNotFound,
		Title:       "Plugin not found",
		Detail:      fmt.Sprintf("No plugin with id '%s' was found.", pluginID),
		Instance:    pluginID,
		Err:         nil,
		Suggestions: nil,
		Actions:     nil,
	}
}

// PluginAlreadyLoaded creates a 409 conflict error for a plugin that is already loaded.
func PluginAlreadyLoaded(pluginID string) *AppError {
	return &AppError{
		Type:        TypePluginAlreadyLoaded,
		Status:      http.StatusConflict,
		Title:       "Plugin already loaded",
		Detail:      fmt.Sprintf("Plugin '%s' is already loaded.", pluginID),
		Instance:    pluginID,
		Err:         nil,
		Suggestions: nil,
		Actions:     nil,
	}
}

// ConnectionNotFound creates a structured error for a missing connection.
func ConnectionNotFound(pluginID, connectionID string) *AppError {
	return &AppError{
		Type:        TypeConnectionNotFound,
		Status:      http.StatusNotFound,
		Title:       "Connection not found",
		Detail:      fmt.Sprintf("Connection '%s' not found for plugin '%s'.", connectionID, pluginID),
		Instance:    pluginID + "/" + connectionID,
		Err:         nil,
		Suggestions: nil,
		Actions:     nil,
	}
}

// SessionNotFound creates a structured error for a missing session.
func SessionNotFound(sessionID string) *AppError {
	return &AppError{
		Type:        TypeSessionNotFound,
		Status:      http.StatusNotFound,
		Title:       "Session not found",
		Detail:      fmt.Sprintf("Session '%s' was not found.", sessionID),
		Instance:    sessionID,
		Err:         nil,
		Suggestions: nil,
		Actions:     nil,
	}
}

// ConfigMissing creates a 422 error for a missing configuration setting,
// with an auto-attached "Open Settings" action.
func ConfigMissing(setting, detail string) *AppError {
	return &AppError{
		Type:        TypeSettingsMissingConfig,
		Status:      http.StatusUnprocessableEntity,
		Title:       "Missing configuration: " + setting,
		Detail:      detail,
		Actions:     []Action{OpenSettingsAction("developer")},
		Err:         nil,
		Instance:    "",
		Suggestions: nil,
	}
}
