package plugin

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

// --- classifyError tests (server-side) ---

// mockProvider is a minimal mock that satisfies types.ResourceProvider for
// testing the classifyError path. Only the ResourceErrorClassifier part matters.
type mockProvider struct {
	types.ResourceProvider // embed to satisfy interface; panics if anything else is called
	classifier            func(error) error
}

func (m *mockProvider) ClassifyResourceError(err error) error {
	if m.classifier != nil {
		return m.classifier(err)
	}
	return nil
}

func newServerWithClassifier(classifier func(error) error) *ResourcePluginServer {
	return &ResourcePluginServer{
		Impl: &mockProvider{classifier: classifier},
	}
}

func newServerWithoutClassifier() *ResourcePluginServer {
	return &ResourcePluginServer{
		Impl: &mockProvider{},
	}
}

func TestClassifyError_PreClassifiedError(t *testing.T) {
	s := newServerWithClassifier(func(err error) error {
		t.Fatal("classifier should not be called for pre-classified errors")
		return nil
	})

	original := &types.ResourceOperationError{
		Code:    "FORBIDDEN",
		Title:   "Access denied",
		Message: "pods is forbidden",
	}

	result := s.classifyError(original)
	assert.Equal(t, "FORBIDDEN", result.Code)
	assert.Equal(t, "Access denied", result.Title)
}

func TestClassifyError_PreClassifiedWrapped(t *testing.T) {
	original := &types.ResourceOperationError{
		Code:    "NOT_FOUND",
		Title:   "Not found",
		Message: "resource missing",
	}
	wrapped := fmt.Errorf("layer: %w", original)

	s := newServerWithoutClassifier()
	result := s.classifyError(wrapped)
	assert.Equal(t, "NOT_FOUND", result.Code, "should unwrap through fmt.Errorf wrapping")
}

func TestClassifyError_ClassifierReturnsStructured(t *testing.T) {
	s := newServerWithClassifier(func(err error) error {
		return &types.ResourceOperationError{
			Code:        "UNAUTHORIZED",
			Title:       "Auth failed",
			Message:     "token expired",
			Suggestions: []string{"Re-authenticate"},
		}
	})

	result := s.classifyError(errors.New("some raw error"))
	assert.Equal(t, "UNAUTHORIZED", result.Code)
	assert.Equal(t, []string{"Re-authenticate"}, result.Suggestions)
}

func TestClassifyError_ClassifierReturnsNil(t *testing.T) {
	s := newServerWithClassifier(func(err error) error {
		return nil // can't classify
	})

	result := s.classifyError(errors.New("unknown error"))
	assert.Equal(t, "INTERNAL", result.Code, "should fall back to INTERNAL")
	assert.Equal(t, "Operation failed", result.Title)
	assert.Equal(t, "unknown error", result.Message)
}

func TestClassifyError_NoClassifier(t *testing.T) {
	// Provider doesn't implement ResourceErrorClassifier at all
	s := &ResourcePluginServer{
		Impl: nil, // classifyError type-asserts on Impl; nil won't match interface
	}

	// We need a non-nil Impl for the type assertion to not panic
	// Use a provider that does NOT implement ResourceErrorClassifier
	s.Impl = &plainProvider{}

	result := s.classifyError(errors.New("some error"))
	assert.Equal(t, "INTERNAL", result.Code)
	assert.Equal(t, "some error", result.Message)
}

// plainProvider satisfies ResourceProvider but NOT ResourceErrorClassifier.
type plainProvider struct {
	types.ResourceProvider
}

func TestClassifyError_ClassifierWrappedReturn(t *testing.T) {
	// Classifier returns a wrapped ResourceOperationError
	inner := &types.ResourceOperationError{
		Code:    "TIMEOUT",
		Title:   "Timed out",
		Message: "context deadline exceeded",
	}
	s := newServerWithClassifier(func(err error) error {
		return fmt.Errorf("classified: %w", inner)
	})

	result := s.classifyError(errors.New("raw timeout"))
	assert.Equal(t, "TIMEOUT", result.Code, "should unwrap classifier's wrapped return")
}

func TestClassifyError_PreservesOriginalMessage(t *testing.T) {
	s := newServerWithoutClassifier()
	origErr := errors.New("detailed error: connection refused to 10.0.0.1:6443")

	result := s.classifyError(origErr)
	assert.Equal(t, "INTERNAL", result.Code)
	assert.Contains(t, result.Message, "connection refused to 10.0.0.1:6443")
}

// --- toProtoError tests ---

func TestToProtoError(t *testing.T) {
	opErr := &types.ResourceOperationError{
		Code:        "FORBIDDEN",
		Title:       "Access denied",
		Message:     "pods is forbidden",
		Suggestions: []string{"Check RBAC", "Contact admin"},
	}

	pe := toProtoError(opErr)
	assert.Equal(t, "FORBIDDEN", pe.GetCode())
	assert.Equal(t, "Access denied", pe.GetTitle())
	assert.Equal(t, "pods is forbidden", pe.GetMessage())
	assert.Equal(t, []string{"Check RBAC", "Contact admin"}, pe.GetSuggestions())
}

func TestToProtoError_NilSuggestions(t *testing.T) {
	opErr := &types.ResourceOperationError{
		Code:    "INTERNAL",
		Title:   "fail",
		Message: "fail",
	}

	pe := toProtoError(opErr)
	assert.Empty(t, pe.GetSuggestions())
}

// --- checkResponseError tests (client-side) ---

func TestCheckResponseError_SuccessReturnsNil(t *testing.T) {
	err := checkResponseError(true, &proto.ResourceError{
		Code:  "FORBIDDEN",
		Title: "should be ignored",
	})
	assert.NoError(t, err, "success=true should always return nil regardless of error field")
}

func TestCheckResponseError_FailureWithError(t *testing.T) {
	err := checkResponseError(false, &proto.ResourceError{
		Code:        "NOT_FOUND",
		Title:       "Resource not found",
		Message:     "pods not found",
		Suggestions: []string{"Check namespace"},
	})

	require.Error(t, err)

	var opErr *types.ResourceOperationError
	require.True(t, errors.As(err, &opErr))
	assert.Equal(t, "NOT_FOUND", opErr.Code)
	assert.Equal(t, "Resource not found", opErr.Title)
	assert.Equal(t, "pods not found", opErr.Message)
	assert.Equal(t, []string{"Check namespace"}, opErr.Suggestions)
}

func TestCheckResponseError_FailureWithNilError(t *testing.T) {
	err := checkResponseError(false, nil)

	require.Error(t, err, "should return error when success=false even without error details")

	var opErr *types.ResourceOperationError
	require.True(t, errors.As(err, &opErr))
	assert.Equal(t, "INTERNAL", opErr.Code)
}

func TestCheckResponseError_ReconstructedErrorProducesValidJSON(t *testing.T) {
	// Simulate the full round-trip: proto → client → ResourceOperationError → .Error() JSON
	protoErr := &proto.ResourceError{
		Code:        "FORBIDDEN",
		Title:       "Access denied",
		Message:     "pods is forbidden: User \"system:anonymous\"",
		Suggestions: []string{"Check RBAC permissions"},
	}

	err := checkResponseError(false, protoErr)
	require.Error(t, err)

	// The error's .Error() should be valid JSON (this is what Wails sends to JS)
	jsonStr := err.Error()
	assert.Contains(t, jsonStr, `"code":"FORBIDDEN"`)
	assert.Contains(t, jsonStr, `"title":"Access denied"`)
}
