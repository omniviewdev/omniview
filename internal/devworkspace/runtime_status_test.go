package devworkspace

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestSafeCompilerDiagnosticKeepsActionableError(t *testing.T) {
	t.Setenv("OMNIVIEW_TEST_API_TOKEN", "sensitive-value")
	diagnostic := safeCompilerDiagnostic("/workspace/plugin/main.go:12: undefined: sdk.Removed\nAuthorization: Bearer abc123\ntoken=sensitive-value\nhttps://user:pass@example.com", "/workspace")
	for _, secret := range []string{"abc123", "sensitive-value", "user:pass", "/workspace"} {
		if strings.Contains(diagnostic, secret) {
			t.Fatalf("diagnostic leaked %q: %s", secret, diagnostic)
		}
	}
	if !strings.Contains(diagnostic, "$WORKSPACE/plugin/main.go:12: undefined: sdk.Removed") {
		t.Fatalf("lost compiler location: %s", diagnostic)
	}
}

func TestSafeCompilerDiagnosticBoundsSummary(t *testing.T) {
	diagnostic := safeCompilerDiagnostic(strings.Repeat("x", 10000)+"\nmain.go:9: error", "/workspace")
	if len(diagnostic) > 8192 || !strings.Contains(diagnostic, "main.go:9: error") {
		t.Fatalf("invalid bounded diagnostic: %d bytes", len(diagnostic))
	}
}

func TestSourceReloadRejectsForeignTargetsBeforeDiscovery(t *testing.T) {
	manager := &Manager{}
	for _, module := range []string{"https://example.com/source.ts", "//example.com/source.ts", "source.ts"} {
		if _, err := manager.VerifySourceReload(context.Background(), "unused", module, "unique-edit"); err == nil {
			t.Fatalf("accepted foreign or ambiguous module path %q", module)
		}
	}
}

func TestCompatibilityPreflightRejectsWrongSDKModuleBeforeBuild(t *testing.T) {
	graph := graphFixture(t)
	writeGraphFixture(t, filepath.Join(graph.workspace.Root, "sdk", "go.mod"), "module example.com/not-the-sdk\n\ngo 1.26.0\n")
	err := compatibilityPreflight(context.Background(), graph.workspace, LaunchOptions{})
	var failure *devcontract.Error
	if !errors.As(err, &failure) || failure.Code != "sdk_contract_mismatch" {
		t.Fatalf("wrong SDK module must fail preflight directly: %v", err)
	}
}
