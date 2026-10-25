package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func restorationBatchFixture(t *testing.T) (devcontract.ResolvedWorkspace, string, scope) {
	t.Helper()
	w, repo := outputFixture(t)
	distribution, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	bindings, err := Prepare(context.Background(), w, repo, Bindings)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(distribution.Directory, "index.js"), "generated distribution\n")
	writeOutput(t, filepath.Join(bindings.Directory, "model.ts"), "generated bindings A\n")
	if err = Publish(context.Background(), distribution, bindings); err != nil {
		t.Fatal(err)
	}
	return w, repo, distribution.s
}

func interruptRestorationAfterBatchIntent(t *testing.T, s scope) {
	t.Helper()
	ctx := context.Background()
	if err := locked(ctx, s, func(j *journal) error {
		observations, err := observeRestorationEntries(ctx, j)
		if err != nil {
			return err
		}
		return prepareRestorationIntents(ctx, s, j, observations)
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRestorationBatchIntentRecoversBeforeAnyStageAllocation(t *testing.T) {
	w, repo, s := restorationBatchFixture(t)
	interruptRestorationAfterBatchIntent(t, s)
	persisted, err := readJournal(s)
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.Restoring || len(persisted.Entries) != 2 {
		t.Fatal("complete restoration intent was not durable")
	}
	for _, entry := range persisted.Entries {
		if entry.Pending == nil {
			t.Fatal("one producer has no durable restoration intent")
		}
		if _, err = os.Lstat(entry.Pending.Directory); !os.IsNotExist(err) {
			t.Fatalf("stage allocated before batch intent checkpoint: %v", err)
		}
		if _, err = os.Lstat(entry.Pending.Backup); !os.IsNotExist(err) {
			t.Fatalf("source renamed before batch intent checkpoint: %v", err)
		}
	}
	original := filepath.Join(repo, "packages/omniviewdev-runtime/src/bindings/model.ts")
	data, err := os.ReadFile(original)
	if err != nil || string(data) != "generated bindings A\n" {
		t.Fatalf("planning changed source: %q %v", data, err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(original)
	if err != nil || string(data) != "export const reviewed = 1;\n" {
		t.Fatalf("restart did not restore committed bindings: %q %v", data, err)
	}
	if _, err = os.Stat(filepath.Join(repo, "dist/index.js")); !os.IsNotExist(err) {
		t.Fatalf("restart retained generated distribution: %v", err)
	}
	if _, err = os.Stat(s.path); !os.IsNotExist(err) {
		t.Fatalf("restart retained restoration journal: %v", err)
	}
}

func TestRestorationBatchRejectsLaterForeignChangesBeforeAnySourceRename(t *testing.T) {
	for _, mutation := range []string{"same-size same-mtime bytes", "unknown addition", "replaced directory", "replaced symlink"} {
		t.Run(mutation, func(t *testing.T) {
			w, repo, s := restorationBatchFixture(t)
			directory := filepath.Join(repo, "packages/omniviewdev-runtime/src/bindings")
			file := filepath.Join(directory, "model.ts")
			if mutation == "same-size same-mtime bytes" {
				stamp := time.Unix(1_700_000_000, 0)
				if err := os.Chtimes(file, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			}
			interruptRestorationAfterBatchIntent(t, s)
			switch mutation {
			case "same-size same-mtime bytes":
				before, err := os.Stat(file)
				if err != nil {
					t.Fatal(err)
				}
				writeOutput(t, file, "generated bindings B\n")
				if err = os.Chtimes(file, before.ModTime(), before.ModTime()); err != nil {
					t.Fatal(err)
				}
				after, err := os.Stat(file)
				if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
					t.Fatalf("mutation fixture did not preserve size and mtime: %v", err)
				}
			case "unknown addition":
				writeOutput(t, filepath.Join(directory, "human.ts"), "do not remove human bytes\n")
			case "replaced directory":
				if err := os.Rename(directory, directory+"-foreign-original"); err != nil {
					t.Fatal(err)
				}
				writeOutput(t, file, "generated bindings A\n")
			case "replaced symlink":
				foreign := filepath.Join(t.TempDir(), "human.ts")
				writeOutput(t, foreign, "foreign target bytes\n")
				if err := os.Remove(file); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(foreign, file); err != nil {
					if runtime.GOOS == "windows" {
						t.Skip("Windows symlink privileges unavailable")
					}
					t.Fatal(err)
				}
			}
			if err := Restore(context.Background(), w); err == nil {
				t.Fatal("foreign changes were admitted from stale planning evidence")
			}
			data, err := os.ReadFile(filepath.Join(repo, "dist/index.js"))
			if err != nil || string(data) != "generated distribution\n" {
				t.Fatalf("earlier source changed before complete refusal: %q %v", data, err)
			}
			persisted, err := readJournal(s)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range persisted.Entries {
				if _, err = os.Lstat(entry.Pending.Backup); !os.IsNotExist(err) {
					t.Fatalf("foreign changes did not fence all source renames: %v", err)
				}
			}
			if mutation == "same-size same-mtime bytes" {
				data, err = os.ReadFile(file)
				if err != nil || string(data) != "generated bindings B\n" {
					t.Fatalf("foreign bytes changed: %q %v", data, err)
				}
			}
		})
	}
}

func TestRestorationBatchRetiresNestedCachesWithoutLosingParentOwnership(t *testing.T) {
	w, repo := outputFixture(t)
	ctx := context.Background()
	installer, err := BeginInstall(ctx, w, repo)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(repo, "node_modules/package/index.js"), strings.Repeat("owned package bytes\n", 128))
	writeOutput(t, filepath.Join(repo, "node_modules/.tmp/cache"), "owned compiler cache\n")
	writeOutput(t, filepath.Join(repo, "node_modules/.vite-temp/config.mjs"), "owned config-loader cache\n")
	if err = installer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	vite, err := BeginVite(ctx, w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = vite.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	interruptRestorationAfterBatchIntent(t, s)
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(repo, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("nested retirement lost parent authority: %v", err)
	}
	if _, err = os.Stat(s.path); !os.IsNotExist(err) {
		t.Fatalf("nested retirement retained journal: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(repo, "packages/omniviewdev-runtime/src/bindings/model.ts"))
	if err != nil || string(data) != "export const reviewed = 1;\n" {
		t.Fatalf("nested cleanup changed unrelated committed source: %q %v", data, err)
	}
}

func TestRestorationBatchObservesCompletedProducerRecovery(t *testing.T) {
	w, repo, _ := restorationBatchFixture(t)
	ctx := context.Background()
	stage, err := Prepare(ctx, w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "recovered producer bytes\n")
	if err = locked(ctx, stage.s, func(j *journal) error {
		entry := j.Entries[stage.key]
		entry.Pending.After, err = snapshotPath(stageSpec(entry), nil)
		if err != nil {
			return err
		}
		container := entry.Spec
		container.Mode, container.Target = "tree", entry.Pending.Directory
		entry.Pending.Container, err = snapshotPath(container, nil)
		if err != nil {
			return err
		}
		entry.Pending.setState(producerCaptured)
		return save(stage.s, j)
	}); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatalf("restoration used pre-recovery before-images: %v", err)
	}
	if _, err = os.Stat(filepath.Join(repo, "dist/index.js")); !os.IsNotExist(err) {
		t.Fatalf("recovered output was not retired: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(repo, "packages/omniviewdev-runtime/src/bindings/model.ts"))
	if err != nil || string(data) != "export const reviewed = 1;\n" {
		t.Fatalf("recovery lost committed bindings: %q %v", data, err)
	}
}
