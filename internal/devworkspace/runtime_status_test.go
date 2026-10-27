package devworkspace

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestSafeCompilerDiagnosticKeepsActionableError(t *testing.T) {
	t.Setenv("OMNIVIEW_TEST_API_TOKEN", "sensitive-value")
	diagnostic := safeCompilerDiagnostic("/workspace/plugin/main.go:12: undefined: sdk.Removed\nAuthorization: Bearer abc123\nAuthorization: Basic dXNlcjpwYXNz\ntoken=sensitive-value\nhttps://user:pass@example.com\nbasic compiler error", "/workspace")
	for _, secret := range []string{"abc123", "dXNlcjpwYXNz", "sensitive-value", "user:pass", "/workspace"} {
		if strings.Contains(diagnostic, secret) {
			t.Fatalf("diagnostic leaked %q: %s", secret, diagnostic)
		}
	}
	if !strings.Contains(diagnostic, "$WORKSPACE/plugin/main.go:12: undefined: sdk.Removed") {
		t.Fatalf("lost compiler location: %s", diagnostic)
	}
	if !strings.Contains(diagnostic, "basic compiler error") {
		t.Fatalf("redacted ordinary basic text: %s", diagnostic)
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

func TestCompatibilityPreflightRequiresSDK(t *testing.T) {
	graph := graphFixture(t)
	graph.workspace.Manifest.Links.SDKRepositoryID = nil
	if err := writeManifest(graph.workspace.Root, graph.workspace.Manifest); err != nil {
		t.Fatal(err)
	}
	err := compatibilityPreflight(context.Background(), graph.workspace, LaunchOptions{})
	var failure *devcontract.Error
	if !errors.As(err, &failure) || failure.Code != "sdk_source_required" {
		t.Fatalf("missing SDK must fail before reading source: %v", err)
	}
}

func TestRuntimeUIContractsIgnoreToolingButRejectRuntimeLegacyDependencies(t *testing.T) {
	for _, test := range []struct {
		name       string
		consumer   string
		section    string
		dependency string
		reject     bool
	}{
		{"comparison app", "ui/apps/comparison", "devDependencies", "@emotion/react", false},
		{"host", "host", "dependencies", "@omniviewdev/ui", true},
		{"shared package", "ui/packages/base-ui", "peerDependencies", "@emotion/react", true},
		{"selected plugin", "plugin/ui", "devDependencies", "@mui/material", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{
				Root: root,
				Manifest: devcontract.WorkspaceManifest{
					Repositories: []devcontract.Repository{
						{ID: "omniview", Directory: "host"},
						{ID: "ui", Directory: "ui"},
						{ID: "plugin", Directory: "plugin"},
					},
					Plugins: []devcontract.Plugin{{ID: "plugin", RepositoryID: "plugin", Mode: "managed"}},
				},
			}}
			targets := map[string]string{"@omniviewdev/base-ui": filepath.Join(root, "ui/packages/base-ui")}
			var plan linkPlan
			for _, path := range []string{"host", "ui/packages/base-ui", "plugin/ui", "ui/apps/comparison"} {
				data := `{"name":"fixture","dependencies":{}}`
				if path == test.consumer {
					data = `{"name":"fixture","` + test.section + `":{"` + test.dependency + `":"1.0.0"}}`
				}
				directory := filepath.Join(root, path)
				writeGraphFixture(t, filepath.Join(directory, "package.json"), data)
				plan.Consumers = append(plan.Consumers, linkConsumer{Path: directory, Targets: targets})
			}
			err := validateRuntimeUIContracts(w, plan)
			if !test.reject {
				if err != nil {
					t.Fatalf("tool-only dependency blocked runtime admission: %v", err)
				}
				return
			}
			var failure *devcontract.Error
			if !errors.As(err, &failure) || failure.Code != "ui_contract_mismatch" {
				t.Fatalf("runtime legacy dependency escaped preflight: %v", err)
			}
		})
	}
}

