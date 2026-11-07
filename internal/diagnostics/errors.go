package diagnostics

import "errors"

// Error carries a bounded public category without exposing private storage paths.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string           { return e.Message }
func failure(code, message string) error { return &Error{Code: code, Message: message} }
func ErrorCode(err error) string {
	if err == nil {
		return ""
	}
	var public *Error
	if errors.As(err, &public) {
		return public.Code
	}
	return "storage"
}
