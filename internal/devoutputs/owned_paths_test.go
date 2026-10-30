package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestValidatedOwnedPathsDoesNotCreateAuthorityForUnknownTree(t *testing.T) {
	w, repo := outputFixture(t)
	writeOutput(t, filepath.Join(repo, "node_modules", "foreign.js"), "foreign")
	outputScope, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	paths, err := ValidatedOwnedPaths(context.Background(), w)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 0 {
		t.Fatal("adopted unknown output")
	}
	if _, err = os.Lstat(outputScope.directory); !os.IsNotExist(err) {
		t.Fatalf("check created authority: %v", err)
	}
}

func TestValidatedOwnedPathsRejectsChangedPublishedBytes(t *testing.T) {
	w, repo := outputFixture(t)
	stage, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "owned")
	if err = Publish(context.Background(), stage); err != nil {
		t.Fatal(err)
	}
	paths, err := ValidatedOwnedPaths(context.Background(), w)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, path := range paths {
		if path == filepath.Join(repo, "dist") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing proven distribution: %v", paths)
	}
	writeOutput(t, filepath.Join(repo, "dist", "foreign.js"), "authored")
	if _, err = ValidatedOwnedPaths(context.Background(), w); err == nil {
		t.Fatal("accepted externally changed distribution")
	}
	raw, err := os.ReadFile(filepath.Join(repo, "dist", "foreign.js"))
	if err != nil || string(raw) != "authored" {
		t.Fatalf("lost authored bytes: %v", err)
	}
}

func TestValidatedOwnedPathsObservesLiveCachesWithoutGrantingRetirement(t *testing.T) {
	w, repo := outputFixture(t)
	ctx := context.Background()
	install, err := BeginInstall(ctx, w, repo)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(repo, "node_modules/package/index.js"), "immutable installed bytes")
	if _, err = ValidatedOwnedPaths(ctx, w); err == nil {
		t.Fatal("active installer accepted")
	}
	if err = install.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	vite, err := BeginVite(ctx, w, repo)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if finishErr := vite.Finish(ctx); finishErr != nil {
			t.Errorf("finish Vite ownership: %v", finishErr)
		}
	}()
	if _, err = ValidatedOwnedPaths(ctx, w); err != nil {
		t.Fatalf("read-only live cache observation failed: %v", err)
	}
	if err = Validate(ctx, w); err == nil {
		t.Fatal("live observation granted stopped output authority")
	}
	writeOutput(t, filepath.Join(repo, "node_modules/package/foreign.js"), "external modification")
	if _, err = ValidatedOwnedPaths(ctx, w); err == nil {
		t.Fatal("live cache exemption hid immutable modules edit")
	}
}