func TestHashUntrackedPathDoesNotFollowSymlinks(t *testing.T) {
	root := t.TempDir()
	link := filepath.Join(root, "link")
	if err := os.Symlink("missing-target", link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	first := sha256.New()
	if err := hashUntrackedPath(context.Background(), first, root, "link"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("different-missing-target", link); err != nil {
		t.Fatal(err)
	}
	second := sha256.New()
	if err := hashUntrackedPath(context.Background(), second, root, "link"); err != nil {
		t.Fatal(err)
	}
	if string(first.Sum(nil)) == string(second.Sum(nil)) {
		t.Fatal("link target change did not change digest")
	}
	if err := hashUntrackedPath(context.Background(), io.Discard, root, "."); err != nil {
		t.Fatalf("untracked directory must not fail inspection: %v", err)
	}
}

func TestHashUntrackedPathHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := hashUntrackedPath(ctx, io.Discard, t.TempDir(), "absent"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled inspection accessed filesystem: %v", err)
	}
	reader := checkoutContextReader{ctx: ctx, reader: strings.NewReader("unread")}
	if _, err := io.Copy(io.Discard, reader); !errors.Is(err, context.Canceled) {
		t.Fatalf("stream ignored cancellation: %v", err)
	}
}

func TestWatchCommitPreservesPendingHostFailure(t *testing.T) {
	g := graphFixture(t)
	s, _ := feedbackSupervisorFixture(t, g)
	s.feedback = &viteFeedback{hostPending: true}
	s.status.Phase = "build-error"
	s.status.FailedStage = "host"
	s.status.RecoveryCommand = "recover-host"
	s.status.ServedCheckouts = map[string]CheckoutStatus{"host": {Commit: "previous"}}
	if err := s.watchHooks().CommitFeedback(context.Background(), WatchChange{}); err != nil {
		t.Fatal(err)
	}
	status := s.snapshot()
	if status.Phase != "build-error" || status.FailedStage != "host" || status.RecoveryCommand != "recover-host" ||
		status.ServedCheckouts["host"].Commit != "previous" || !s.feedback.hostPending {
		t.Fatalf("frontend-only success cleared pending host failure: %+v", status)
	}
	// This fixture did not create an owned feedback file.
	s.feedback = nil
}

func TestStatusPreservesNonRunningPhasesWithoutHost(t *testing.T) {
	g := graphFixture(t)
	s, _ := feedbackSupervisorFixture(t, g)
	for _, phase := range []string{"linking", "building", "starting-frontend", "build-error", "stopped", "error"} {
		t.Run(phase, func(t *testing.T) {
			s.status.Phase = phase
			status, err := s.execute(context.Background(), "status")
			if err != nil || status.Phase != phase {
				t.Fatalf("missing host overwrote phase %s: %s, %v", phase, status.Phase, err)
			}
		})
	}
}

func TestReadyInspectionHonorsSessionCancellation(t *testing.T) {
	g := graphFixture(t)
	s, _ := feedbackSupervisorFixture(t, g)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.sessionContext = ctx
	s.setPhase("ready", nil)
	for id, checkout := range s.snapshot().ServedCheckouts {
		if checkout.Error == "" {
			t.Fatalf("canceled ready inspection reported checkout %s as current", id)
		}
	}
}

func TestSourceReloadRejectsMissingOrReplacedReportedHost(t *testing.T) {
	connected := devcontract.InstanceDescriptor{
		WorkspaceID: "workspace", InstanceID: "instance", Generation: "generation",
		StateRoot: "/state", Readiness: "ready",
		Process: devcontract.ProcessIdentity{PID: 123, StartIdentity: "original"},
	}
	if err := sourceReloadHostReady(connected, &connected); err != nil {
		t.Fatalf("matching host rejected: %v", err)
	}
	replaced := connected
	replaced.Process.StartIdentity = "replacement"
	foreign := connected
	foreign.InstanceID = "other"
	for _, reported := range []*devcontract.InstanceDescriptor{nil, &replaced, &foreign} {
		err := sourceReloadHostReady(connected, reported)
		var failure *devcontract.Error
		if !errors.As(err, &failure) || failure.Code != "stale_target" {
			t.Fatalf("unbound source evidence accepted: %v", err)
		}
	}
}
