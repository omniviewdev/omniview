package devoutputs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

func compositionFixture(t *testing.T) (devcontract.ResolvedWorkspace, devcompose.Plan, string) {
	t.Helper()
	w, repo := outputFixture(t)
	writeOutput(t, filepath.Join(repo, "package.json"), `{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0"}`)
	writeOutput(t, filepath.Join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n")
	writeOutput(t, filepath.Join(repo, "packages/consumer/package.json"), `{"name":"consumer","private":true,"version":"1.0.0"}`)
	outputGit(t, repo, "add", ".")
	outputCommit(t, repo, "composition inputs")
	w.Manifest.SchemaVersion = devcontract.SchemaVersion
	w.Manifest.Slug = "feature"
	w.Manifest.DisplayName = "Feature"
	w.Manifest.Profile.Kind = "development"
	w.Manifest.Ports.Policy = "sticky"
	w.Manifest.Repositories[0].BaseRef = "HEAD"
	w.Manifest.Repositories[0].BaseCommit = outputGit(t, repo, "rev-parse", "HEAD")
	w.Manifest.Repositories[0].Branch = "feature"
	raw, err := json.Marshal(w.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, w.ManifestPath, string(raw))
	p, err := devcompose.New(w, []devcompose.Root{{Path: repo, Version: devcompose.Version}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return w, p, filepath.Join(repo, "packages/consumer")
}

func TestCompositionInstallOwnsAggregateAndEveryActualPackage(t *testing.T) {
	ctx := context.Background()
	w, p, consumer := compositionFixture(t)
	manifest := filepath.Join(consumer, "package.json")
	before, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(w.Root, "node_modules/.pnpm/immutable/index.js")
	writeOutput(t, store, "shared immutable package")
	foreign := filepath.Join(t.TempDir(), "external.js")
	writeOutput(t, foreign, "foreign target")
	for _, pkg := range p.Packages {
		modules := filepath.Join(pkg.Path, "node_modules")
		if info, e := os.Stat(modules); e != nil || !info.IsDir() {
			t.Fatalf("actual package was not allocated before producer start: %s: %v", pkg.Path, e)
		}
		if e := os.Symlink(foreign, filepath.Join(modules, "foreign-alias")); e != nil {
			t.Skipf("symlink unavailable: %v", e)
		}
	}
	if err = Restore(ctx, w); err == nil {
		t.Fatal("restoration accepted a live aggregate producer")
	}
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	first, err := BeginVite(ctx, w, consumer)
	if err != nil {
		t.Fatal(err)
	}
	incomplete := filepath.Join(consumer, "node_modules/.vite-temp/chunk.mjs")
	if err = os.Symlink(filepath.Join(consumer, "not-produced-yet"), incomplete); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	second, err := BeginVite(ctx, w, consumer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = BeginCompositionInstall(ctx, w, p); err == nil {
		t.Fatal("installer overlapped actual consumer cache writers")
	}
	if err = first.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = second.Finish(ctx); err == nil {
		t.Fatal("last writer did not validate completed cache payload")
	}
	if err = os.Remove(incomplete); err != nil {
		t.Fatal(err)
	}
	writeOutput(t, incomplete, "loader output")
	if err = second.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
	for _, path := range append([]string{w.Root}, packagePaths(p)...) {
		if _, err = os.Lstat(filepath.Join(path, "node_modules")); !os.IsNotExist(err) {
			t.Fatalf("owned modules not retired: %s: %v", path, err)
		}
	}
	after, err := os.ReadFile(manifest)
	if err != nil || string(after) != string(before) {
		t.Fatalf("source manifest changed: %v", err)
	}
	data, err := os.ReadFile(foreign)
	if err != nil || string(data) != "foreign target" {
		t.Fatalf("module alias target was traversed: %v", err)
	}
	if _, err = os.Stat(filepath.Join(w.Root, ".git")); !os.IsNotExist(err) {
		t.Fatalf("aggregate root was treated as a Git repository: %v", err)
	}
}

func TestCompositionCannotReplaceStoreWhileDeselectedConsumerRetainsWriter(t *testing.T) {
	ctx := context.Background()
	w, plan, consumer := compositionFixture(t)
	install, err := BeginCompositionInstall(ctx, w, plan)
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(w.Root, "node_modules/.pnpm/immutable/index.js")
	writeOutput(t, store, "original shared store")
	for _, pkg := range plan.Packages {
		writeOutput(t, filepath.Join(pkg.Path, "node_modules/installed"), "package modules")
	}
	if err = install.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	vite, err := BeginVite(ctx, w, consumer)
	if err != nil {
		t.Fatal(err)
	}
	repo := plan.Roots[0].Path
	nextPackage := filepath.Join(repo, "packages/next")
	writeOutput(t, filepath.Join(nextPackage, "package.json"), `{"name":"next","private":true,"version":"1.0.0"}`)
	writeOutput(t, filepath.Join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - '!packages/consumer'\n")
	next, err := devcompose.New(w, plan.Roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Admission opens the persisted journal afresh: an excluded package's writer
	// cannot disappear merely because the replacement plan no longer selects it.
	if _, err = BeginCompositionInstall(ctx, w, next); err == nil {
		t.Fatal("replacement installer ignored deselected consumer lifetime")
	}
	if _, err = os.Lstat(filepath.Join(nextPackage, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("refused installer allocated a new package output: %v", err)
	}
	if data, e := os.ReadFile(store); e != nil || string(data) != "original shared store" {
		t.Fatalf("refused installer changed the shared store: %v", e)
	}
	if err = vite.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	replacement, err := BeginCompositionInstall(ctx, w, next)
	if err != nil {
		t.Fatal(err)
	}
	if err = replacement.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(nextPackage, "package.json")); err != nil {
		t.Fatalf("restoration removed the user's source addition: %v", err)
	}
}

func packagePaths(p devcompose.Plan) []string {
	paths := make([]string, 0, len(p.Packages))
	for _, pkg := range p.Packages {
		paths = append(paths, pkg.Path)
	}
	return paths
}

func TestCompositionInstallPreflightsAllScopesBeforeAllocation(t *testing.T) {
	for _, boundary := range []string{"aggregate", "package", "redirect"} {
		t.Run(boundary, func(t *testing.T) {
			w, p, consumer := compositionFixture(t)
			unknown := filepath.Join(consumer, "node_modules")
			if boundary == "aggregate" {
				unknown = filepath.Join(w.Root, "node_modules")
			}
			if boundary == "redirect" {
				foreign := t.TempDir()
				writeOutput(t, filepath.Join(foreign, "canary"), "not owned")
				if err := os.Symlink(foreign, unknown); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			} else {
				writeOutput(t, filepath.Join(unknown, "canary"), "not owned")
			}
			if _, err := BeginCompositionInstall(context.Background(), w, p); err == nil {
				t.Fatal("unowned module boundary was adopted")
			}
			for _, path := range append([]string{w.Root}, packagePaths(p)...) {
				modules := filepath.Join(path, "node_modules")
				if modules == unknown {
					continue
				}
				if _, err := os.Lstat(modules); !os.IsNotExist(err) {
					t.Fatalf("partial allocation preceded full preflight: %s: %v", modules, err)
				}
			}
			data, err := os.ReadFile(filepath.Join(unknown, "canary"))
			if err != nil || string(data) != "not owned" {
				t.Fatalf("foreign bytes changed: %v", err)
			}
		})
	}
}

func TestCompositionRetainsInterruptedWriterAndRefusesReplacedFeatureRoot(t *testing.T) {
	ctx := context.Background()
	w, p, _ := compositionFixture(t)
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(w.Root, "node_modules/.modules.yaml"), "partial producer metadata")
	// A fresh scope has no in-memory producer object: persisted intent alone must
	// refuse both recovery and a replacement install until terminal completion.
	if err = Validate(ctx, w); err == nil {
		t.Fatal("interrupted producer was inferred stopped")
	}
	if _, err = BeginCompositionInstall(ctx, w, p); err == nil {
		t.Fatal("interrupted producer was superseded")
	}
	retained := w.Root + "-retained"
	if err = os.Rename(w.Root, retained); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(w.Root, 0700); err != nil {
		t.Fatal(err)
	}
	// Preserve exact selected repository identities, isolating aggregate-root
	// identity from the existing repository identity guards.
	for _, repo := range w.Manifest.Repositories {
		if err = os.Rename(filepath.Join(retained, repo.Directory), filepath.Join(w.Root, repo.Directory)); err != nil {
			t.Fatal(err)
		}
	}
	writeOutput(t, filepath.Join(w.Root, "foreign"), "replacement root")
	if err = writer.Finish(ctx); err == nil {
		t.Fatal("terminal receipt accepted replaced feature root")
	}
	if err = Restore(ctx, w); err == nil {
		t.Fatal("restore accepted replaced feature root")
	}
	data, err := os.ReadFile(filepath.Join(w.Root, "foreign"))
	if err != nil || string(data) != "replacement root" {
		t.Fatalf("replacement root changed: %v", err)
	}
	for _, repo := range w.Manifest.Repositories {
		if err = os.Rename(filepath.Join(w.Root, repo.Directory), filepath.Join(retained, repo.Directory)); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.Remove(filepath.Join(w.Root, "foreign")); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(w.Root); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(retained, w.Root); err != nil {
		t.Fatal(err)
	}
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
}

func TestCompositionStoreIsNotConsumerWritableCache(t *testing.T) {
	ctx := context.Background()
	w, p, consumer := compositionFixture(t)
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(w.Root, "node_modules/.pnpm/package/index.js")
	writeOutput(t, store, "installed immutable package")
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	writeOutput(t, store, "foreign modification")
	if _, err = BeginVite(ctx, w, consumer); err == nil {
		t.Fatal("Vite accepted tampered aggregate immutable store")
	}
	if err = Restore(ctx, w); err == nil {
		t.Fatal("restore removed modified aggregate store")
	}
	data, err := os.ReadFile(store)
	if err != nil || string(data) != "foreign modification" {
		t.Fatalf("foreign store edit changed: %v", err)
	}
}

func TestCompositionRefusesForeignRootAndPublicJournal(t *testing.T) {
	w, p, _ := compositionFixture(t)
	foreign := t.TempDir()
	p.Root = foreign
	if _, err := BeginCompositionInstall(context.Background(), w, p); err == nil {
		t.Fatal("arbitrary aggregate root was accepted")
	}
	if entries, err := os.ReadDir(foreign); err != nil || len(entries) != 0 {
		t.Fatalf("foreign root changed: %v", err)
	}
	if runtime.GOOS == "windows" {
		return
	}
	p, err := devcompose.New(w, []devcompose.Root{{Path: filepath.Join(w.Root, "host"), Version: devcompose.Version}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(s.directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(s.directory, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = BeginCompositionInstall(context.Background(), w, p); err == nil {
		t.Fatal("public journal boundary was repaired/adopted")
	}
	info, err := os.Stat(s.directory)
	if err != nil || info.Mode().Perm() != 0755 {
		t.Fatalf("foreign journal permissions changed: %v", err)
	}
	if _, err = os.Lstat(filepath.Join(w.Root, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("modules appeared before private-journal validation: %v", err)
	}
}

func TestCompositionInterruptedRemovalResumesExactAggregateBackup(t *testing.T) {
	ctx := context.Background()
	w, p, _ := compositionFixture(t)
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(w.Root, "node_modules/.pnpm/owned.js"), "owned package")
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	err = locked(ctx, s, func(j *journal) error {
		spec, e := s.spec(w.Root, modules)
		if e != nil {
			return e
		}
		entry := j.Entries[keyOf(spec)]
		j.Restoring = true
		if e = allocateRemoval(s, j, entry, "", entry.Expected); e != nil {
			return e
		}
		// Simulate death after the source rename, before phase publication.
		return os.Rename(spec.Target, entry.Pending.Backup)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Lstat(filepath.Join(w.Root, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("interrupted aggregate removal did not complete: %v", err)
	}
	entries, err := os.ReadDir(w.Root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "host" && entry.Name() != "workspace.json" {
			t.Fatalf("interrupted aggregate backup/stage stranded: %s", entry.Name())
		}
	}
}

func TestCompositionCannotBeReinstalledThroughPerRepositoryAuthority(t *testing.T) {
	ctx := context.Background()
	w, p, _ := compositionFixture(t)
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = BeginInstall(ctx, w, filepath.Join(w.Root, "host")); err == nil {
		t.Fatal("per-repository installer bypassed aggregate ownership")
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
}

func TestCompositionSourceEditDuringInstallIsRetainedAndReported(t *testing.T) {
	ctx := context.Background()
	w, p, consumer := compositionFixture(t)
	writer, err := BeginCompositionInstall(ctx, w, p)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(consumer, "package.json")
	writeOutput(t, path, `{"name":"consumer","private":true,"version":"2.0.0"}`)
	writeOutput(t, filepath.Join(w.Root, "node_modules/.modules.yaml"), "completed producer output")
	if err = writer.Finish(ctx); err == nil {
		t.Fatal("installer accepted concurrent package source change")
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != `{"name":"consumer","private":true,"version":"2.0.0"}` {
		t.Fatalf("source edit was undone: %v", err)
	}
	if _, err = BeginCompositionInstall(ctx, w, p); err == nil {
		t.Fatal("stale composition inputs were accepted for reinstall")
	}
}
