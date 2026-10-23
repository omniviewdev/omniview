package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func recoveryWatchHooks(t *testing.T, g *BuildGraph, started chan struct{}) WatchHooks {
	t.Helper()
	s, _ := feedbackSupervisorFixture(t, g)
	return WatchHooks{
		BeginFeedback:  s.beginFeedback,
		CommitFeedback: s.commitFeedback,
		Managed:        &graphManagedFixture{},
		Generations: func(context.Context) (map[string]string, error) {
			select {
			case started <- struct{}{}:
			default:
			}
			return map[string]string{"plugin": "generation-a"}, nil
		},
		WaitPluginReady:    func(context.Context, string, string) error { return nil },
		HostRebuildAndWait: func(context.Context, HostBuildRequest) (map[string]bool, error) { return nil, nil },
		RefreshConsumers:   func(context.Context, WatchChange) error { return nil },
		Debounce:           30 * time.Millisecond,
	}
}

func TestWatchRecoveryCannotDeclareReadyWithUnrebuiltSDKBackend(t *testing.T) {
	g := graphFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	runtimeDirectory := filepath.Join(g.workspace.Root, "host/packages/omniviewdev-runtime")
	runtimeSource := filepath.Join(runtimeDirectory, "src/edited.ts")
	writeGraphFixture(t, runtimeSource, "broken")
	g.run = func(_ context.Context, _ string, program string, _ ...string) ([]byte, error) {
		if program == "go" {
			return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
		}
		return nil, nil
	}
	g.options.Bindings = func(_ context.Context, _ string, output string) error {
		writeGraphFixture(t, filepath.Join(output, "index.ts"), "export const generated = true;\n")
		return nil
	}
	compiler := g.runProducer
	g.runProducer = func(ctx context.Context, directory string, environment []string, program string, args ...string) ([]byte, error) {
		if directory == runtimeDirectory && len(args) > 0 && args[len(args)-1] == "typecheck" {
			content, err := os.ReadFile(runtimeSource)
			if err != nil {
				return nil, err
			}
			if string(content) == "broken" {
				return nil, errors.New("runtime typecheck failed")
			}
		}
		return compiler(ctx, directory, environment, program, args...)
	}
	started := make(chan struct{}, 1)
	hooks := recoveryWatchHooks(t, g, started)
	hooks.HostRebuildAndWait = func(context.Context, HostBuildRequest) (map[string]bool, error) {
		return nil, errors.New("SDK backend remains invalid")
	}
	events := make(chan BuildEvent, 16)
	g.options.OnEvent = func(event BuildEvent) {
		if event.Node == "graph" {
			events <- event
		}
	}
	done := make(chan error, 1)
	go func() { done <- g.Watch(ctx, hooks) }()
	select {
	case <-started:
	case err := <-done:
		t.Fatalf("watch exited before startup: %v", err)
	case <-ctx.Done():
		t.Fatal("watch did not start")
	}
	writeGraphFixture(t, filepath.Join(g.plan.SDK, "changed.go"), "package sdk\n")
	select {
	case event := <-events:
		if event.Phase != "error" {
			t.Fatalf("initial failed dependency chain advertised readiness: %+v", event)
		}
	case err := <-done:
		t.Fatalf("watch exited before SDK change: %v", err)
	case <-ctx.Done():
		t.Fatal("SDK change was not processed")
	}
	writeGraphFixture(t, runtimeSource, "fixed")
	select {
	case event := <-events:
		if event.Phase != "error" {
			t.Fatalf("recovery advertised readiness without rebuilding the failed SDK backend: %+v", event)
		}
	case err := <-done:
		t.Fatalf("watch exited before runtime repair: %v", err)
	case <-ctx.Done():
		t.Fatal("runtime repair was not processed")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("watch cancellation: %v", err)
	}
}

func TestWatchRejectsNewAggregatePNPMModuleHook(t *testing.T) {
	g := graphFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	started := make(chan struct{}, 1)
	done := make(chan error, 1)
	hooks := recoveryWatchHooks(t, g, started)
	go func() { done <- g.Watch(ctx, hooks) }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("watch did not start")
	}
	writeGraphFixture(t, filepath.Join(g.workspace.Root, ".pnpmfile.mjs"), "export const hooks = {};\n")
	if err := <-done; err == nil || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		t.Fatalf("forbidden aggregate policy hook did not invalidate running composition: %v", err)
	}
}
