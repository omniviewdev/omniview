//go:build darwin || linux

package devcompose

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestPlanningRejectsWorkspaceDeclarationCreatedAfterDiscovery(t *testing.T) {
	w, roots := fixture(t)
	member := filepath.Join(w.Root, "plugin-a/ui")
	manifest := filepath.Join(member, "package.json")
	manifestBytes := []byte(`{"name":"plugin-ui","private":true,"dependencies":{"exact":"^1"}}`)
	for _, name := range []string{"package.json", "pnpm-workspace.yaml"} {
		if err := os.Remove(filepath.Join(member, name)); err != nil {
			t.Fatal(err)
		}
	}
	// This explicit standalone root already tracks its absent lock. Creating
	// its declaration must not escape freshness just because ownership is stable.
	if err := unix.Mkfifo(manifest, 0600); err != nil {
		t.Fatal(err)
	}
	// The FIFO writer connects only once planning has finished WalkDir and
	// opened this selected manifest. Create the declaration before allowing
	// that read to finish: no sleeps, racing editor, or production I/O hook.
	edited := make(chan error, 1)
	go func() {
		edited <- func() error {
			writer, err := os.OpenFile(manifest, os.O_WRONLY, 0)
			if err != nil {
				return err
			}
			defer writer.Close()
			// Leave a regular unchanged manifest for subsequent freshness reads.
			if err := os.Remove(manifest); err != nil {
				return err
			}
			if err := os.WriteFile(manifest, manifestBytes, 0600); err != nil {
				return err
			}
			if err := os.WriteFile(filepath.Join(member, "pnpm-workspace.yaml"), []byte("packages: []\noverrides: {exact: 2.0.0}\n"), 0600); err != nil {
				return err
			}
			_, err = writer.Write(manifestBytes)
			return err
		}()
	}()
	p, err := New(w, roots, nil)
	if editErr := <-edited; editErr != nil {
		t.Fatal(editErr)
	}
	if err == nil {
		docs, decodeErr := decodeDocuments(generated(t, p, "pnpm-workspace.yaml"))
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if mapping(docs[0]["overrides"])["exact"] != "2.0.0" && CheckInputs(p) == nil {
			t.Fatal("new workspace declaration omitted from generated policy but accepted by the installation freshness barrier")
		}
	}
	// Once discovered normally, the same declaration is valid and effective.
	p, err = New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := decodeDocuments(generated(t, p, "pnpm-workspace.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if mapping(docs[0]["overrides"])["exact"] != "2.0.0" {
		t.Fatal("freshly discovered declaration policy was not applied")
	}
}
