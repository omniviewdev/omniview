package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// reuseFixture is graphFixture without Go compiler nodes. Every real build
// publishes distinct bytes, so a rebuilt dependency changes its output digest.
type reuseFixture struct {
	g      *BuildGraph
	nodes  []BuildNode
	mu     sync.Mutex
	builds []string
	serial int
}

func newReuseFixture(t *testing.T) *reuseFixture {
	t.Helper()
	f := &reuseFixture{g: graphFixture(t)}
	g := f.g
	// Like the real host, a tracked placeholder lives in an output directory
	// that the host-frontend publication replaces.
	host := filepath.Join(g.workspace.Root, "host")
	writeGraphFixture(t, filepath.Join(host, "dist/.gitkeep"), "")
	fixtureGit(t, host, "add", "-f", "dist/.gitkeep")
	fixtureGit(t, host, "commit", "-m", "tracked dist placeholder")
	g.reusePath = filepath.Join(t.TempDir(), "build-reuse.json")
	g.toolInputs = func(context.Context, BuildNode) (string, error) { return "fixture-tools", nil }
	g.run = func(_ context.Context, _ string, program string, _ ...string) ([]byte, error) {
		switch program {
		case "pnpm":
			return []byte("{}"), nil
		case "go":
			return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
		}
		return nil, os.ErrInvalid
	}
	g.options.Bindings = func(_ context.Context, _, output string) error {
		f.record("bindings")
		writeGraphFixture(t, filepath.Join(output, "index.ts"), fmt.Sprintf("export const build = %d;\n", f.next()))
		return nil
	}
	g.runProducer = func(_ context.Context, directory string, environment []string, _ string, args ...string) ([]byte, error) {
		if len(args) == 0 || args[len(args)-1] != "build" {
			return nil, nil
		}
		for _, n := range f.nodes {
			if n.Kind == "javascript" && n.Directory == directory {
				f.record(n.ID)
			}
		}
		serial := f.next()
		for _, entry := range environment {
			key, value, _ := strings.Cut(entry, "=")
			switch key {
			case "OMNIVIEW_BUILD_OUTPUT_DIRECTORY":
				name := "index.js"
				if directory == filepath.Join(g.workspace.Root, "host") {
					name = "index.html"
				}
				writeGraphFixture(t, filepath.Join(value, name), fmt.Sprintf("build %d\n", serial))
			case "OMNIVIEW_SHIMS_OUTPUT_DIRECTORY":
				writeGraphFixture(t, filepath.Join(value, "runtime.mjs"), fmt.Sprintf("export const build = %d;\n", serial))
			case "OMNIVIEW_YAML_WORKER_OUTPUT_FILE":
				writeGraphFixture(t, value, fmt.Sprintf("self.build = %d;\n", serial))
			}
		}
		return nil, nil
	}
	for _, n := range g.Nodes {
		if n.Kind == "javascript" || n.Kind == "bindings" {
			f.nodes = append(f.nodes, n)
		}
	}
	return f
}

// newHostReuseFixture seeds an owned executable and its valid reuse receipt,
// without pretending that a fixture producer compiled selected native sources.
// Reuse goes through the real supervisor launch-artifact selection path.
func newHostReuseFixture(t *testing.T, executable []byte) (*BuildGraph, BuildNode, *workspaceSupervisor, string) {
	t.Helper()
	f := newReuseFixture(t)
	g := f.g
	s := &workspaceSupervisor{workspace: g.workspace, options: LaunchOptions{Mode: "native"}}
	g.options.HostOutput = s.hostOutput()
	g.options.HostVariant = s.hostVariant()
	g.options.ReuseHost = s.reuseHost
	prepared, err := PrepareGeneratedTree(g.workspace, s.hostOutput(), NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(prepared.Directory, s.hostLaunchRelative())
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, executable, 0700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(prepared); err != nil {
		t.Fatal(err)
	}
	node := outputGraphNode(t, g, "host-backend")
	// Isolate the host's own source fingerprint from bindings/frontend output
	// changes. Those dependencies have separate regression coverage.
	node.Dependencies = nil
	return g, node, s, filepath.Join(prepared.Destination, s.hostLaunchRelative())
}

func (f *reuseFixture) record(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.builds = append(f.builds, id)
}
func (f *reuseFixture) next() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.serial++
	return f.serial
}

// bootstrap runs the batch like a new supervisor process: fresh in-memory
// dependency outputs and the persisted reuse record.
func (f *reuseFixture) bootstrap(t *testing.T) []string {
	t.Helper()
	f.mu.Lock()
	f.builds = nil
	f.mu.Unlock()
	f.g.outputs = nil
	if err := f.g.execute(context.Background(), f.nodes, f.g.loadBuildReuse()); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	built := slices.Clone(f.builds)
	slices.Sort(built)
	return built
}

