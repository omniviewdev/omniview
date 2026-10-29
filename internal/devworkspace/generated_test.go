package devworkspace

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func generatedFixture(t *testing.T) Workspace {
	t.Helper()
	root := filepath.Join(t.TempDir(), "workspaces", "fixture")
	var canonicalErr error
	root, canonicalErr = devcontract.CanonicalPath(root)
	if canonicalErr != nil {
		t.Fatal(canonicalErr)
	}
	if err := os.MkdirAll(filepath.Join(root, ".local"), 0700); err != nil {
		t.Fatal(err)
	}
	manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Slug: "fixture", DisplayName: "Fixture", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview", BaseRef: "main", BaseCommit: "d32a524bc89659260c6045062035ce05dc138ff4", Branch: "feature/fixture"}}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}
	if err := writeManifest(root, manifest); err != nil {
		t.Fatal(err)
	}
	return Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, ManifestPath: filepath.Join(root, "workspace.json"), Manifest: manifest}}
}

func TestGeneratedTreeBuildPublishesOnlyPreparedPrivateOutputs(t *testing.T) {
	w := generatedFixture(t)
	capability, err := PrepareGeneratedTree(w, "build/plugin-id", "generation")
	if err != nil {
		t.Fatal(err)
	}
	if capability.Directory == capability.Destination {
		t.Fatal("compiler can overwrite final output before ownership check")
	}
	if err = os.WriteFile(filepath.Join(capability.Directory, "plugin"), []byte("trusted output"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(capability); err != nil {
		t.Fatal(err)
	}
	if raw, err := os.ReadFile(filepath.Join(w.Root, ".local/build/plugin-id/plugin")); err != nil || string(raw) != "trusted output" {
		t.Fatalf("build not published: %s %v", raw, err)
	}
	if err = RecordGeneratedTree(capability); err == nil {
		t.Fatal("stale capability published twice")
	}
	if err = CleanGenerated(w); err != nil {
		t.Fatal(err)
	}
}

func TestGeneratedTreeRefusesForeignOrChangedDestination(t *testing.T) {
	w := generatedFixture(t)
	foreign := filepath.Join(w.Root, ".local/bin")
	if err := os.Mkdir(foreign, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(foreign, "user-file"), []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareGeneratedTree(w, "bin", "generation"); err == nil {
		t.Fatal("foreign output directory adopted")
	}
	if raw, _ := os.ReadFile(filepath.Join(foreign, "user-file")); string(raw) != "preserve" {
		t.Fatal("foreign bytes changed")
	}
}

func TestGeneratedCleanupRejectsUserEditAndNestedInjectionBeforeDeleting(t *testing.T) {
	w := generatedFixture(t)
	capability, err := PrepareGeneratedTree(w, "bin", "generation")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(capability.Directory, "host"), []byte("owned"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(capability); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(w.Root, ".local/bin/user-added")
	if err = os.WriteFile(foreign, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = CleanGenerated(w); err == nil {
		t.Fatal("nested foreign file deleted")
	}
	if _, err = os.Stat(filepath.Join(w.Root, ".local/bin/host")); err != nil {
		t.Fatal("cleanup deleted own files before complete preflight")
	}
	if raw, _ := os.ReadFile(foreign); string(raw) != "keep" {
		t.Fatal("foreign file changed")
	}
}

func TestGeneratedLogDoesNotAdoptForeignAppends(t *testing.T) {
	w := generatedFixture(t)
	log, err := openGeneratedLog(w, "supervisor.log")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = log.Write([]byte("owned\n")); err != nil {
		t.Fatal(err)
	}
	foreign, err := os.OpenFile(filepath.Join(w.Root, ".local/supervisor.log"), os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = foreign.WriteString("foreign\n"); err != nil {
		t.Fatal(err)
	}
	foreign.Close()
	log.Close()
	if err = CleanGenerated(w); err == nil {
		t.Fatal("foreign bytes retroactively treated as writer output")
	}
}

func TestGeneratedBuildCannotAdoptUnrecordedParentDirectory(t *testing.T) {
	w := generatedFixture(t)
	if err := os.Mkdir(filepath.Join(w.Root, ".local/build"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareGeneratedTree(w, "build/plugin", "generation"); err == nil {
		t.Fatal("preexisting unowned parent was acquired")
	}
}

func TestGeneratedSiblingBuildsPreparedTogetherBothPublishUnderNewParent(t *testing.T) {
	w := generatedFixture(t)
	first, err := PrepareGeneratedTree(w, "build/first", "generation")
	if err != nil {
		t.Fatal(err)
	}
	second, err := PrepareGeneratedTree(w, "build/second", "generation")
	if err != nil {
		t.Fatal(err)
	}
	for _, prepared := range []*GeneratedTree{first, second} {
		if err = os.WriteFile(filepath.Join(prepared.Directory, "plugin"), []byte(prepared.relative), 0700); err != nil {
			t.Fatal(err)
		}
		if err = RecordGeneratedTree(prepared); err != nil {
			t.Fatalf("%s: %v", prepared.relative, err)
		}
	}
	for _, relative := range []string{"build/first", "build/second"} {
		if _, err := publishedGeneratedTree(w, relative); err != nil {
			t.Fatalf("%s not published: %v", relative, err)
		}
	}
	if err := os.WriteFile(filepath.Join(w.Root, ".local/build/first/plugin"), []byte("edited"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := publishedGeneratedTree(w, "build/first"); err == nil {
		t.Fatal("edited generated output still validated as published")
	}
}

func TestPreparedDirectoryReplacementCannotAcquireForeignBytes(t *testing.T) {
	w := generatedFixture(t)
	prepared, err := PrepareGeneratedTree(w, "bin", "generation")
	if err != nil {
		t.Fatal(err)
	}
	moved := prepared.Directory + "-original"
	if err = os.Rename(prepared.Directory, moved); err != nil {
		prepared.stageFile.Close()
		t.Skipf("OS retained directory handle prevented replacement: %v", err)
	}
	if err = os.Mkdir(prepared.Directory, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(prepared.Directory, "foreign")
	if err = os.WriteFile(foreign, []byte("preserve foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(prepared); err == nil {
		t.Fatal("replacement staging directory was attested")
	}
	if raw, _ := os.ReadFile(foreign); string(raw) != "preserve foreign" {
		t.Fatal("foreign bytes were changed")
	}
	if _, err = os.Stat(prepared.Destination); !os.IsNotExist(err) {
		t.Fatal("foreign replacement was published")
	}
}

func TestGeneratedCleanupResumesOnlyRecordedDeletionIntent(t *testing.T) {
	w := generatedFixture(t)
	prepared, err := PrepareGeneratedTree(w, "bin", "generation")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte("owned"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(prepared); err != nil {
		t.Fatal(err)
	}
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		t.Fatal(err)
	}
	ledger.Cleanup = &generatedCleanup{Plan: []string{"bin/host", "bin"}, Deleting: "bin/host", Completed: map[string]bool{}}
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		unlock()
		t.Fatal(err)
	}
	unlock()
	if err = os.Remove(filepath.Join(w.Root, ".local/bin/host")); err != nil {
		t.Fatal(err)
	}
	if err = CleanGenerated(w); err != nil {
		t.Fatalf("recorded interrupted deletion did not resume: %v", err)
	}
}

func TestGeneratedCleanupRejectsUnrecordedMissingFile(t *testing.T) {
	w := generatedFixture(t)
	prepared, err := PrepareGeneratedTree(w, "bin", "generation")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte("owned"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(prepared); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(w.Root, ".local/bin/host")); err != nil {
		t.Fatal(err)
	}
	if err = CleanGenerated(w); err == nil {
		t.Fatal("unrecorded missing resource was treated as completed deletion")
	}
}

func TestGeneratedLogRejectsReplacementBeforeAppending(t *testing.T) {
	w := generatedFixture(t)
	log, err := openGeneratedLog(w, "supervisor.log")
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	if _, err = log.Write([]byte("before")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(w.Root, ".local/supervisor.log")
	moved := path + ".moved"
	if err = os.Rename(path, moved); err != nil {
		t.Skipf("OS retained handle prevents rename: %v", err)
	}
	if err = os.WriteFile(path, []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if n, err := log.Write([]byte("must not append")); err == nil || n != 0 {
		t.Fatalf("replaced log accepted append: %d %v", n, err)
	}
	if raw, _ := os.ReadFile(moved); string(raw) != "before" {
		t.Fatal("detached old inode received more output")
	}
	if raw, _ := os.ReadFile(path); string(raw) != "foreign" {
		t.Fatal("replacement bytes changed")
	}
}

func TestGeneratedTreeCreatesPrivateScaffoldWithoutIncidentalBuildCache(t *testing.T) {
	w := generatedFixture(t)
	local := filepath.Join(w.Root, ".local")
	if err := os.Remove(local); err != nil {
		t.Fatal(err)
	}
	prepared, err := PrepareGeneratedTree(w, filepath.Join("build", "plugin"), NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(prepared.Directory, "plugin"), []byte("controlled output"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(prepared); err != nil {
		t.Fatal(err)
	}
	if output, err := os.ReadFile(filepath.Join(prepared.Destination, "plugin")); err != nil || string(output) != "controlled output" {
		t.Fatalf("fresh scaffold did not publish actual output: %q %v", output, err)
	}
	if err = CleanGenerated(w); err != nil {
		t.Fatal(err)
	}
}
