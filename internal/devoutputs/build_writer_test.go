package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

func finiteBuildFixture(t *testing.T) (devcontract.ResolvedWorkspace, devcompose.Plan, []string, string) {
	t.Helper()
	w, plan, consumer := compositionFixture(t)
	install, err := BeginCompositionInstall(context.Background(), w, plan)
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(w.Root, "node_modules/.pnpm/immutable/index.js")
	writeOutput(t, store, "original")
	for _, pkg := range plan.Packages {
		writeOutput(t, filepath.Join(pkg.Path, "node_modules/dependency.js"), "dependency")
	}
	if err = install.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	return w, plan, []string{filepath.Join(w.Root, "host"), consumer}, store
}

func TestFiniteViteBuildReservesEveryConsumerUntilCompletion(t *testing.T) {
	ctx := context.Background()
	w, plan, consumers, store := finiteBuildFixture(t)
	build, err := BeginViteBuild(ctx, w, plan, consumers)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, consumer := range consumers {
		environment, err := build.Environment(ctx, consumer)
		if err != nil {
			t.Fatal(err)
		}
		cache, ok := strings.CutPrefix(environment, "OMNIVIEW_VITE_CACHE_DIRECTORY=")
		if !ok || !filepath.IsAbs(cache) || seen[cache] {
			t.Fatalf("consumer lacks its own actual cache: %q", environment)
		}
		seen[cache] = true
		writeOutput(t, filepath.Join(cache, "compiled.js"), "actual writer payload")
		if _, err = BeginInstall(ctx, w, consumer); err == nil {
			t.Fatal("installer overlapped the finite build")
		}
	}
	if _, err = BeginCompositionInstall(ctx, w, plan); err == nil {
		t.Fatal("aggregate installer overlapped the finite build")
	}
	if _, err = BeginVite(ctx, w, consumers[0]); err == nil {
		t.Fatal("another writer entered the reserved build")
	}
	if err = Restore(ctx, w); err == nil {
		t.Fatal("restoration crossed an actual build lifetime")
	}
	if err = build.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = build.Environment(ctx, consumers[0]); err == nil {
		t.Fatal("finished capability authorized another producer")
	}
	raw, err := os.ReadFile(store)
	if err != nil || string(raw) != "original" {
		t.Fatal("immutable store changed", err)
	}
	install, err := BeginCompositionInstall(ctx, w, plan)
	if err != nil {
		t.Fatal("completed build retained an installation reservation", err)
	}
	if err = install.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, w); err != nil {
		t.Fatal(err)
	}
}

func TestFiniteViteBuildRejectsInvalidConsumersBeforeReservation(t *testing.T) {
	for _, kind := range []string{"empty", "duplicate", "relative", "escaping", "unselected", "redirected"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumers, store := finiteBuildFixture(t)
			foreign := t.TempDir()
			writeOutput(t, filepath.Join(foreign, "sentinel"), "foreign")
			switch kind {
			case "empty":
				consumers = nil
			case "duplicate":
				consumers = []string{consumers[0], consumers[0]}
			case "relative":
				consumers = []string{"host"}
			case "escaping":
				consumers = []string{foreign}
			case "unselected":
				path := filepath.Join(w.Root, "host/unselected")
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
				consumers = []string{path}
			case "redirected":
				alias := filepath.Join(w.Root, "alias")
				if err := os.Symlink(consumers[0], alias); err != nil {
					t.Fatal(err)
				}
				consumers = []string{alias}
			}
			if _, err := BeginViteBuild(ctx, w, plan, consumers); err == nil {
				t.Fatal("invalid consumer admitted")
			}
			raw, err := os.ReadFile(store)
			if err != nil || string(raw) != "original" {
				t.Fatal("refusal changed immutable bytes", err)
			}
			raw, err = os.ReadFile(filepath.Join(foreign, "sentinel"))
			if err != nil || string(raw) != "foreign" {
				t.Fatal("refusal changed foreign data", err)
			}
			install, err := BeginCompositionInstall(ctx, w, plan)
			if err != nil {
				t.Fatal("invalid admission leaked a reservation", err)
			}
			if err = install.Finish(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestFiniteViteBuildNeverAdoptsTamperedImmutableBytes(t *testing.T) {
	for _, when := range []string{"admission", "completion"} {
		t.Run(when, func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumers, store := finiteBuildFixture(t)
			before, err := os.Stat(store)
			if err != nil {
				t.Fatal(err)
			}
			var build *ViteBuild
			if when == "completion" {
				build, err = BeginViteBuild(ctx, w, plan, consumers)
				if err != nil {
					t.Fatal(err)
				}
			}
			writeOutput(t, store, "tampered")
			if err = os.Chtimes(store, before.ModTime(), before.ModTime()); err != nil {
				t.Fatal(err)
			}
			if when == "admission" {
				if _, err = BeginViteBuild(ctx, w, plan, consumers); err == nil {
					t.Fatal("same-size, same-mtime aggregate tamper admitted")
				}
			} else if err = build.Finish(ctx); err == nil {
				t.Fatal("completion adopted changed aggregate bytes")
			}
			if err = Restore(ctx, w); err == nil {
				t.Fatal("tampered aggregate was removed")
			}
			raw, err := os.ReadFile(store)
			if err != nil || string(raw) != "tampered" {
				t.Fatal("tampered bytes were changed", err)
			}
		})
	}
}

func TestFiniteViteBuildChecksConsumerModulesAndInputsBeforeEachProducer(t *testing.T) {
	for _, kind := range []string{"modules", "input", "input-set"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumers, _ := finiteBuildFixture(t)
			build, err := BeginViteBuild(ctx, w, plan, consumers)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = build.Environment(ctx, consumers[0]); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(consumers[1], "node_modules/dependency.js")
			if kind == "input" {
				path = filepath.Join(consumers[1], "package.json")
			}
			content := "foreign edit"
			if kind == "input-set" {
				path = filepath.Join(consumers[0], "packages/new/package.json")
				content = `{"name":"new-consumer","private":true,"version":"1.0.0"}`
			}
			writeOutput(t, path, content)
			if _, err = build.Environment(ctx, consumers[1]); err == nil {
				t.Fatal("later producer used changed modules/inputs")
			}
			if err = build.Finish(ctx); err == nil {
				t.Fatal("completion accepted the changed transaction")
			}
			if err = Restore(ctx, w); err == nil {
				t.Fatal("failed build released unproven ownership")
			}
		})
	}
}

