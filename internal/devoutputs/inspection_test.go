package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestInspectionEnumeratesUnownedRootsWithoutCreatingMetadata(t *testing.T) {
	w, repo := outputFixture(t)
	nested := filepath.Join(repo, "packages/omniviewdev-vite-plugin")
	roots := []string{w.Root, repo, nested}
	var requests []Request
	for _, root := range roots {
		writeOutput(t, filepath.Join(root, "node_modules/private.txt"), "preserve")
		requests = append(requests, ModuleRequest(root))
	}
	requests = append(requests, Request{Consumer: repo, Producer: Distribution})
	report, err := Inspect(context.Background(), w, requests)
	if err != nil {
		t.Fatal(err)
	}
	if report.Ready || len(report.Entries) != 4 {
		t.Fatalf("incomplete report: %+v", report)
	}
	conflicts := 0
	for _, entry := range report.Entries {
		if entry.Producer == modules {
			if entry.Conflict == nil || entry.Conflict.Ownership != "unowned" || len(entry.Conflict.ChangedPaths) == 0 {
				t.Fatalf("missing root: %+v", entry)
			}
			conflicts++
		} else if entry.Conflict != nil {
			t.Fatalf("tracked placeholder rejected: %+v", entry)
		}
	}
	if conflicts != 3 {
		t.Fatal(conflicts)
	}
	if _, err = os.Lstat(report.MetadataDirectory); !os.IsNotExist(err) {
		t.Fatalf("inspection created metadata: %v", err)
	}
	for _, root := range roots {
		raw, err := os.ReadFile(filepath.Join(root, "node_modules/private.txt"))
		if err != nil || string(raw) != "preserve" {
			t.Fatal("unowned bytes changed")
		}
	}
}

func TestInspectionReportsAllDriftAndLaunchRechecksAfterInspection(t *testing.T) {
	w, repo := outputFixture(t)
	ctx := context.Background()
	install, err := BeginInstall(ctx, w, repo)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(repo, "node_modules/dependency.js"), "immutable")
	if err = install.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	writer, err := BeginVite(ctx, w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	before, err := Inspect(ctx, w, nil)
	if err != nil || !before.Ready {
		t.Fatalf("%+v %v", before, err)
	}
	s, _ := newScope(w)
	for _, kind := range []Producer{loaderCache, typeCache, viteCache} {
		spec, _ := s.spec(repo, kind)
		writeOutput(t, filepath.Join(spec.Target, "added.tsbuildinfo"), "tool cache")
	}
	writeOutput(t, filepath.Join(repo, "node_modules/dependency.js"), "foreign")
	journalBefore, _ := os.ReadFile(s.path)
	report, err := Inspect(ctx, w, nil)
	if err != nil || report.Ready {
		t.Fatalf("%+v %v", report, err)
	}
	if len(report.Entries) != 4 {
		t.Fatalf("all module roots and caches must be inspected: %d", len(report.Entries))
	}
	count := 0
	for _, e := range report.Entries {
		if e.Conflict != nil {
			count++
		}
	}
	if count != 4 {
		t.Fatalf("drift conflicts %d", count)
	}
	journalAfter, _ := os.ReadFile(s.path)
	if string(journalBefore) != string(journalAfter) {
		t.Fatal("read-only inspection changed journal")
	}
	_, err = BeginVite(ctx, w, repo)
	var conflict *Conflict
	if !errors.As(err, &conflict) || conflict.Target != filepath.Join(repo, "node_modules") || conflict.Producer != modules {
		t.Fatalf("launch bypassed fresh guard: %v", err)
	}
}

