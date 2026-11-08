package devworkspace

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
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
	t.Parallel()
	diagnostic := safeCompilerDiagnostic(strings.Repeat("x", 10000)+"\nmain.go:9: error", "/workspace")
	if len(diagnostic) > 8192 || !strings.Contains(diagnostic, "main.go:9: error") {
		t.Fatalf("invalid bounded diagnostic: %d bytes", len(diagnostic))
	}
}

func TestSourceReloadRejectsForeignTargetsBeforeDiscovery(t *testing.T) {
	t.Parallel()
	manager := &Manager{}
	for _, module := range []string{"https://example.com/source.ts", "//example.com/source.ts", "source.ts"} {
		if _, err := manager.VerifySourceReload(context.Background(), "unused", module, "unique-edit"); err == nil {
			t.Fatalf("accepted foreign or ambiguous module path %q", module)
		}
	}
}

func TestCompatibilityPreflightRejectsWrongSDKModuleBeforeBuild(t *testing.T) {
	t.Parallel()
	graph := graphFixture(t, graphFixtureOptions{Stage: graphFixturePlanned})
	writeGraphFixture(t, filepath.Join(graph.workspace.Root, "sdk", "go.mod"), "module example.com/not-the-sdk\n\ngo 1.26.0\n")
	err := compatibilityPreflight(context.Background(), graph.workspace, graph.options.VerifySDK)
	var failure *devcontract.Error
	if !errors.As(err, &failure) || failure.Code != "sdk_contract_mismatch" {
		t.Fatalf("wrong SDK module must fail preflight directly: %v", err)
	}
}

func TestCompatibilityPreflightRequiresSDK(t *testing.T) {
	t.Parallel()
	graph := graphFixture(t, graphFixtureOptions{Stage: graphFixturePlanned})
	graph.workspace.Manifest.Links.SDKRepositoryID = nil
	if err := writeManifest(graph.workspace.Root, graph.workspace.Manifest); err != nil {
		t.Fatal(err)
	}
	err := compatibilityPreflight(context.Background(), graph.workspace, graph.options.VerifySDK)
	var failure *devcontract.Error
	if !errors.As(err, &failure) || failure.Code != "sdk_source_required" {
		t.Fatalf("missing SDK must fail before reading source: %v", err)
	}
}

func TestRuntimeUIContractsIgnoreToolingButRejectRuntimeLegacyDependencies(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	g := graphFixture(t, graphFixtureOptions{NativeOnly: true})
	s, _ := feedbackSupervisorFixture(t, g)
	s.feedback = &viteFeedback{hostPending: true}
	s.status.Phase = "build-error"
	s.status.FailedStage = "host"
	s.status.RecoveryCommand = "recover-host"
	s.status.ReadyCheckouts = map[string]CheckoutStatus{"host": {Commit: "previous"}}
	if err := s.watchHooks().CommitFeedback(context.Background(), WatchChange{}); err != nil {
		t.Fatal(err)
	}
	status := s.snapshot()
	if status.Phase != "build-error" || status.FailedStage != "host" || status.RecoveryCommand != "recover-host" ||
		status.ReadyCheckouts["host"].Commit != "previous" || !s.feedback.hostPending {
		t.Fatalf("frontend-only success cleared pending host failure: %+v", status)
	}
	// This fixture did not create an owned feedback file.
	s.feedback = nil
}

func TestStatusPreservesNonRunningPhasesWithoutHost(t *testing.T) {
	t.Parallel()
	g := graphFixture(t, graphFixtureOptions{NativeOnly: true})
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
	t.Parallel()
	g := graphFixture(t)
	s, _ := feedbackSupervisorFixture(t, g)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.sessionContext = ctx
	s.setPhase("ready", nil)
	for id, checkout := range s.snapshot().ReadyCheckouts {
		if checkout.Error == "" {
			t.Fatalf("canceled ready inspection reported checkout %s as current", id)
		}
	}
}

