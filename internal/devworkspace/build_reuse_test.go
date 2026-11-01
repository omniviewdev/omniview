package devworkspace

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

func TestSourceInputReaderPreservesFramingAndReadsFreshBytes(t *testing.T) {
	root := t.TempDir()
	files := []struct {
		name    string
		content []byte
	}{
		{"a.ts", bytes.Repeat([]byte("large\n\x00"), 20000)},
		{"b.ts", nil},
		{"c.ts", []byte("last file")},
	}
	var reader sourceInputReader
	var got, want bytes.Buffer
	for _, file := range files {
		path := filepath.Join(root, file.name)
		if err := os.WriteFile(path, file.content, 0600); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&want, "file\x00%s\x00%o\x00%d\x00", file.name, info.Mode().Perm(), info.Size())
		want.Write(file.content)
		if err = reader.hashFile(&got, root, file.name); err != nil {
			t.Fatal(err)
		}
	}
	if err := reader.hashFile(&got, root, "deleted.ts"); err != nil {
		t.Fatal(err)
	}
	fmt.Fprint(&want, "deleted\x00deleted.ts\x00")
	if !bytes.Equal(got.Bytes(), want.Bytes()) {
		t.Fatal("scratch reuse changed source entry framing")
	}
	path := filepath.Join(root, "c.ts")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	// Metadata-only caching would miss this same-size, restored-mtime edit.
	if err = os.WriteFile(path, []byte("edit file"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	var current bytes.Buffer
	if err = reader.hashFile(&current, root, "c.ts"); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasSuffix(current.Bytes(), []byte("edit file")) {
		t.Fatal("reader reused old source content")
	}
}

func TestSourceInputReaderKeepsSymlinkTargets(t *testing.T) {
	root := t.TempDir()
	if err := os.Symlink("target.ts", filepath.Join(root, "alias.ts")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	var reader sourceInputReader
	var got bytes.Buffer
	if err := reader.hashFile(&got, root, "alias.ts"); err != nil {
		t.Fatal(err)
	}
	if got.String() != "link\x00alias.ts\x00target.ts\x00" {
		t.Fatalf("symlink target framing changed: %q", got.String())
	}
}

type mutatingFingerprintWriter struct {
	io.Writer
	writes int
	change func() error
}

func (writer *mutatingFingerprintWriter) Write(raw []byte) (int, error) {
	n, err := writer.Writer.Write(raw)
	writer.writes++
	if err == nil && writer.writes == 2 {
		err = writer.change()
	}
	return n, err
}

func TestSourceInputReaderRejectsMutationDuringRead(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	if err := os.WriteFile(path, bytes.Repeat([]byte("source"), 20000), 0600); err != nil {
		t.Fatal(err)
	}
	writer := &mutatingFingerprintWriter{Writer: io.Discard, change: func() error {
		return os.WriteFile(path, []byte("changed"), 0600)
	}}
	var reader sourceInputReader
	if err := reader.hashFile(writer, root, "source.ts"); err == nil || !strings.Contains(err.Error(), "source changed while fingerprinting") {
		t.Fatalf("mutation during fingerprint was not refused: %v", err)
	}
}

func BenchmarkSourceInputFingerprint(b *testing.B) {
	root := b.TempDir()
	names := make([]string, 256)
	content := bytes.Repeat([]byte("source\n"), 512)
	for index := range names {
		names[index] = fmt.Sprintf("source-%03d.ts", index)
		if err := os.WriteFile(filepath.Join(root, names[index]), content, 0600); err != nil {
			b.Fatal(err)
		}
	}
	// Both paths hash real files with identical checks. The control gives each
	// file its own scratch, isolating the cost removed by observation reuse.
	for _, mode := range []string{"per-file-scratch", "per-fingerprint-scratch"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(names) * len(content)))
			hash := sha256.New()
			b.ResetTimer()
			for range b.N {
				hash.Reset()
				var reader sourceInputReader
				for _, name := range names {
					if mode == "per-file-scratch" {
						reader = sourceInputReader{}
					}
					if err := reader.hashFile(hash, root, name); err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
}
