package types

import "encoding/json"

// ResourceOperationError is a structured error for resource CRUD operations.
// Its Error() method returns a JSON string so that the error survives the
// Wails boundary (which flattens Go errors to plain JS strings) and can be
// parsed by the frontend into structured fields for generic rendering.
type ResourceOperationError struct {
	Err         error    `json:"-"`                       // underlying error (not serialized)
	Code        string   `json:"code"`                    // standard code: NOT_FOUND, FORBIDDEN, etc.
	Title       string   `json:"title"`                   // human-readable title
	Message     string   `json:"message"`                 // detailed error message
	Suggestions []string `json:"suggestions,omitempty"`   // user-facing suggestions
}

// Error returns a JSON-encoded representation so the structured fields
// survive the Wails IPC boundary (Wails calls .Error() and sends the string).
func (e *ResourceOperationError) Error() string {
	b, _ := json.Marshal(struct {
		Code        string   `json:"code"`
		Title       string   `json:"title"`
		Message     string   `json:"message"`
		Suggestions []string `json:"suggestions,omitempty"`
	}{e.Code, e.Title, e.Message, e.Suggestions})
	return string(b)
}

// Unwrap returns the underlying error for use with errors.Is / errors.As.
func (e *ResourceOperationError) Unwrap() error { return e.Err }

// ResourceErrorClassifier is an optional interface that ResourceProvider
// implementations can satisfy to classify raw errors into structured
// ResourceOperationError values. The gRPC server checks for this interface
// before falling back to a generic INTERNAL error.
type ResourceErrorClassifier interface {
	ClassifyResourceError(err error) error
}