func TestBootstrapReuseSkipsUnchangedNodesAndRebuildsChangedClosure(t *testing.T) {
	f := newReuseFixture(t)
	if built := f.bootstrap(t); len(built) != len(f.nodes) {
		t.Fatalf("first bootstrap built %v, want every node", built)
	}
	if built := f.bootstrap(t); len(built) != 0 {
		t.Fatalf("unchanged bootstrap rebuilt %v", built)
	}
	writeGraphFixture(t, filepath.Join(f.g.workspace.Root, "ui/packages/ai-ui/src/panel.ts"), "export const edited = true;\n")
	built := f.bootstrap(t)
	want := []string{"ai-ui", "host-frontend", "plugin-ui:plugin", "runtime", "vite-plugin"}
	if !slices.Equal(built, want) {
		t.Fatalf("edit in ai-ui rebuilt %v, want %v", built, want)
	}
	if built := f.bootstrap(t); len(built) != 0 {
		t.Fatalf("bootstrap after rebuilding the edit rebuilt %v", built)
	}
}

func TestBootstrapReuseRebuildsOutputsReplacedOutsideBootstrap(t *testing.T) {
	f := newReuseFixture(t)
	f.bootstrap(t)
	// A watch transaction republishes base-ui without updating reuse records.
	if err := f.g.execute(context.Background(), []BuildNode{outputGraphNode(t, f.g, "base-ui")}, nil); err != nil {
		t.Fatal(err)
	}
	built := f.bootstrap(t)
	if !slices.Contains(built, "base-ui") || !slices.Contains(built, "ai-ui") || slices.Contains(built, "providers") || slices.Contains(built, "bindings") {
		t.Fatalf("replaced base-ui output rebuilt %v, want base-ui and its dependents only", built)
	}
}

func TestBootstrapReuseRebuildsEverythingWhenToolchainChanges(t *testing.T) {
	f := newReuseFixture(t)
	f.bootstrap(t)
	f.g.toolInputs = func(context.Context, BuildNode) (string, error) { return "upgraded-tools", nil }
	if built := f.bootstrap(t); len(built) != len(f.nodes) {
		t.Fatalf("toolchain change rebuilt only %v", built)
	}
}

func TestExecuteRunsIndependentNodesConcurrently(t *testing.T) {
	if buildParallelism() < 2 {
		t.Skip("single-core parallelism")
	}
	g := graphFixture(t)
	started := map[string]chan struct{}{"ai-ui": make(chan struct{}), "editors": make(chan struct{})}
	other := map[string]string{"ai-ui": "editors", "editors": "ai-ui"}
	produce := g.runProducer
	g.runProducer = func(ctx context.Context, directory string, environment []string, program string, args ...string) ([]byte, error) {
		id := filepath.Base(directory)
		if ch, ok := started[id]; ok && args[len(args)-1] == "build" {
			close(ch)
			select {
			case <-started[other[id]]:
			case <-time.After(10 * time.Second):
				return nil, fmt.Errorf("%s never overlapped with %s", id, other[id])
			}
		}
		return produce(ctx, directory, environment, program, args...)
	}
	nodes := []BuildNode{outputGraphNode(t, g, "base-ui"), outputGraphNode(t, g, "ai-ui"), outputGraphNode(t, g, "editors")}
	if err := g.execute(context.Background(), nodes, nil); err != nil {
		t.Fatal(err)
	}
}

func TestExecuteFailureStartsNoDependentAndLetsRunningSiblingFinish(t *testing.T) {
	if buildParallelism() < 2 {
		t.Skip("single-core parallelism")
	}
	g := graphFixture(t)
	var mu sync.Mutex
	events := []BuildEvent{}
	g.options.OnEvent = func(event BuildEvent) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, event)
	}
	failed := make(chan struct{})
	produce := g.runProducer
	g.runProducer = func(ctx context.Context, directory string, environment []string, program string, args ...string) ([]byte, error) {
		switch filepath.Base(directory) {
		case "omniviewdev-providers":
			defer close(failed)
			return nil, errors.New("providers compiler failed")
		case "base-ui":
			if args[len(args)-1] == "build" {
				<-failed
			}
		}
		return produce(ctx, directory, environment, program, args...)
	}
	nodes := []BuildNode{outputGraphNode(t, g, "base-ui"), outputGraphNode(t, g, "ai-ui"), outputGraphNode(t, g, "providers")}
	err := g.execute(context.Background(), nodes, nil)
	if err == nil || !strings.HasPrefix(err.Error(), "providers: ") {
		t.Fatalf("failure not attributed to providers: %v", err)
	}
	phases := map[string]string{}
	for _, event := range events {
		phases[event.Node] = event.Phase
	}
	if phases["providers"] != "error" || phases["base-ui"] != "ready" {
		t.Fatalf("running sibling did not settle after failure: %v", phases)
	}
	if _, started := phases["ai-ui"]; started {
		t.Fatalf("dependent started after a failure: %v", phases)
	}
}