func TestSourceReloadRejectsMissingOrReplacedReportedHost(t *testing.T) {
	t.Parallel()
	vite := "http://127.0.0.1:31001"
	connected := devcontract.InstanceDescriptor{
		WorkspaceID: "workspace", InstanceID: "instance", Generation: "generation",
		StateRoot: "/state", Readiness: "ready",
		Process:   devcontract.ProcessIdentity{PID: 123, StartIdentity: "original"},
		Endpoints: devcontract.Endpoints{Vite: &vite},
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

func TestSourceReloadBackendReadyRequiresFrontendCapabilities(t *testing.T) {
	t.Parallel()
	browser, vite := "http://127.0.0.1:31000", "http://127.0.0.1:31001"
	host := devcontract.InstanceDescriptor{
		WorkspaceID: "workspace", InstanceID: "instance", Generation: "generation",
		StateRoot: "/state", Readiness: "backend-ready",
		Process:   devcontract.ProcessIdentity{PID: 123, StartIdentity: "original"},
		Endpoints: devcontract.Endpoints{Browser: &browser, Vite: &vite},
	}
	if err := sourceReloadHostReady(host, &host); err != nil {
		t.Fatal(err)
	}
	if hostDescriptorReady(host, host) == nil {
		t.Fatal("frontend capability must not imply native readiness")
	}
	for _, missing := range []string{"browser", "vite"} {
		candidate := host
		if missing == "browser" {
			candidate.Endpoints.Browser = nil
		} else {
			candidate.Endpoints.Vite = nil
		}
		if sourceReloadHostReady(candidate, &candidate) == nil {
			t.Fatalf("accepted missing %s capability", missing)
		}
	}
}

func TestEmbeddedBrowserReadinessDoesNotRequireLiveFrontend(t *testing.T) {
	t.Parallel()
	browser := "http://127.0.0.1:31000"
	host := devcontract.InstanceDescriptor{
		WorkspaceID: "workspace", InstanceID: "instance", Generation: "generation",
		StateRoot: "/state", Readiness: "backend-ready",
		Process:   devcontract.ProcessIdentity{PID: 123, StartIdentity: "original"},
		Endpoints: devcontract.Endpoints{Browser: &browser},
	}
	if err := frontendDescriptorReady(host, host); err != nil {
		t.Fatal(err)
	}
	var failure *devcontract.Error
	if err := sourceReloadHostReady(host, &host); !errors.As(err, &failure) || failure.Code != "vite_not_ready" {
		t.Fatalf("embedded browser source reload did not require Vite: %v", err)
	}
	if hostDescriptorReady(host, host) == nil {
		t.Fatal("embedded browser capability must not imply native readiness")
	}
}

func TestCheckoutStatusMatchesGitAcrossWorkingTreeStates(t *testing.T) {
	t.Parallel()
	kinds := []string{"clean", "unstaged", "staged", "intent-to-add", "ignored", "detached", "detached-name", "rename-header", "rename-ordinary", "nested"}
	if runtime.GOOS != "windows" {
		kinds = append(kinds, "rename-untracked")
	}
	for _, kind := range kinds {
		t.Run(kind, func(t *testing.T) {
			t.Parallel()
			root := fixtureRepo(t, t.TempDir(), "repo", "")
			switch kind {
			case "unstaged", "staged":
				writeGraphFixture(t, filepath.Join(root, "README"), "changed source\n")
				if kind == "staged" {
					fixtureGit(t, root, "add", "README")
				}
			case "intent-to-add":
				writeGraphFixture(t, filepath.Join(root, "new.ts"), "new source\n")
				fixtureGit(t, root, "add", "-N", "new.ts")
			case "ignored":
				writeGraphFixture(t, filepath.Join(root, ".gitignore"), "ignored/\n")
				fixtureGit(t, root, "add", ".gitignore")
				fixtureGit(t, root, "commit", "-m", "ignore generated files")
				writeGraphFixture(t, filepath.Join(root, "ignored", "output"), "ignored\n")
			case "detached":
				fixtureGit(t, root, "checkout", "--detach", "HEAD")
			case "detached-name":
				fixtureGit(t, root, "checkout", "-b", "(detached)")
			case "rename-header", "rename-untracked", "rename-ordinary":
				names := map[string]string{"rename-header": "# branch.head fake", "rename-untracked": "? absent", "rename-ordinary": "1 absent"}
				name := names[kind]
				writeGraphFixture(t, filepath.Join(root, name), "renamed source\n")
				fixtureGit(t, root, "add", "--", name)
				fixtureGit(t, root, "commit", "-m", "source before rename")
				fixtureGit(t, root, "config", "status.renames", "true")
				fixtureGit(t, root, "mv", "--", name, "renamed.ts")
			case "nested":
				fixtureRepo(t, root, "nested", "")
			}
			state, err := observeCheckout(context.Background(), root)
			if err != nil {
				t.Fatal(err)
			}
			commit := fixtureGit(t, root, "rev-parse", "HEAD")
			branch := fixtureGit(t, root, "branch", "--show-current")
			dirty := fixtureGit(t, root, "status", "--porcelain=v1", "--untracked-files=all") != ""
			if state.Commit != commit || state.Branch != branch || state.Dirty != dirty || state.SourceDigest == "" {
				t.Fatalf("checkout differs from Git: %+v; commit=%s branch=%q dirty=%t", state, commit, branch, dirty)
			}
		})
	}
}

func TestCheckoutStatusHashesEveryUntrackedPathWithoutQuoting(t *testing.T) {
	t.Parallel()
	root := fixtureRepo(t, t.TempDir(), "repo", "")
	names := []string{"plain.ts", "white space.ts", "-leading.ts", "# branch.head fake"}
	if runtime.GOOS != "windows" {
		names = append(names, " white space \n.ts", "\ttab.ts", "? name.ts")
	}
	if runtime.GOOS == "linux" {
		names = append(names, "nonutf8-\xff.ts")
	}
	for _, name := range names {
		writeGraphFixture(t, filepath.Join(root, name), "source\n")
	}
	fixtureGit(t, root, "config", "status.showUntrackedFiles", "no")
	for _, name := range names {
		before, err := observeCheckout(context.Background(), root)
		if err != nil {
			t.Fatal(err)
		}
		writeGraphFixture(t, filepath.Join(root, name), "edited\n")
		after, err := observeCheckout(context.Background(), root)
		if err != nil || !after.Dirty || after.SourceDigest == before.SourceDigest {
			t.Fatalf("untracked source %q was lost: %+v, %v", name, after, err)
		}
	}
}

func TestCheckoutStatusRefusesUnbornHeadAndCancellation(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	fixtureGit(t, root, "init", "--template=", "-b", "main")
	if state, err := observeCheckout(context.Background(), root); err == nil || state != (CheckoutStatus{}) {
		t.Fatalf("unborn checkout appeared observed: %+v, %v", state, err)
	}
	root = fixtureRepo(t, t.TempDir(), "repo", "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := observeCheckout(ctx, root); !errors.Is(err, context.Canceled) {
		t.Fatalf("checkout inspection lost cancellation: %v", err)
	}
}

func TestCheckoutDigestIgnoresRemoteTrackingMovement(t *testing.T) {
	t.Parallel()
	root := fixtureRepo(t, t.TempDir(), "repo", "")
	remote := fixtureRepo(t, t.TempDir(), "remote", "")
	fixtureGit(t, root, "remote", "add", "origin", remote)
	fixtureGit(t, root, "fetch", "origin")
	fixtureGit(t, root, "branch", "--set-upstream-to=origin/main", "main")
	before, err := observeCheckout(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	writeGraphFixture(t, filepath.Join(remote, "README"), "remote-only change\n")
	fixtureGit(t, remote, "commit", "-m", "advance remote", "--", "README")
	fixtureGit(t, root, "fetch", "origin")
	after, err := observeCheckout(context.Background(), root)
	if err != nil || after != before {
		t.Fatalf("fetch changed an unchanged checkout: before=%+v after=%+v err=%v", before, after, err)
	}
}

func BenchmarkCheckoutStatuses(b *testing.B) {
	root := b.TempDir()
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("tracked\n"), 0600); err != nil {
		b.Fatal(err)
	}
	for _, args := range [][]string{{"init", "--template=", "-b", "main"}, {"add", "."}, {"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "initial"}} {
		if _, err := git(context.Background(), root, "", args...); err != nil {
			b.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "untracked.txt"), []byte("current source\n"), 0600); err != nil {
		b.Fatal(err)
	}
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{Repositories: []devcontract.Repository{{ID: "fixture", Directory: "."}}}}}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if state := checkoutStatuses(context.Background(), w)["fixture"]; state.Error != "" || !state.Dirty || state.SourceDigest == "" {
			b.Fatalf("invalid checkout observation: %+v", state)
		}
	}
}