func TestReconcilePreservesForeignBindingsAndRestoresCommittedBaseline(t *testing.T) {
	for _, kind := range []Producer{Bindings, YAMLWorker, Distribution} {
		t.Run(string(kind), func(t *testing.T) {
			w, repo := outputFixture(t)
			ctx := context.Background()
			stage, err := Prepare(ctx, w, repo, kind)
			if err != nil {
				t.Fatal(err)
			}
			if kind == YAMLWorker {
				writeOutput(t, filepath.Join(stage.Directory, "yaml.worker.bundle.js"), "managed")
			} else {
				writeOutput(t, filepath.Join(stage.Directory, "generated.ts"), "managed")
			}
			if err = Publish(ctx, stage); err != nil {
				t.Fatal(err)
			}
			s, _ := newScope(w)
			spec, _ := s.spec(repo, kind)
			if kind == Bindings {
				if err = os.Rename(spec.Target, spec.Target+".standalone-before"); err != nil {
					t.Fatal(err)
				}
			}
			changed := spec.Target
			if kind != YAMLWorker {
				changed = filepath.Join(changed, "foreign.txt")
			}
			writeOutput(t, changed, "private bytes")
			preservationRoot, _ := filepath.EvalSymlinks(t.TempDir())
			if err = os.Chmod(preservationRoot, 0700); err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(preservationRoot, "preserved")
			report, err := Reconcile(ctx, w, repo, string(kind), destination)
			if err != nil || !report.RestoredBaseline {
				t.Fatalf("%+v %v", report, err)
			}
			saved := destination
			if kind != YAMLWorker {
				saved = filepath.Join(saved, "foreign.txt")
			}
			raw, err := os.ReadFile(saved)
			if err != nil || string(raw) != "private bytes" {
				t.Fatal("foreign bytes not preserved", err)
			}
			next, err := Prepare(ctx, w, repo, kind)
			if err != nil {
				t.Fatal("reconciled baseline not admitted", err)
			}
			if err = next.Abort(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReconcileNeverOverwritesForeignPreservationDestination(t *testing.T) {
	w, repo := outputFixture(t)
	ctx := context.Background()
	stage, err := Prepare(ctx, w, repo, Bindings)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "generated.ts"), "managed")
	if err = Publish(ctx, stage); err != nil {
		t.Fatal(err)
	}
	root, _ := filepath.EvalSymlinks(t.TempDir())
	_ = os.Chmod(root, 0700)
	occupied := filepath.Join(root, "saved")
	writeOutput(t, occupied, "foreign")
	if _, err = Reconcile(ctx, w, repo, string(Bindings), occupied); err == nil {
		t.Fatal("occupied destination accepted")
	}
	raw, _ := os.ReadFile(occupied)
	if string(raw) != "foreign" {
		t.Fatal("destination overwritten")
	}
}

func TestInterruptedPreservationRetainsAuthorityAndResumesExactMove(t *testing.T) {
	for _, afterMove := range []bool{false, true} {
		t.Run(map[bool]string{false: "intent", true: "renamed"}[afterMove], func(t *testing.T) {
			w, repo := outputFixture(t)
			ctx := context.Background()
			stage, err := Prepare(ctx, w, repo, Bindings)
			if err != nil {
				t.Fatal(err)
			}
			writeOutput(t, filepath.Join(stage.Directory, "generated.ts"), "managed")
			if err = Publish(ctx, stage); err != nil {
				t.Fatal(err)
			}
			s, _ := newScope(w)
			spec, _ := s.spec(repo, Bindings)
			root, _ := filepath.EvalSymlinks(t.TempDir())
			if err = os.Chmod(root, 0700); err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(root, "preserved")
			sourceParentIdentity, err := directoryIdentity(filepath.Dir(spec.Target))
			if err != nil {
				t.Fatal(err)
			}
			destinationParentIdentity, err := directoryIdentity(root)
			if err != nil {
				t.Fatal(err)
			}
			err = locked(ctx, s, func(j *journal) error {
				entry := j.Entries[keyOf(spec)]
				actual, e := snapshotPath(spec, nil)
				if e != nil {
					return e
				}
				identity, e := directoryIdentity(root)
				if e != nil {
					return e
				}
				revision, e := head(ctx, spec.Repository)
				if e != nil {
					return e
				}
				entry.Preservation = &preservation{Path: destination, ParentIdentity: identity, SourceParentIdentity: sourceParentIdentity, Before: actual, Head: revision}
				return save(s, j)
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = Published(ctx, w, repo, Bindings); err == nil {
				t.Fatal("preservation intent reused as a publication")
			}
			if afterMove {
				if err = preserveRename(spec.Target, destination, sourceParentIdentity, destinationParentIdentity); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = Reconcile(ctx, w, repo, string(Bindings), destination+"-wrong"); err == nil {
				t.Fatal("different preservation path accepted")
			}
			report, err := Reconcile(ctx, w, repo, string(Bindings), destination)
			if err != nil || !report.RestoredBaseline {
				t.Fatalf("%+v %v", report, err)
			}
			raw, err := os.ReadFile(filepath.Join(destination, "generated.ts"))
			if err != nil || string(raw) != "managed" {
				t.Fatal("preserved bytes lost", err)
			}
			next, err := Prepare(ctx, w, repo, Bindings)
			if err != nil {
				t.Fatal(err)
			}
			if err = next.Abort(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReadOnlyInspectionRefusesRedirectedJournal(t *testing.T) {
	w, _ := outputFixture(t)
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(s.directory, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(t.TempDir(), "foreign.json")
	if err = os.WriteFile(foreign, []byte("private foreign payload"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(foreign, s.path); err != nil {
		t.Fatal(err)
	}
	if _, err = Inspect(context.Background(), w, nil); err == nil {
		t.Fatal("redirected journal accepted")
	}
	raw, err := os.ReadFile(foreign)
	if err != nil || string(raw) != "private foreign payload" {
		t.Fatal("foreign journal was changed", err)
	}
	if target, err := os.Readlink(s.path); err != nil || target != foreign {
		t.Fatal("inspection changed journal redirect", err)
	}
}