func TestFiniteViteBuildRefusesEachReplacedConsumerCacheBeforeProducer(t *testing.T) {
	for _, kind := range []Producer{loaderCache, typeCache, viteCache, loaderFiles} {
		t.Run(string(kind), func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumers, _ := finiteBuildFixture(t)
			build, err := BeginViteBuild(ctx, w, plan, consumers)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = build.Environment(ctx, consumers[0]); err != nil {
				t.Fatal(err)
			}
			consumer := consumers[1]
			target := consumer
			switch kind {
			case loaderCache:
				target = filepath.Join(consumer, "node_modules/.vite-temp")
			case typeCache:
				target = filepath.Join(consumer, "node_modules/.tmp")
			case viteCache:
				environment, err := build.Environment(ctx, consumer)
				if err != nil {
					t.Fatal(err)
				}
				var ok bool
				target, ok = strings.CutPrefix(environment, "OMNIVIEW_VITE_CACHE_DIRECTORY=")
				if !ok {
					t.Fatal("consumer lacks its actual optimizer cache")
				}
			}
			original, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			retained := filepath.Join(t.TempDir(), "original-root")
			if err = os.Rename(target, retained); err != nil {
				t.Fatal(err)
			}
			if err = os.Mkdir(target, original.Mode().Perm()); err != nil {
				t.Fatal(err)
			}
			if kind == loaderFiles {
				// Keep every module/input inode and byte unchanged: only the
				// consumer's independently reserved loader root is replaced.
				children, err := os.ReadDir(retained)
				if err != nil {
					t.Fatal(err)
				}
				for _, child := range children {
					if err = os.Rename(filepath.Join(retained, child.Name()), filepath.Join(target, child.Name())); err != nil {
						t.Fatal(err)
					}
				}
			}
			output := filepath.Join(target, "producer-output")
			if _, err = build.Environment(ctx, consumer); err == nil {
				writeOutput(t, output, "producer wrote into an unowned replacement")
				t.Error("replaced cache root authorized the later producer")
			}
			if _, err = os.Stat(output); !os.IsNotExist(err) {
				t.Fatal("producer wrote before replacement was refused", err)
			}
			current, err := os.Stat(retained)
			if err != nil || !os.SameFile(original, current) {
				t.Fatal("refusal discarded the original owned root", err)
			}
			if _, err = BeginCompositionInstall(ctx, w, plan); err == nil {
				t.Fatal("refused cache replacement released the build reservation")
			}
		})
	}
}

func TestFiniteViteBuildRefusesReplacementAndPreservesCanceledOwnership(t *testing.T) {
	for _, kind := range []string{"replacement", "cancellation"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumers, _ := finiteBuildFixture(t)
			build, err := BeginViteBuild(ctx, w, plan, consumers)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "replacement" {
				modules := filepath.Join(w.Root, "node_modules")
				if err = os.Rename(modules, modules+".retained"); err != nil {
					t.Fatal(err)
				}
				writeOutput(t, filepath.Join(modules, "sentinel"), "replacement")
				if _, err = build.Environment(ctx, consumers[1]); err == nil {
					t.Fatal("producer accepted replaced aggregate root")
				}
				if err = build.Finish(ctx); err == nil {
					t.Fatal("completion accepted replaced aggregate root")
				}
				raw, err := os.ReadFile(filepath.Join(modules, "sentinel"))
				if err != nil || string(raw) != "replacement" {
					t.Fatal("replacement data changed", err)
				}
			} else {
				canceled, cancel := context.WithCancel(ctx)
				cancel()
				if err = build.Finish(canceled); !errors.Is(err, context.Canceled) {
					t.Fatalf("canceled build ownership not retained: %v", err)
				}
			}
			if _, err = BeginCompositionInstall(ctx, w, plan); err == nil {
				t.Fatal("unproven transaction released installer fence")
			}
			if err = Restore(ctx, w); err == nil {
				t.Fatal("unproven transaction allowed restoration")
			}
		})
	}
}
