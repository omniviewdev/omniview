package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestResetDependencyTreesUnblocksInterruptedRestoration(t *testing.T) {
	ctx := context.Background()
	w, p, consumer := compositionFixture(t)
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(w.Root, "node_modules/.pnpm/owned.js"), "owned package")
	writeOutput(t, filepath.Join(consumer, "node_modules/owned.js"), "owned link")
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	repo := filepath.Dir(filepath.Dir(consumer))
	stage, err := Prepare(ctx, w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "published")
	if err = Publish(ctx, stage); err != nil {
		t.Fatal(err)
	}
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	// Persist a real restoration intent for every entry, as an interrupted
	// unlink/remove leaves it.
	err = locked(ctx, s, func(j *journal) error {
		observations, e := observeRestorationEntries(ctx, j)
		if e != nil {
			return e
		}
		return prepareRestorationIntents(ctx, s, j, observations)
	})
	if err != nil {
		t.Fatal(err)
	}
	// A manual vitest run then changes an owned modules tree.
	if err = os.Mkdir(filepath.Join(consumer, "node_modules/.vite-temp"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err == nil {
		t.Fatal("restoration accepted an unowned change")
	}
	if _, err = ResetDependencyTrees(ctx, w, nil, false); err == nil {
		t.Fatal("linked reset accepted an incomplete restoration")
	}
	removed, err := ResetDependencyTrees(ctx, w, []string{repo, consumer}, true)
	if err != nil {
		t.Fatal(err)
	}
	listed := map[string]bool{}
	for _, path := range removed {
		listed[path] = true
	}
	for _, path := range []string{filepath.Join(w.Root, "node_modules"), filepath.Join(consumer, "node_modules")} {
		if !listed[path] {
			t.Fatalf("owned tree was not reset: %s in %v", path, removed)
		}
		if _, err = os.Lstat(path); !os.IsNotExist(err) {
			t.Fatal("reset tree survived", path, err)
		}
	}
	j, err := readJournal(s)
	if err != nil {
		t.Fatal(err)
	}
	dist := j.Entries[filepath.Join(repo, "dist")+"|"+string(Distribution)]
	if !j.Restoring || len(j.Entries) != 1 || dist == nil || dist.Pending == nil {
		t.Fatal("reset changed restoration state or non-dependency intent")
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal("resumed restoration did not complete", err)
	}
	if _, err = os.Lstat(s.path); !os.IsNotExist(err) {
		t.Fatal("completed restoration retained its journal", err)
	}
	if _, err = os.Lstat(filepath.Join(repo, "dist/index.js")); !os.IsNotExist(err) {
		t.Fatal("resumed restoration did not restore the distribution", err)
	}
}
