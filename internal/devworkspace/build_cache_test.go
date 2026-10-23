package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestCompilerCacheOwnsUUIDRuntimeWithoutInitializingState(t *testing.T) {
	w := generatedFixture(t)
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	generation := NewGeneration()
	directory, err := prepareWorkspaceBuildCache(context.Background(), w, home, generation)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := profileFor(w, home, generation)
	if err != nil {
		t.Fatal(err)
	}
	if directory != filepath.Join(profile.RuntimeRoot, "go-build") || strings.HasPrefix(directory, w.Root+string(filepath.Separator)) {
		t.Fatalf("compiler cache escaped authoritative UUID runtime: %s", directory)
	}
	if _, err = os.Stat(profile.Descriptor.StateRoot); !os.IsNotExist(err) {
		t.Fatalf("compiler preparation initialized seed destination state: %v", err)
	}
	if err = devcontract.ValidateDefaultProfileOwnership(home, w.Manifest.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	foreignHome, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(foreignHome, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "foreign")
	if err = os.MkdirAll(filepath.Dir(foreign), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(foreign, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = prepareWorkspaceBuildCache(context.Background(), w, foreignHome, generation); err == nil {
		t.Fatal("unmarked populated profile was adopted for compiler output")
	}
	if contents, _ := os.ReadFile(foreign); string(contents) != "preserve" {
		t.Fatal("foreign profile content was changed")
	}
}
