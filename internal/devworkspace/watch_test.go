package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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
	for _, rel := range []string{"settings/new", "log", "proto", "pkg/new/module", "dist/generated", "node_modules/dependency", ".git/objects"} {
		if err := os.MkdirAll(filepath.Join(root, rel), 0700); err != nil {
			t.Fatal(err)
		}
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if err = addWatchTree(w, root); err != nil {
		t.Fatal(err)
	}
	watched := map[string]bool{}
	for _, dir := range w.WatchList() {
		watched[dir] = true
	}
	for _, rel := range []string{"settings/new", "log", "proto", "pkg/new/module"} {
		if !watched[filepath.Join(root, rel)] {
			t.Fatalf("source not watched: %s", rel)
		}
	}
	for dir := range watched {
		if strings.Contains(dir, "node_modules") || strings.Contains(dir, "/dist/") || strings.Contains(dir, "/.git") {
			t.Fatalf("generated/dependency output watched: %s", dir)
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
