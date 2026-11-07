package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestInspectionAggregatesMixedUnownedBoundaryKinds(t *testing.T) {
	w, repo := outputFixture(t)
	nested := filepath.Join(repo, "packages/omniviewdev-vite-plugin")
	writeOutput(t, filepath.Join(w.Root, "node_modules"), "aggregate root is a file")
	foreign := t.TempDir()
	writeOutput(t, filepath.Join(foreign, "private.txt"), "foreign bytes")
	if err := os.Symlink(foreign, filepath.Join(repo, "node_modules")); err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(nested, "node_modules/private.txt"), "standalone bytes")
	if err := os.Rename(filepath.Join(repo, "dist"), filepath.Join(repo, "dist-baseline")); err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(repo, "dist"), "distribution root is a file")
	worker := filepath.Join(repo, "ui/providers/monaco/yaml.worker.bundle.js")
	if err := os.Rename(worker, worker+"-baseline"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(foreign, "private.txt"), worker); err != nil {
		t.Fatal(err)
	}
	requests := []Request{{Consumer: repo, Producer: YAMLWorker}, ModuleRequest(nested), {Consumer: repo, Producer: Distribution}, ModuleRequest(repo), ModuleRequest(w.Root)}
	report, err := Inspect(context.Background(), w, requests)
	if err != nil {
		t.Fatal("one bad boundary aborted the aggregate plan", err)
	}
	if report.Ready || len(report.Entries) != len(requests) {
		t.Fatalf("incomplete aggregate report: %+v", report)
	}
	keys := make([]string, 0, len(report.Entries))
	for _, entry := range report.Entries {
		if entry.Conflict == nil || entry.Conflict.Target != entry.Target || entry.Conflict.Consumer != entry.Consumer || entry.Conflict.Ownership != "unowned" || len(entry.Conflict.ChangedPaths) == 0 {
			t.Fatalf("missing per-boundary identity: %+v", entry)
		}
		keys = append(keys, entry.Target+"|"+string(entry.Producer))
	}
	if !sort.StringsAreSorted(keys) {
		t.Fatal("aggregate order is unstable", keys)
	}
	if _, err = os.Lstat(report.MetadataDirectory); !os.IsNotExist(err) {
		t.Fatal("inspection created metadata", err)
	}
	raw, err := os.ReadFile(filepath.Join(foreign, "private.txt"))
	if err != nil || string(raw) != "foreign bytes" {
		t.Fatal("foreign bytes changed", err)
	}
	raw, err = os.ReadFile(filepath.Join(nested, "node_modules/private.txt"))
	if err != nil || string(raw) != "standalone bytes" {
		t.Fatal("standalone bytes changed", err)
	}
}

func TestInspectionAggregatesRecordedRootSubstitutionWithoutWeakeningAdmission(t *testing.T) {
	for _, kind := range []string{"file", "link"} {
		t.Run(kind, func(t *testing.T) {
			w, repo := outputFixture(t)
			ctx := context.Background()
			install, err := BeginInstall(ctx, w, repo)
			if err != nil {
				t.Fatal(err)
			}
			writeOutput(t, filepath.Join(repo, "node_modules/dependency.js"), "controlled")
			if err = install.Finish(ctx); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(repo, "node_modules")
			if err = os.Rename(target, target+"-before"); err != nil {
				t.Fatal(err)
			}
			if kind == "file" {
				writeOutput(t, target, "unknown replacement")
			} else {
				if err = os.Symlink(t.TempDir(), target); err != nil {
					t.Fatal(err)
				}
			}
			report, err := Inspect(ctx, w, []Request{{Consumer: repo, Producer: Distribution}})
			if err != nil || report.Ready || len(report.Entries) != 2 {
				t.Fatalf("recorded substitution aborted report: %+v %v", report, err)
			}
			conflicts := 0
			for _, entry := range report.Entries {
				if entry.Conflict != nil {
					conflicts++
					if entry.Target != target || entry.Ownership != "owned" {
						t.Fatalf("wrong boundary: %+v", entry)
					}
				}
			}
			if conflicts != 1 {
				t.Fatalf("conflicts=%d", conflicts)
			}
			if _, err = BeginInstall(ctx, w, repo); err == nil {
				t.Fatal("inspection weakened writer admission")
			}
		})
	}
}

func TestInspectionDoesNotTurnIOFailuresIntoDrift(t *testing.T) {
	err := &os.PathError{Op: "read", Path: "selected/output", Err: os.ErrPermission}
	if inspectionBoundaryConflict(err) {
		t.Fatal("I/O failure became drift")
	}
	wrapped := conflict(specification{Target: "selected/output"}, "owned", "observation", nil, nil, err)
	if inspectionBoundaryConflict(wrapped) {
		t.Fatal("wrapped I/O failure became drift")
	}
	if inspectionBoundaryConflict(context.Canceled) || inspectionBoundaryConflict(context.DeadlineExceeded) {
		t.Fatal("cancellation became drift")
	}
	var original *os.PathError
	if !errors.As(wrapped, &original) {
		t.Fatal("I/O cause was lost")
	}
}

func TestSnapshotRejectsReplacementWithMatchingMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "output")
	writeOutput(t, path, "original")
	observed, err := observeSnapshotPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(path, path+"-before"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("replaced"), observed.Mode().Perm()); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, observed.ModTime(), observed.ModTime()); err != nil {
		t.Fatal(err)
	}
	var reader snapshotReader
	_, err = reader.item(path, observed, false)
	var substitution *pathConflict
	if !errors.As(err, &substitution) || substitution.ExpectedKind != "file" || substitution.ActualKind != "file" || reader.digest != nil {
		t.Fatalf("matching metadata hid a substituted file identity: %v", err)
	}
}
