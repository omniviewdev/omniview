package resource

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

// Optional artifact is consumed by the runtime parser transport acceptance test.
func TestC02ErrorTransportCorpus(t *testing.T) {
	cases := []struct {
		code, uri string
		status    int
	}{{"FORBIDDEN", "omniview:resource/forbidden", 403}, {"UNAUTHORIZED", "omniview:resource/unauthorized", 401}, {"INVALID_REQUEST", "omniview:validation", 400}, {"UNSUPPORTED", "omniview:not-implemented", 501}, {"PARTIAL_RESULT", "omniview:resource/partial", 422}, {"RESOURCE_LIMIT", "omniview:resource/limit", 429}, {"RESET_REQUIRED", "omniview:resource/reset-required", 409}, {"PROVIDER_ERROR", "omniview:resource/provider-error", 502}, {"CANCELLED", "omniview:cancelled", 499}}
	var corpus []map[string]any
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := resourcetest.NewTestProvider(t)
			provider.GetActionsFunc = func(context.Context, string) ([]resource.ActionDescriptor, error) {
				return nil, &resource.ResourceOperationError{Code: tc.code, Title: "secret-title", Message: "secret-detail"}
			}
			registerMockPlugin(ctrl, "neutral", setupGRPCProvider(t, provider))
			_, err := ctrl.GetActions(testInvocationContext(), "neutral", "route", "opaque")
			app := requireAppError(t, err)
			if app.Code != tc.code || app.Type != tc.uri || app.Status != tc.status || app.RequestID == "" {
				t.Fatalf("lost actual transport error: %s", app.Error())
			}
			if (tc.code == "FORBIDDEN" || tc.code == "UNAUTHORIZED" || tc.code == "PROVIDER_ERROR") && strings.Contains(app.Error(), "secret") {
				t.Fatal("unsafe actual transport error")
			}
			corpus = append(corpus, map[string]any{"wire": app.Error(), "code": tc.code, "type": tc.uri, "status": tc.status})
		})
	}
	if path := os.Getenv("C02_ERROR_CORPUS"); path != "" {
		encoded, err := json.Marshal(corpus)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, encoded, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
