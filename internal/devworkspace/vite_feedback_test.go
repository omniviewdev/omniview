package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// Read the same JSON a Vite child consumes, independently of the writer's types.
// These tests keep the graph's actual staging/publication and inspect its output;
// only the external compiler and host/plugin readiness boundaries use fixtures.
type feedbackConsumerContext struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceID"`
	Generation    string `json:"generation"`
	WorkspaceRoot string `json:"workspaceRoot"`
	File          string `json:"file"`
}

type feedbackConsumerState struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceID"`
	Generation    string `json:"generation"`
	WorkspaceRoot string `json:"workspaceRoot"`
	Held          *bool  `json:"held"`
}

func feedbackSupervisorFixture(t *testing.T, g *BuildGraph) (*workspaceSupervisor, string) {
	t.Helper()
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g.workspace.StateRoot = filepath.Join(home, ".omniview-dev", "profiles", g.workspace.Manifest.WorkspaceID, "state")
	cache, err := prepareWorkspaceBuildCache(context.Background(), g.workspace, home, g.options.Generation)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := devsession.OpenRegistry(filepath.Join(home, "sessions"), devsession.RegistryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	g.options.GoBuildCacheDirectory = cache
	s := &workspaceSupervisor{
		workspace: g.workspace, generation: g.options.Generation,
		manager: &Manager{options: Options{Home: home}}, graphInstance: g,
		registry: registry,
		options:  LaunchOptions{LiveFrontend: true, Watch: true}, output: io.Discard,
		sessionContext: context.Background(), status: Status{Workspace: g.workspace, Generation: g.options.Generation},
	}
	t.Cleanup(func() { _ = s.stopChildren(context.Background()) })
	path := filepath.Join(filepath.Dir(cache), "vite-feedback-"+s.generation+".json")
	return s, path
}

func feedbackWatchFixture(t *testing.T) (*BuildGraph, *workspaceSupervisor, WatchHooks, string) {
	t.Helper()
	g := graphFixture(t)
	s, path := feedbackSupervisorFixture(t, g)
	g.run = func(_ context.Context, _ string, program string, _ ...string) ([]byte, error) {
		if program == "go" {
			return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
		}
		return nil, nil
	}
	g.options.Bindings = func(_ context.Context, _ string, output string) error {
		return os.WriteFile(filepath.Join(output, "index.ts"), []byte("export const repairedSDK = true;\n"), 0600)
	}
	// Retain the supervisor's transaction hooks; substitute only external
	// readiness boundaries, not the hold/release implementation under test.
	hooks := s.watchHooks()
	hooks.Managed = &graphManagedFixture{}
	hooks.Generations = func(context.Context) (map[string]string, error) {
		return map[string]string{"plugin": "exact-plugin-generation"}, nil
	}
	hooks.HostRebuildAndWait = func(context.Context, HostBuildRequest) (map[string]bool, error) {
		return map[string]bool{"plugin": true}, nil
	}
	hooks.WaitPluginReady = func(context.Context, string, string) error { return nil }
	hooks.RefreshConsumers = func(context.Context, WatchChange) error { return nil }
	return g, s, hooks, path
}

func readFeedbackConsumer(s *workspaceSupervisor) (feedbackConsumerContext, feedbackConsumerState, os.FileInfo, error) {
	var config feedbackConsumerContext
	var state feedbackConsumerState
	var encoded string
	for _, entry := range s.environment() {
		if key, value, ok := strings.Cut(entry, "="); ok && key == "OMNIVIEW_VITE_FEEDBACK" {
			if encoded != "" {
				return config, state, nil, errors.New("child inherited duplicate feedback contexts")
			}
			encoded = value
		}
	}
	if encoded == "" {
		return config, state, nil, errors.New("browser-visible producer has no managed Vite feedback barrier")
	}
	if err := json.Unmarshal([]byte(encoded), &config); err != nil {
		return config, state, nil, err
	}
	if config.SchemaVersion != 1 || config.WorkspaceID != s.workspace.Manifest.WorkspaceID || config.Generation != s.generation || config.WorkspaceRoot != s.workspace.Root {
		return config, state, nil, fmt.Errorf("child feedback context differs from selected workspace: %+v", config)
	}
	info, err := os.Lstat(config.File)
	if err != nil {
		return config, state, nil, err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm() != 0600) {
		return config, state, info, fmt.Errorf("feedback is not a private regular file: %s", info.Mode())
	}
	if err := devsession.ValidatePrivateFile(config.File); err != nil {
		return config, state, info, err
	}
	raw, err := os.ReadFile(config.File)
	if err == nil {
		err = json.Unmarshal(raw, &state)
	}
	if err != nil {
		return config, state, info, err
	}
	if state.SchemaVersion != 1 || state.WorkspaceID != config.WorkspaceID || state.Generation != config.Generation || state.WorkspaceRoot != config.WorkspaceRoot || state.Held == nil {
		return config, state, info, fmt.Errorf("feedback state differs from child context: %+v", state)
	}
	return config, state, info, nil
}

func assertFeedbackHeld(t *testing.T, s *workspaceSupervisor, held bool, stage string) os.FileInfo {
	t.Helper()
	_, state, info, err := readFeedbackConsumer(s)
	if err != nil {
		t.Errorf("%s: %v", stage, err)
		return nil
	}
	if *state.Held != held {
		t.Errorf("%s: browser feedback held=%v, want %v", stage, *state.Held, held)
	}
	return info
}

func TestViteFeedbackInitialLaunchFailureLeavesReconnectHeld(t *testing.T) {
	_, s, _, _ := feedbackWatchFixture(t)
	s.options.Timeout = 3 * time.Second
	// Missing reviewed link evidence rejects real graph preparation before any
	// compiler or child can run. Initial feedback must already be fail-closed.
	if err := s.launch(context.Background()); err == nil {
		t.Fatal("initial launch accepted missing reviewed graph evidence")
	}
	assertFeedbackHeld(t, s, true, "initial graph preparation failure before Vite startup")
	if len(s.children) != 0 {
		t.Fatal("failed preparation started a child")
	}
}

func TestViteFeedbackPublishesNativeAuthorityForTheOriginalHandle(t *testing.T) {
	_, s, _, _ := feedbackWatchFixture(t)
	change := WatchChange{Nodes: []string{"host-backend"}}
	if err := s.beginFeedback(context.Background(), change); err != nil {
		t.Fatal(err)
	}
	var encoded string
	for _, entry := range s.environment() {
		if value, ok := strings.CutPrefix(entry, viteFeedbackEnvironment+"="); ok {
			encoded = value
		}
	}
	if held, err := ReadViteFeedbackContext(encoded); err != nil || !held {
		t.Fatalf("native authority did not observe initial hold: held=%v err=%v", held, err)
	}
	if err := s.commitFeedback(context.Background(), change); err != nil {
		t.Fatal(err)
	}
	if held, err := ReadViteFeedbackContext(encoded); err != nil || held {
		t.Fatalf("native authority did not observe actual release: held=%v err=%v", held, err)
	}
}

func TestViteFeedbackHoldsBeforePublicationUntilAllReplacementReadiness(t *testing.T) {
	// An ambient context from another supervisor must never reach any child.
	t.Setenv("OMNIVIEW_VITE_FEEDBACK", `{"schemaVersion":1,"workspaceID":"foreign","held":false}`)
	g, s, hooks, path := feedbackWatchFixture(t)
	var first os.FileInfo
	bindings := g.options.Bindings
	g.options.Bindings = func(ctx context.Context, host, output string) error {
		first = assertFeedbackHeld(t, s, true, "before first bindings producer writes")
		return bindings(ctx, host, output)
	}
	producer := g.runProducer
	g.runProducer = func(ctx context.Context, directory string, environment []string, program string, args ...string) ([]byte, error) {
		assertFeedbackHeld(t, s, true, "before JavaScript/shim producer writes")
		return producer(ctx, directory, environment, program, args...)
	}
	hooks.HostRebuildAndWait = func(context.Context, HostBuildRequest) (map[string]bool, error) {
		// This is the actual published file, not the compiler's private staging tree.
		raw, err := os.ReadFile(filepath.Join(g.workspace.Root, "host/packages/omniviewdev-runtime/src/bindings/index.ts"))
		if err != nil || string(raw) != "export const repairedSDK = true;\n" {
			return nil, fmt.Errorf("bindings were not actually published before host replacement: %q: %w", raw, err)
		}
		assertFeedbackHeld(t, s, true, "host replacement readiness boundary")
		return map[string]bool{"plugin": true}, nil
	}
	hooks.WaitPluginReady = func(_ context.Context, id, generation string) error {
		if id != "plugin" || generation != "exact-plugin-generation" {
			return errors.New("plugin readiness did not target the current exact generation")
		}
		assertFeedbackHeld(t, s, true, "applicable plugin readiness boundary")
		return nil
	}
	hooks.RefreshConsumers = func(context.Context, WatchChange) error {
		assertFeedbackHeld(t, s, true, "consumer refresh completion boundary")
		return nil
	}
	if err := g.rebuildChange(context.Background(), []string{filepath.Join(g.plan.SDK, "repair.go")}, hooks); err != nil {
		t.Fatal(err)
	}
	last := assertFeedbackHeld(t, s, false, "successful replacement committed")
	config, _, _, err := readFeedbackConsumer(s)
	if err == nil && config.File != path {
		t.Errorf("feedback escaped canonical default UUID runtime: %s, want %s", config.File, path)
	}
	if first != nil && last != nil && !os.SameFile(first, last) {
		t.Error("release replaced the stable feedback inode")
	}
}

func TestViteFeedbackFailureCannotBeReleasedByUnrelatedFrontendSuccess(t *testing.T) {
	for _, failure := range []string{"producer", "host", "plugin", "refresh"} {
		t.Run(failure, func(t *testing.T) {
			g, s, hooks, _ := feedbackWatchFixture(t)
			broken := errors.New("replacement remains incomplete")
			bindings := g.options.Bindings
			hostReady, pluginReady, refresh := hooks.HostRebuildAndWait, hooks.WaitPluginReady, hooks.RefreshConsumers
			switch failure {
			case "producer":
				g.options.Bindings = func(ctx context.Context, host, output string) error {
					return errors.Join(bindings(ctx, host, output), broken)
				}
			case "host":
				hooks.HostRebuildAndWait = func(context.Context, HostBuildRequest) (map[string]bool, error) { return nil, broken }
			case "plugin":
				hooks.WaitPluginReady = func(context.Context, string, string) error { return broken }
			case "refresh":
				hooks.RefreshConsumers = func(context.Context, WatchChange) error { return broken }
			}
			if err := g.rebuildChange(context.Background(), []string{filepath.Join(g.plan.SDK, "repair.go")}, hooks); !errors.Is(err, broken) {
				t.Fatalf("replacement error lost: %v", err)
			}
			failed := assertFeedbackHeld(t, s, true, "failed replacement")
			g.options.Bindings = bindings
			hooks.HostRebuildAndWait, hooks.WaitPluginReady, hooks.RefreshConsumers = hostReady, pluginReady, refresh
			if err := g.rebuildChange(context.Background(), []string{filepath.Join(g.workspace.Root, "host/ui/component.tsx")}, hooks); err != nil {
				t.Fatalf("independent frontend publication: %v", err)
			}
			assertFeedbackHeld(t, s, true, "unrelated frontend success cannot discharge host obligation")
			if err := g.rebuildChange(context.Background(), []string{filepath.Join(g.plan.SDK, "repair.go")}, hooks); err != nil {
				t.Fatal(err)
			}
			repaired := assertFeedbackHeld(t, s, false, "complete SDK replacement repairs held transaction")
			if failed != nil && repaired != nil && !os.SameFile(failed, repaired) {
				t.Error("repair discarded the original barrier inode")
			}
		})
	}
}

func TestViteFeedbackRefusesUnknownExistingFileBeforePublishing(t *testing.T) {
	g, _, hooks, path := feedbackWatchFixture(t)
	foreign := []byte(`{"schemaVersion":1,"workspaceID":"11111111-1111-4111-8111-111111111111","generation":"22222222-2222-4222-8222-222222222222","workspaceRoot":"` + g.workspace.Root + `","held":false}`)
	if err := os.WriteFile(path, foreign, 0600); err != nil {
		t.Fatal(err)
	}
	published := filepath.Join(g.workspace.Root, "host/packages/omniviewdev-runtime/src/bindings/index.ts")
	before, err := os.ReadFile(published)
	if err != nil {
		t.Fatal(err)
	}
	if err = g.rebuildChange(context.Background(), []string{filepath.Join(g.plan.SDK, "repair.go")}, hooks); err == nil {
		t.Error("replacement adopted an unknown preexisting feedback file")
	}
	after, err := os.ReadFile(published)
	if err != nil || string(after) != string(before) {
		t.Errorf("unowned barrier allowed actual bindings publication: %q: %v", after, err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || string(actual) != string(foreign) {
		t.Errorf("unknown feedback metadata was changed: %q: %v", actual, err)
	}
}

func TestViteFeedbackRejectsTamperedOwnershipBeforeRelease(t *testing.T) {
	for _, tamper := range []string{"replaced-inode", "symlink", "generation", "workspace-root", "malformed", "permissions"} {
		t.Run(tamper, func(t *testing.T) {
			g, s, hooks, path := feedbackWatchFixture(t)
			bindings := g.options.Bindings
			var foreign []byte
			g.options.Bindings = func(ctx context.Context, host, output string) error {
				if err := bindings(ctx, host, output); err != nil {
					return err
				}
				raw, err := os.ReadFile(path)
				if err != nil {
					return fmt.Errorf("first producer lacks owned barrier: %w", err)
				}
				if tamper == "replaced-inode" || tamper == "symlink" {
					original := path + ".original"
					if err := os.Rename(path, original); err != nil {
						return err
					}
					// Restore the owned inode before normal supervisor cleanup.
					t.Cleanup(func() { _ = os.Remove(path); _ = os.Rename(original, path) })
				} else {
					// Exercise content/permission integrity on the original inode,
					// independently of replacement-path identity protection.
					t.Cleanup(func() { _ = os.WriteFile(path, raw, 0600); _ = os.Chmod(path, 0600) })
				}
				foreign = append([]byte(nil), raw...)
				switch tamper {
				case "generation", "workspace-root":
					var state map[string]any
					if err := json.Unmarshal(raw, &state); err != nil {
						return err
					}
					if tamper == "generation" {
						state["generation"] = "foreign-generation"
					} else {
						state["workspaceRoot"] = filepath.Dir(s.workspace.Root)
					}
					foreign, err = json.Marshal(state)
					if err != nil {
						return err
					}
				case "malformed":
					foreign = []byte(`{"held":`)
				case "symlink":
					target := filepath.Join(t.TempDir(), "foreign-feedback")
					if err := os.WriteFile(target, foreign, 0600); err != nil {
						return err
					}
					return os.Symlink(target, path)
				}
				if err := os.WriteFile(path, foreign, 0600); err != nil {
					return err
				}
				if tamper == "permissions" {
					return tamperFeedbackPermissions(t, path)
				}
				return nil
			}
			if err := g.rebuildChange(context.Background(), []string{filepath.Join(g.plan.SDK, "repair.go")}, hooks); err == nil {
				t.Fatal("replacement released feedback after ownership/integrity tampering")
			}
			if foreign == nil {
				t.Fatal("browser-visible producer ran without an owned feedback barrier")
			}
			actual, err := os.ReadFile(path)
			if err != nil || string(actual) != string(foreign) {
				t.Errorf("release overwrote foreign feedback metadata: %q: %v", actual, err)
			}
		})
	}
}

func TestSourceUpdateEarlyQuiescenceFailureCannotRemainReady(t *testing.T) {
	for _, failure := range []string{"feedback-integrity", "backend-quiescence"} {
		t.Run(failure, func(t *testing.T) {
			g, s, _, path := feedbackWatchFixture(t)
			root, err := devcontract.CanonicalPath(t.TempDir())
			require.NoError(t, err)
			s.manager.Root = root
			initial := WatchChange{Nodes: []string{"host-backend"}}
			require.NoError(t, s.beginFeedback(context.Background(), initial))
			require.NoError(t, s.commitFeedback(context.Background(), initial))
			source := filepath.Join(g.workspace.Root, "plugin", "pkg", "source.go")
			var intent sourceUpdateIntent
			intent.WorkspaceID = s.workspace.Manifest.WorkspaceID
			intent.Root = s.workspace.Root
			intent.Plan.WorkspaceID = s.workspace.Manifest.WorkspaceID
			intent.Running = true
			intent.Paths = []string{source}
			intentPath := sourceUpdatePath(s.manager, s.workspace)
			require.NoError(t, os.MkdirAll(filepath.Dir(intentPath), 0700))
			require.NoError(t, saveSourceUpdate(s.manager, s.workspace, &intent, "prepared"))
			before, err := os.ReadFile(intentPath)
			require.NoError(t, err)
			if failure == "feedback-integrity" {
				data, readErr := os.ReadFile(path)
				require.NoError(t, readErr)
				require.NoError(t, os.Rename(path, path+".retained"))
				require.NoError(t, os.WriteFile(path, data, 0600))
			}
			done := make(chan struct{})
			canceled := false
			s.watchDone = done
			s.watchCancel = func() { canceled = true; close(done) }
			s.status.Phase = "ready"
			status, err := s.applySourceUpdate(context.Background())
			require.Error(t, err, "source update accepted unresolved producer fencing")
			require.True(t, canceled, "source update did not quiesce local watcher")
			require.Equal(t, "error", status.Phase, "quiescence failure left a ready-but-unwatched runtime")
			require.NotNil(t, status.LastError)
			require.NotEmpty(t, status.RecoveryCommand)
			after, err := os.ReadFile(intentPath)
			require.NoError(t, err)
			require.Equal(t, string(before), string(after), "early quiescence failure changed captured checkout progress")
		})
	}
}
