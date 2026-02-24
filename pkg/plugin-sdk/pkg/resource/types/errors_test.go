package types

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResourceOperationError_Error_ReturnsValidJSON(t *testing.T) {
	err := &ResourceOperationError{
		Err:         errors.New("underlying"),
		Code:        "FORBIDDEN",
		Title:       "Access denied",
		Message:     "pods is forbidden",
		Suggestions: []string{"Check RBAC", "Contact admin"},
	}

	jsonStr := err.Error()

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(jsonStr), &parsed), "Error() must return valid JSON")
	assert.Equal(t, "FORBIDDEN", parsed["code"])
	assert.Equal(t, "Access denied", parsed["title"])
	assert.Equal(t, "pods is forbidden", parsed["message"])
	assert.Len(t, parsed["suggestions"], 2)
}

func TestResourceOperationError_Error_OmitsEmptySuggestions(t *testing.T) {
	err := &ResourceOperationError{
		Code:    "INTERNAL",
		Title:   "Operation failed",
		Message: "something broke",
	}

	jsonStr := err.Error()

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(jsonStr), &parsed))
	_, hasSuggestions := parsed["suggestions"]
	assert.False(t, hasSuggestions, "empty suggestions should be omitted from JSON")
}

func TestResourceOperationError_Error_ExcludesUnderlyingErr(t *testing.T) {
	secret := errors.New("secret-token-12345")
	err := &ResourceOperationError{
		Err:     secret,
		Code:    "UNAUTHORIZED",
		Title:   "Auth failed",
		Message: "token expired",
	}

	jsonStr := err.Error()
	assert.NotContains(t, jsonStr, "secret-token-12345",
		"underlying Err must not leak into JSON output")
}

func TestResourceOperationError_Unwrap(t *testing.T) {
	underlying := errors.New("root cause")
	err := &ResourceOperationError{
		Err:     underlying,
		Code:    "INTERNAL",
		Title:   "fail",
		Message: "fail",
	}

	assert.True(t, errors.Is(err, underlying), "Unwrap should allow errors.Is to find underlying")
}

func TestResourceOperationError_Unwrap_Nil(t *testing.T) {
	err := &ResourceOperationError{
		Code:    "INTERNAL",
		Title:   "fail",
		Message: "fail",
	}

	assert.Nil(t, err.Unwrap(), "Unwrap on nil Err should return nil")
}

func TestResourceOperationError_ErrorsAs(t *testing.T) {
	inner := &ResourceOperationError{
		Code:    "NOT_FOUND",
		Title:   "Not found",
		Message: "resource missing",
	}
	wrapped := fmt.Errorf("operation failed: %w", inner)

	var opErr *ResourceOperationError
	require.True(t, errors.As(wrapped, &opErr), "errors.As should find wrapped ResourceOperationError")
	assert.Equal(t, "NOT_FOUND", opErr.Code)
}

func TestResourceOperationError_Error_RoundTrip(t *testing.T) {
	// Simulate the full Wails boundary: Go Error() → JSON string → JS JSON.parse
	original := &ResourceOperationError{
		Code:        "CERTIFICATE_ERROR",
		Title:       "Certificate error",
		Message:     "x509: certificate has expired",
		Suggestions: []string{"Renew certs", "Check CA bundle"},
	}

	jsonStr := original.Error()

	// Simulate frontend parsing
	var parsed struct {
		Code        string   `json:"code"`
		Title       string   `json:"title"`
		Message     string   `json:"message"`
		Suggestions []string `json:"suggestions"`
	}
	require.NoError(t, json.Unmarshal([]byte(jsonStr), &parsed))
	assert.Equal(t, original.Code, parsed.Code)
	assert.Equal(t, original.Title, parsed.Title)
	assert.Equal(t, original.Message, parsed.Message)
	assert.Equal(t, original.Suggestions, parsed.Suggestions)
}

func TestResourceOperationError_Error_SpecialChars(t *testing.T) {
	err := &ResourceOperationError{
		Code:    "INTERNAL",
		Title:   `Error with "quotes" & <angle> brackets`,
		Message: "line1\nline2\ttab",
	}

	jsonStr := err.Error()

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(jsonStr), &parsed),
		"JSON must correctly escape special characters")
	assert.Equal(t, `Error with "quotes" & <angle> brackets`, parsed["title"])
}
