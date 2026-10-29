package devoutputs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func outputFixture(t *testing.T) (devcontract.ResolvedWorkspace, string) {
	t.Helper()
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "workspaces", "feature")
	repo := filepath.Join(root, "host")
	if err = os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	w := devcontract.ResolvedWorkspace{Root: root, ManifestPath: filepath.Join(root, "workspace.json"), Manifest: devcontract.WorkspaceManifest{WorkspaceID: "55555555-5555-4555-8555-555555555555", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}}}}
	outputGit(t, repo, "init")
	for relative, content := range map[string]string{".gitignore": "dist/*\n!dist/.gitkeep\nnode_modules/\n", "package.json": "{\"name\":\"fixture\",\"private\":true}\n", "dist/.gitkeep": "", "packages/omniviewdev-runtime/src/bindings/model.ts": "export const reviewed = 1;\n", "packages/omniviewdev-vite-plugin/package.json": "{\"name\":\"@omniviewdev/vite-plugin\"}\n", "packages/omniviewdev-vite-plugin/shims/runtime.mjs": "export const reviewed = 1;\n", "ui/providers/monaco/yaml.worker.bundle.js": "reviewed worker\n"} {
		file := filepath.Join(repo, filepath.FromSlash(relative))
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(file, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	outputGit(t, repo, "add", ".")
	outputCommit(t, repo, "baseline")
	return w, repo
}
func outputGit(t *testing.T, repo string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = repo
	cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "GIT_CONFIG_NOSYSTEM=1")
	raw, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, raw)
	}
	return strings.TrimSpace(string(raw))
}
func outputCommit(t *testing.T, repo, message string) {
	t.Helper()
	outputGit(t, repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath="+os.DevNull, "commit", "-am", message)
}
func writeOutput(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestDistributionOwnershipPreservesTrackedBaseline(t *testing.T) {
	w, repo := outputFixture(t)
	stage, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "actual generated JS")
	if err = Publish(context.Background(), stage); err != nil {
		t.Fatal(err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(repo, "dist/index.js")); !os.IsNotExist(err) {
		t.Fatalf("generated output retained: %v", err)
	}
	if _, err = os.Stat(filepath.Join(repo, "dist/.gitkeep")); err != nil {
		t.Fatal("tracked baseline was not retained", err)
	}
}

func TestUnknownIgnoredOutputIsNeverAdopted(t *testing.T) {
	w, repo := outputFixture(t)
	unknown := filepath.Join(repo, "dist/private.txt")
	writeOutput(t, unknown, "user bytes")
	if _, err := Prepare(context.Background(), w, repo, Distribution); err == nil {
		t.Fatal("preexisting unknown output adopted")
	}
	raw, err := os.ReadFile(unknown)
	if err != nil || string(raw) != "user bytes" {
		t.Fatal("unknown output changed")
	}
}

func TestGeneratedSourceUsesCASAndRetainsCurrentCommittedBytes(t *testing.T) {
	w, repo := outputFixture(t)
	target := filepath.Join(repo, "packages/omniviewdev-runtime/src/bindings/model.ts")
	stage, err := Prepare(context.Background(), w, repo, Bindings)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "model.ts"), "export const generated = 2;\n")
	writeOutput(t, target, "human concurrent edit\n")
	if err = Publish(context.Background(), stage); err == nil {
		t.Fatal("publication overwrote concurrent source edit")
	}
	if err = stage.Abort(context.Background()); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(target)
	if string(raw) != "human concurrent edit\n" {
		t.Fatal("CAS changed human bytes")
	}
	outputGit(t, repo, "restore", "--", "packages/omniviewdev-runtime/src/bindings/model.ts")
	stage, err = Prepare(context.Background(), w, repo, Bindings)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "model.ts"), "export const generated = 3;\n")
	if err = Publish(context.Background(), stage); err != nil {
		t.Fatal(err)
	}
	writeOutput(t, target, "export const humanCommitted = 4;\n")
	outputCommit(t, repo, "human commits generated source intentionally")
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(target)
	if string(raw) != "export const humanCommitted = 4;\n" {
		t.Fatal("restoration reverted current committed source")
	}
}

func TestGeneratedUserEditAndForeignDirectoryRefuseRestore(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "edited file", true: "foreign directory"}[foreign], func(t *testing.T) {
			w, repo := outputFixture(t)
			stage, err := Prepare(context.Background(), w, repo, Distribution)
			if err != nil {
				t.Fatal(err)
			}
			writeOutput(t, filepath.Join(stage.Directory, "index.js"), "owned JS")
			if err = Publish(context.Background(), stage); err != nil {
				t.Fatal(err)
			}
			if foreign {
				if err = os.Rename(filepath.Join(repo, "dist"), filepath.Join(repo, "foreign-dist")); err != nil {
					t.Fatal(err)
				}
				writeOutput(t, filepath.Join(repo, "dist/index.js"), "owned JS")
			} else {
				writeOutput(t, filepath.Join(repo, "dist/index.js"), "human edit")
			}
			if err = Restore(context.Background(), w); err == nil {
				t.Fatal("changed/foreign output accepted")
			}
		})
	}
}

