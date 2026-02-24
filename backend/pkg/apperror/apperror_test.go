package apperror

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestError_ProducesValidJSON(t *testing.T) {
	appErr := New(TypePluginNotFound, 404, "Plugin not found", "No plugin with id 'foo' was found.").
		WithSuggestions("Check the plugin ID").
		WithActions(RetryAction("Retry"))

	raw := appErr.Error()

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(raw), &parsed))

	assert.Equal(t, TypePluginNotFound, parsed["type"])
	assert.Equal(t, "Plugin not found", parsed["title"])
	assert.Equal(t, float64(404), parsed["status"])
	assert.Equal(t, "No plugin with id 'foo' was found.", parsed["detail"])
	assert.Len(t, parsed["suggestions"], 1)
	assert.Len(t, parsed["actions"], 1)
}

func TestError_OmitsEmptyOptionalFields(t *testing.T) {
	appErr := New(TypeInternal, 500, "Error", "Something went wrong")

	raw := appErr.Error()

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(raw), &parsed))

	_, hasInstance := parsed["instance"]
	_, hasSuggestions := parsed["suggestions"]
	_, hasActions := parsed["actions"]
	assert.False(t, hasInstance, "empty instance should be omitted")
	assert.False(t, hasSuggestions, "nil suggestions should be omitted")
	assert.False(t, hasActions, "nil actions should be omitted")
}

func TestUnwrap_ReturnsOriginalError(t *testing.T) {
	original := errors.New("disk full")
	appErr := Internal(original, "Write failed")

	assert.Equal(t, original, appErr.Unwrap())
	assert.True(t, errors.Is(appErr, original))
}

func TestErrorsAs_WorksThroughChain(t *testing.T) {
	original := errors.New("connection refused")
	appErr := Wrap(original, TypeConnectionFailed, 502, "Connection failed")

	var target *AppError
	require.True(t, errors.As(appErr, &target))
	assert.Equal(t, TypeConnectionFailed, target.Type)
	assert.Equal(t, 502, target.Status)
}

func TestWithSuggestions_IsAdditive(t *testing.T) {
	appErr := New(TypeValidation, 422, "Invalid", "bad input").
		WithSuggestions("Fix A").
		WithSuggestions("Fix B", "Fix C")

	assert.Equal(t, []string{"Fix A", "Fix B", "Fix C"}, appErr.Suggestions)
}

func TestWithActions_IsAdditive(t *testing.T) {
	appErr := New(TypeValidation, 422, "Invalid", "bad input").
		WithActions(RetryAction("Retry")).
		WithActions(OpenSettingsAction("developer"))

	assert.Len(t, appErr.Actions, 2)
	assert.Equal(t, "retry", appErr.Actions[0].Type)
	assert.Equal(t, "navigate", appErr.Actions[1].Type)
}

func TestCancelled(t *testing.T) {
	appErr := Cancelled()
	assert.Equal(t, TypeCancelled, appErr.Type)
	assert.Equal(t, 499, appErr.Status)
}

func TestPluginNotFound(t *testing.T) {
	appErr := PluginNotFound("my-plugin")
	assert.Equal(t, TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "my-plugin")
	assert.Equal(t, "my-plugin", appErr.Instance)
}

func TestPluginAlreadyLoaded(t *testing.T) {
	appErr := PluginAlreadyLoaded("my-plugin")
	assert.Equal(t, TypePluginAlreadyLoaded, appErr.Type)
	assert.Equal(t, 409, appErr.Status)
	assert.Contains(t, appErr.Detail, "my-plugin")
}

func TestConnectionNotFound(t *testing.T) {
	appErr := ConnectionNotFound("plug", "conn-1")
	assert.Equal(t, TypeConnectionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Equal(t, "plug/conn-1", appErr.Instance)
}

func TestSessionNotFound(t *testing.T) {
	appErr := SessionNotFound("sess-42")
	assert.Equal(t, TypeSessionNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Equal(t, "sess-42", appErr.Instance)
}

func TestConfigMissing(t *testing.T) {
	appErr := ConfigMissing("goPath", "Go binary path is not configured")
	assert.Equal(t, TypeSettingsMissingConfig, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "goPath")
	require.Len(t, appErr.Actions, 1)
	assert.Equal(t, "navigate", appErr.Actions[0].Type)
	assert.Contains(t, appErr.Actions[0].Target, "developer")
}

func TestNotImplemented(t *testing.T) {
	appErr := NotImplemented("Feature X", "Feature X is not yet supported.")
	assert.Equal(t, TypeNotImplemented, appErr.Type)
	assert.Equal(t, 501, appErr.Status)
	assert.Equal(t, "Feature X", appErr.Title)
	assert.Equal(t, "Feature X is not yet supported.", appErr.Detail)
}

func TestFromResourceOperationError(t *testing.T) {
	tests := []struct {
		name       string
		code       string
		wantType   string
		wantStatus int
	}{
		{"NOT_FOUND", "NOT_FOUND", TypeResourceNotFound, 404},
		{"FORBIDDEN", "FORBIDDEN", TypeResourceForbidden, 403},
		{"UNAUTHORIZED", "UNAUTHORIZED", TypeResourceUnauthorized, 401},
		{"CONFLICT", "CONFLICT", TypeResourceConflict, 409},
		{"TIMEOUT", "TIMEOUT", TypeResourceTimeout, 408},
		{"unknown", "WEIRD", TypeInternal, 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := `{"code":"` + tt.code + `","title":"Test","message":"detail","suggestions":["try again"]}`
			appErr := FromResourceOperationError(input, "plug-1")
			assert.Equal(t, tt.wantType, appErr.Type)
			assert.Equal(t, tt.wantStatus, appErr.Status)
			assert.Equal(t, "Test", appErr.Title)
			assert.Equal(t, "detail", appErr.Detail)
			assert.Equal(t, "plug-1", appErr.Instance)
			assert.Equal(t, []string{"try again"}, appErr.Suggestions)
		})
	}
}

func TestFromResourceOperationError_InvalidJSON(t *testing.T) {
	appErr := FromResourceOperationError("not json", "plug-1")
	assert.Equal(t, TypeInternal, appErr.Type)
	assert.Equal(t, 500, appErr.Status)
}

func TestActionHelpers(t *testing.T) {
	nav := NavigateAction("Go", "/foo")
	assert.Equal(t, "navigate", nav.Type)
	assert.Equal(t, "/foo", nav.Target)

	url := OpenURLAction("Docs", "https://example.com")
	assert.Equal(t, "open-url", url.Type)

	retry := RetryAction("Try again")
	assert.Equal(t, "retry", retry.Type)
	assert.Empty(t, retry.Target)

	cp := CopyAction("Copy ID", "abc123")
	assert.Equal(t, "copy", cp.Type)
	assert.Equal(t, "abc123", cp.Target)

	settings := OpenSettingsAction("developer")
	assert.Equal(t, "navigate", settings.Type)
	assert.Equal(t, "#/settings?category=developer", settings.Target)
}
