package apperror

import (
	"context"
	"errors"
	"unicode/utf8"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Location uses zero-based, half-open UTF-8 byte offsets. Only host authoring
// services may attach validated source locations; providers cannot supply them.
type Location struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Unit  string `json:"unit"`
}

type resourceClass struct {
	uri      string
	status   int
	recovery string
	title    string
	detail   string
}

func classifyResource(code string) (string, resourceClass) {
	switch code {
	case "PERMISSION_DENIED":
		code = "FORBIDDEN"
	case "INVALID_INPUT", "FILTER_UNKNOWN_FIELD", "FILTER_INVALID_OPERATOR":
		code = "INVALID_REQUEST"
	}
	var c resourceClass
	switch code {
	case "INVALID_REQUEST":
		c = resourceClass{TypeValidation, 400, "correctRequest", "Invalid request", "The request is invalid."}
	case "UNSUPPORTED":
		c = resourceClass{TypeNotImplemented, 501, "refreshContract", "Unsupported operation", "This operation is not supported."}
	case "FORBIDDEN":
		c = resourceClass{TypeResourceForbidden, 403, "none", "Access denied", "The operation is not permitted."}
	case "UNAUTHORIZED":
		c = resourceClass{TypeResourceUnauthorized, 401, "none", "Authentication required", "The provider requires authentication."}
	case "NOT_FOUND":
		c = resourceClass{TypeResourceNotFound, 404, "none", "Not found", "The requested resource was not found."}
	case "ALREADY_EXISTS", "CONFLICT":
		c = resourceClass{TypeResourceConflict, 409, "refreshContract", "Conflict", "The operation conflicts with current state."}
	case "CANCELLED":
		c = resourceClass{TypeCancelled, 499, "none", "Cancelled", "The operation was cancelled."}
	case "TIMEOUT":
		c = resourceClass{TypeResourceTimeout, 408, "none", "Timed out", "The operation exceeded its deadline."}
	case "UNAVAILABLE", "CONNECTION_ERROR":
		c = resourceClass{TypeConnectionFailed, 503, "reconnect", "Source unavailable", "The source is unavailable."}
	case "CERTIFICATE_ERROR":
		c = resourceClass{TypeConnectionFailed, 502, "reconnect", "Connection failed", "The provider connection could not be verified."}
	case "RESOURCE_LIMIT":
		c = resourceClass{TypeResourceLimit, 429, "correctRequest", "Resource limit", "The operation exceeds a host resource limit."}
	case "CONTINUATION_EXPIRED":
		c = resourceClass{TypeResourceContinuationExpired, 410, "restartQuery", "Continuation expired", "Restart the traversal."}
	case "RESET_REQUIRED":
		c = resourceClass{TypeResourceResetRequired, 409, "restartQuery", "Reset required", "Restart the result."}
	case "PARTIAL_RESULT":
		c = resourceClass{TypeResourcePartial, 422, "none", "Incomplete result", "The operation could not establish complete coverage."}
	case "PROVIDER_ERROR":
		c = resourceClass{TypeResourceProvider, 502, "none", "Provider operation failed", "The provider could not complete the operation."}
	default:
		code = "INTERNAL"
		c = resourceClass{TypeInternal, 500, "none", "Internal error", "The operation could not be completed."}
	}
	return code, c
}

func codeFromType(e *AppError) string {
	if e.Code != "" {
		return e.Code
	}
	switch e.Type {
	case TypeResourceForbidden:
		return "FORBIDDEN"
	case TypeResourceUnauthorized:
		return "UNAUTHORIZED"
	case TypeCancelled:
		return "CANCELLED"
	case TypeValidation:
		return "INVALID_REQUEST"
	case TypeNotImplemented:
		return "UNSUPPORTED"
	case TypeResourceNotFound, TypePluginNotFound, TypeConnectionNotFound, TypeSessionNotFound:
		return "NOT_FOUND"
	case TypeResourceConflict:
		return "CONFLICT"
	case TypeResourceTimeout:
		return "TIMEOUT"
	case TypeConnectionFailed:
		return "UNAVAILABLE"
	case TypeResourceLimit:
		return "RESOURCE_LIMIT"
	case TypeResourcePartial:
		return "PARTIAL_RESULT"
	case TypeResourceResetRequired:
		return "RESET_REQUIRED"
	case TypeResourceContinuationExpired:
		return "CONTINUATION_EXPIRED"
	case TypeResourceProvider:
		return "PROVIDER_ERROR"
	default:
		return "INTERNAL"
	}
}

// ForResource normalizes a resource-boundary failure. It never trusts an error's
// Go concrete type as proof of safe provider fields. Correlation is host-owned.
func ForResource(err error, requestID string) *AppError {
	if err == nil {
		return nil
	}
	code := "PROVIDER_ERROR"
	var title, detail string
	var suggestions []string
	var app *AppError
	var roe *resource.ResourceOperationError
	switch {
	case errors.Is(err, context.Canceled):
		code = "CANCELLED"
	case errors.Is(err, context.DeadlineExceeded):
		code = "TIMEOUT"
	case errors.As(err, &roe):
		code, title, detail, suggestions = roe.Code, roe.Title, roe.Message, roe.Suggestions
	case errors.As(err, &app):
		code, title, detail, suggestions = codeFromType(app), app.Title, app.Detail, app.Suggestions
	default:
		switch status.Code(err) {
		case codes.Canceled:
			code = "CANCELLED"
		case codes.DeadlineExceeded:
			code = "TIMEOUT"
		case codes.PermissionDenied:
			code = "FORBIDDEN"
		case codes.Unauthenticated:
			code = "UNAUTHORIZED"
		case codes.InvalidArgument:
			code = "INVALID_REQUEST"
		case codes.Unimplemented:
			code = "UNSUPPORTED"
		case codes.NotFound:
			code = "NOT_FOUND"
		case codes.AlreadyExists:
			code = "ALREADY_EXISTS"
		case codes.Aborted:
			code = "CONFLICT"
		case codes.ResourceExhausted:
			code = "RESOURCE_LIMIT"
		case codes.Unavailable:
			code = "UNAVAILABLE"
		case codes.Internal:
			code = "INTERNAL"
		}
	}
	code, c := classifyResource(code)
	out := &AppError{Err: err, Type: c.uri, Status: c.status, Code: code, Title: c.title, Detail: c.detail, Recovery: c.recovery, RequestID: requestID}
	// These explicitly structured classifications may carry provider-declared
	// public-safe diagnostics. Denial/internal/raw paths always use fixed text.
	if code != "FORBIDDEN" && code != "UNAUTHORIZED" && code != "INTERNAL" && code != "PROVIDER_ERROR" && code != "CANCELLED" {
		if publicText(title, 256) {
			out.Title = title
		}
		if publicText(detail, 4096) {
			out.Detail = detail
		}
		for _, s := range suggestions {
			if len(out.Suggestions) == 8 {
				break
			}
			if publicText(s, 512) {
				out.Suggestions = append(out.Suggestions, s)
			}
		}
		// Preserve an existing host domain URI only for known non-sensitive
		// application lookups. No provider actions/location/instance are copied.
		if app != nil && code == "NOT_FOUND" {
			switch app.Type {
			case TypePluginNotFound, TypeConnectionNotFound, TypeSessionNotFound:
				out.Type = app.Type
			}
		}
	}
	return out
}
func publicText(value string, max int) bool {
	return value != "" && len(value) <= max && utf8.ValidString(value)
}
