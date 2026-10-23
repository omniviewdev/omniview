package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/fsnotify/fsnotify"
)

type graphManagedFixture struct{}

func (*graphManagedFixture) SetDependencyWatching(string, string, bool) error {
	return nil
}
func (*graphManagedFixture) RebuildPluginGeneration(context.Context, string, string) error {
	return nil
}

func TestWatchTreeIncludesNewSourceDirectoriesButNotOutputs(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"settings/new", "log", "proto", "pkg/new/module", "packages/omniviewdev-runtime/src/feature", "packages/omniviewdev-runtime/src/bindings/nested", "dist/generated", "shims/generated", "node_modules/dependency", ".git/objects"} {
		if err := os.MkdirAll(filepath.Join(root, rel), 0700); err != nil {
			t.Fatal(err)
		}
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	g := &BuildGraph{Nodes: []BuildNode{{ID: "bindings", Directory: root}}}
	if err = g.addWatchTree(w, root); err != nil {
		t.Fatal(err)
	}
	watched := map[string]bool{}
	for _, dir := range w.WatchList() {
		watched[dir] = true
	}
	for _, rel := range []string{"settings/new", "log", "proto", "pkg/new/module", "packages/omniviewdev-runtime/src", "packages/omniviewdev-runtime/src/feature"} {
		if !watched[filepath.Join(root, rel)] {
			t.Fatalf("source not watched: %s", rel)
		}
	}
	for _, rel := range []string{"packages/omniviewdev-runtime/src/bindings", "packages/omniviewdev-runtime/src/bindings/nested", "dist", "dist/generated", "shims", "shims/generated", "node_modules", "node_modules/dependency", ".git", ".git/objects"} {
		if watched[filepath.Join(root, rel)] {
			t.Fatalf("generated/dependency output watched: %s", rel)
		}
	}
}

func TestWatchIgnoresItsGeneratedBindingsAndShims(t *testing.T) {
	g := graphFixture(t)
	if !g.generatedSourceOutput(filepath.Join(g.workspace.Root, "host/packages/omniviewdev-runtime/src/bindings/models.ts")) {
		t.Fatal("bindings generation would enqueue a second build")
	}
	if !g.generatedSourceOutput(filepath.Join(g.workspace.Root, "host/ui/providers/monaco/yaml.worker.bundle.js")) {
		t.Fatal("worker publication would enqueue a second build")
	}
	if !g.generatedSourceOutput(filepath.Join(g.workspace.Root, "host/vite.config.ts.timestamp-123-abc.mjs")) {
		t.Fatal("Vite config loading would enqueue a second build")
	}
	if g.generatedSourceOutput(filepath.Join(g.workspace.Root, "host/vite.config.ts.timestamp-human.mjs")) {
		t.Fatal("non-loader user source was ignored")
	}
	if !ignoredBuildDirectory("shims") {
		t.Fatal("shim generation would rebuild itself forever")
	}
}