func TestControlledInstallAndCacheLifetimeDoNotTraverseLinks(t *testing.T) {
	w, repo := outputFixture(t)
	install, err := BeginInstall(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "outside.txt")
	writeOutput(t, target, "outside remains")
	writeOutput(t, filepath.Join(repo, "node_modules/package/index.js"), "installed package")
	if err = os.Symlink(target, filepath.Join(repo, "node_modules/outside-link")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err = install.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	vite, err := BeginVite(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	var cache string
	for _, entry := range vite.Environment {
		if strings.HasPrefix(entry, "OMNIVIEW_VITE_CACHE_DIRECTORY=") {
			cache = strings.TrimPrefix(entry, "OMNIVIEW_VITE_CACHE_DIRECTORY=")
		}
	}
	if cache == "" {
		t.Fatal("no explicit cache directory")
	}
	writeOutput(t, filepath.Join(cache, "deps/optimized.js"), "live optimizer output")
	if err = Validate(context.Background(), w); err == nil {
		t.Fatal("live writer incorrectly considered stopped/immutable")
	}
	if err = vite.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(target)
	if err != nil || string(raw) != "outside remains" {
		t.Fatal("node_modules cleanup traversed symlink")
	}
	if _, err = os.Stat(filepath.Join(repo, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("controlled modules not removed: %v", err)
	}
}

func TestPreexistingModulesAndUnknownWriterRefuse(t *testing.T) {
	w, repo := outputFixture(t)
	writeOutput(t, filepath.Join(repo, "node_modules/user.txt"), "unknown")
	if _, err := BeginInstall(context.Background(), w, repo); err == nil {
		t.Fatal("preexisting modules adopted")
	}
}

func TestInterruptedPublicationAndRestoreResumeFromExactImages(t *testing.T) {
	for _, duringRestore := range []bool{false, true} {
		t.Run(map[bool]string{false: "publication", true: "restoration"}[duringRestore], func(t *testing.T) {
			w, repo := outputFixture(t)
			stage, err := Prepare(context.Background(), w, repo, Distribution)
			if err != nil {
				t.Fatal(err)
			}
			writeOutput(t, filepath.Join(stage.Directory, "index.js"), "owned")
			if duringRestore {
				if err = Publish(context.Background(), stage); err != nil {
					t.Fatal(err)
				}
			}
			err = locked(context.Background(), stage.s, func(j *journal) error {
				entry := j.Entries[stage.key]
				if duringRestore {
					before, e := snapshotPath(entry.Spec, nil)
					if e != nil {
						return e
					}
					revision, e := head(context.Background(), repo)
					if e != nil {
						return e
					}
					j.Restoring = true
					if e = save(stage.s, j); e != nil {
						return e
					}
					if e = allocatePublication(stage.s, j, entry, revision, before, true); e != nil {
						return e
					}
					if e = finishRestoringStage(context.Background(), stage.s, j, entry); e != nil {
						return e
					}
				} else {
					entry.Pending.After, err = snapshotPath(stageSpec(entry), nil)
					if err != nil {
						return err
					}
					container := entry.Spec
					container.Target = entry.Pending.Directory
					entry.Pending.Container, err = snapshotPath(container, nil)
					if err != nil {
						return err
					}
					entry.Pending.Phase = "captured"
					if err = save(stage.s, j); err != nil {
						return err
					}
				}
				if err = os.Rename(entry.Spec.Target, entry.Pending.Backup); err != nil {
					return err
				}
				entry.Pending.Phase = "backed-up"
				return save(stage.s, j)
			})
			if err != nil {
				t.Fatal(err)
			}
			if err = Restore(context.Background(), w); err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(filepath.Join(repo, "dist/index.js")); !os.IsNotExist(err) {
				t.Fatal("authored output remained after recovery", err)
			}
			if _, err = os.Stat(filepath.Join(repo, "dist/.gitkeep")); err != nil {
				t.Fatal("current tracked baseline missing", err)
			}
		})
	}
}

func TestRestorationRetiresJournalBeforeWorkspaceRename(t *testing.T) {
	w, repo := outputFixture(t)
	stage, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "owned")
	if err = Publish(context.Background(), stage); err != nil {
		t.Fatal(err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	renamed := filepath.Join(filepath.Dir(w.Root), "renamed")
	if err = os.Rename(w.Root, renamed); err != nil {
		t.Fatal(err)
	}
	w.Root = renamed
	w.ManifestPath = filepath.Join(renamed, "workspace.json")
	if err = Validate(context.Background(), w); err != nil {
		t.Fatal("stale output root blocked renamed workspace", err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
}

func TestSharedCacheClosesOnlyAfterLastActualWriter(t *testing.T) {
	w, repo := outputFixture(t)
	install, err := BeginInstall(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = install.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	first, err := BeginVite(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BeginVite(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = first.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = Validate(context.Background(), w); err == nil {
		t.Fatal("second live cache writer was forgotten")
	}
	if err = second.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = Validate(context.Background(), w); err != nil {
		t.Fatal(err)
	}
}

func TestViteRestorationPreservesUnrelatedTrackedGitlink(t *testing.T) {
	w, repo := outputFixture(t)
	submodule := filepath.Join(repo, "plugins", "kubernetes")
	if err := os.MkdirAll(submodule, 0700); err != nil {
		t.Fatal(err)
	}
	revision := outputGit(t, repo, "rev-parse", "HEAD")
	outputGit(t, repo, "update-index", "--add", "--cacheinfo", "160000,"+revision+",plugins/kubernetes")
	outputCommit(t, repo, "retain unrelated submodule")
	baseline := outputGit(t, repo, "ls-tree", "HEAD", "--", "plugins/kubernetes")
	install, err := BeginInstall(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = install.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	vite, err := BeginVite(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	stamp := filepath.Join(repo, "node_modules", ".vite-temp", "vite.config.ts.timestamp-123-abcdef.mjs")
	writeOutput(t, stamp, "owned Vite loader output")
	if err = vite.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Lstat(stamp); !os.IsNotExist(err) {
		t.Fatalf("owned loader output was not retired: %v", err)
	}
	if current := outputGit(t, repo, "ls-tree", "HEAD", "--", "plugins/kubernetes"); current != baseline {
		t.Fatal("restoration changed the unrelated tracked submodule")
	}
	if info, err := os.Stat(submodule); err != nil || !info.IsDir() {
		t.Fatal("restoration removed unrelated submodule directory", err)
	}
}

func TestVitePreservesUnmanagedRootLoaderBaseline(t *testing.T) {
	w, repo := outputFixture(t)
	selected := "vite.config.ts.timestamp-123-abcdef.mjs"
	if err := os.Mkdir(filepath.Join(repo, selected), 0700); err != nil {
		t.Fatal(err)
	}
	revision := outputGit(t, repo, "rev-parse", "HEAD")
	outputGit(t, repo, "update-index", "--add", "--cacheinfo", "160000,"+revision+","+selected)
	outputCommit(t, repo, "nonregular selected loader baseline")
	baseline := outputGit(t, repo, "ls-tree", "HEAD", "--", selected)
	install, err := BeginInstall(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = install.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	vite, err := BeginVite(context.Background(), w, repo)
	if err != nil {
		t.Fatal(err)
	}
	if err = vite.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = Restore(context.Background(), w); err != nil {
		t.Fatal(err)
	}
	if current := outputGit(t, repo, "ls-tree", "HEAD", "--", selected); current != baseline {
		t.Fatal("refused baseline changed the selected submodule")
	}
}

func TestSnapshotKeepsFileDigestsIndependentAndObservesPreservedMetadataEdits(t *testing.T) {
	root := t.TempDir()
	expected := make(map[string]string)
	sizes := []int{65553, 0, 32768, 1, 32767, 32769}
	for index := range 48 {
		size := sizes[index%len(sizes)]
		data := make([]byte, size)
		for offset := range data {
			data[offset] = byte((index*17 + offset) % 251)
		}
		name := fmt.Sprintf("%02d", index)
		if err := os.WriteFile(filepath.Join(root, name), data, 0600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		expected[name] = hex.EncodeToString(sum[:])
	}
	spec := specification{Target: root, Mode: "directory", Kind: modules}
	before, err := snapshotPath(spec, nil)
	if err != nil {
		t.Fatal(err)
	}
	for name, digest := range expected {
		if before[name].Hash != digest {
			t.Fatalf("%s has the wrong independent content digest", name)
		}
	}
	path := filepath.Join(root, "00")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[0] ^= 0xff
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	expected["00"] = hex.EncodeToString(sum[:])
	after, err := snapshotPath(spec, nil)
	if err != nil {
		t.Fatal(err)
	}
	if after["00"].Hash == before["00"].Hash {
		t.Fatal("same-size edit with preserved mtime escaped a fresh byte observation")
	}
	for name, digest := range expected {
		if after[name].Hash != digest {
			t.Fatalf("%s has the wrong content digest after a new observation", name)
		}
	}
}

func BenchmarkSnapshotModuleFiles(b *testing.B) {
	root := b.TempDir()
	data := make([]byte, 1024)
	for index := range data {
		data[index] = byte(index)
	}
	for index := range 4096 {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("%04d.js", index)), data, 0600); err != nil {
			b.Fatal(err)
		}
	}
	spec := specification{Target: root, Mode: "directory", Kind: modules}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := snapshotPath(spec, nil); err != nil {
			b.Fatal(err)
		}
	}
}
