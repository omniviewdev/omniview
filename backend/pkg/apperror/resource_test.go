package apperror

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestProviderDenialRedactsEveryPublicField(t *testing.T) {
	poison := &AppError{Type: TypeResourceForbidden, Status: 403, Title: "secret-title", Detail: "secret-body", Instance: "secret-instance", Suggestions: []string{"secret-suggestion"}, Actions: []Action{{Type: "open-url", Label: "secret", Target: "https://secret"}}, RequestID: "secret-correlation", Location: &Location{Start: 0, End: 5, Unit: "utf8-byte"}}
	got := ForResource(poison, "host-request")
	wire := got.Error()
	if strings.Contains(wire, "secret") || got.Code != "FORBIDDEN" || got.RequestID != "host-request" {
		t.Fatalf("unsafe denial envelope: %s", wire)
	}
	if got.Location != nil || len(got.Actions) != 0 || got.Status != 403 {
		t.Fatalf("denial auxiliary fields survived: %s", wire)
	}
}

func TestResourceErrorsKeepMachineMeaningAcrossJSON(t *testing.T) {
	cases := []struct {
		code   string
		status int
		uri    string
	}{
		{"PERMISSION_DENIED", 403, TypeResourceForbidden}, {"INVALID_INPUT", 400, TypeValidation},
		{"INVALID_REQUEST", 400, TypeValidation}, {"UNSUPPORTED", 501, TypeNotImplemented},
		{"PARTIAL_RESULT", 422, TypeResourcePartial}, {"RESOURCE_LIMIT", 429, TypeResourceLimit},
		{"RESET_REQUIRED", 409, TypeResourceResetRequired}, {"UNAVAILABLE", 503, TypeConnectionFailed},
		{"CERTIFICATE_ERROR", 502, TypeConnectionFailed},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			got := ForResource(&resource.ResourceOperationError{Code: tc.code, Title: "Public title", Message: "Public detail"}, "request-1")
			var wire map[string]any
			if err := json.Unmarshal([]byte(got.Error()), &wire); err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.status || got.Type != tc.uri || wire["requestId"] != "request-1" {
				t.Fatalf("lost meaning: %s", got.Error())
			}
		})
	}
}

func TestCancellationAndDeadlineAreNotInternalOrRawProviderFailures(t *testing.T) {
	for _, err := range []error{context.Canceled, status.Error(codes.Canceled, "private")} {
		got := ForResource(err, "host")
		if got.Type != TypeCancelled || got.Status != 499 {
			t.Fatalf("cancellation became failure: %s", got.Error())
		}
	}
	if got := ForResource(context.DeadlineExceeded, "host"); got.Code != "TIMEOUT" {
		t.Fatal(got)
	}
	got := ForResource(errors.New("credential=private"), "host")
	if got.Code != "PROVIDER_ERROR" || strings.Contains(got.Error(), "private") || !errors.Is(got, got.Err) {
		t.Fatalf("raw provider failure leaked: %s", got.Error())
	}
}
