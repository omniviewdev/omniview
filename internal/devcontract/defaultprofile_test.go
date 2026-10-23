package devcontract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const defaultOwnerFixtureID = "2ae615c8-8541-4b54-bc35-a1d16719555c"

func defaultOwnerFixture(t *testing.T) (string, string) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	release, err := LockProfile(context.Background(), home, defaultOwnerFixtureID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := release(); err != nil {
			t.Error(err)
		}
	})
	return home, filepath.Join(home, ".omniview-dev", "profiles", defaultOwnerFixtureID)
}

func TestDefaultProfileOwnerEstablishesIdentityWithoutState(t *testing.T) {
	home, profile := defaultOwnerFixture(t)
	if err := ValidateDefaultProfileOwnership(home, defaultOwnerFixtureID); !os.IsNotExist(err) {
		t.Fatalf("missing owner should remain missing: %v", err)
	}
	if _, err := os.Stat(profile); !os.IsNotExist(err) {
		t.Fatal("read-only validation created profile")
	}
	if err := EnsureDefaultProfileOwnership(home, defaultOwnerFixtureID); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(profile, ".workspace-owner.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var marker struct {
		SchemaVersion int    `json:"schemaVersion"`
		WorkspaceID   string `json:"workspaceID"`
	}
	if err := json.Unmarshal(before, &marker); err != nil {
		t.Fatal(err)
	}
	if marker.SchemaVersion != 1 || marker.WorkspaceID != defaultOwnerFixtureID {
		t.Fatalf("wrong marker: %+v", marker)
	}
	if err := ValidateDefaultProfileOwnership(home, defaultOwnerFixtureID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profile, "owned-data"), []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultProfileOwnership(home, defaultOwnerFixtureID); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(before) {
		t.Fatal("matching owner metadata rewritten")
	}
	for _, child := range []string{"state", "runtime", "webview"} {
		if _, err := os.Stat(filepath.Join(profile, child)); !os.IsNotExist(err) {
			t.Fatalf("ownership setup created %s", child)
		}
	}
}

func TestDefaultProfileOwnerRefusesNonemptyUnmarkedBoundary(t *testing.T) {
	home, profile := defaultOwnerFixture(t)
	if err := os.MkdirAll(profile, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(profile, "foreign")
	if err := os.WriteFile(sentinel, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultProfileOwnership(home, defaultOwnerFixtureID); err == nil {
		t.Fatal("claimed nonempty unmarked profile")
	}
	if err := ValidateDefaultProfileOwnership(home, defaultOwnerFixtureID); err == nil {
		t.Fatal("accepted unmarked profile")
	}
	got, err := os.ReadFile(sentinel)
	if err != nil || string(got) != "untouched" {
		t.Fatal("foreign contents changed")
	}
	if _, err := os.Stat(filepath.Join(profile, ".workspace-owner.json")); !os.IsNotExist(err) {
		t.Fatal("foreign profile was marked")
	}
}

func TestDefaultProfileOwnerRejectsForeignAndRedirectedMetadata(t *testing.T) {
	for _, kind := range []string{"foreign-uuid", "profile-symlink", "marker-symlink", "marker-directory", "malformed"} {
		t.Run(kind, func(t *testing.T) {
			home, profile := defaultOwnerFixture(t)
			if err := os.MkdirAll(filepath.Dir(profile), 0700); err != nil {
				t.Fatal(err)
			}
			foreign := t.TempDir()
			sentinel := filepath.Join(foreign, "sentinel")
			if err := os.WriteFile(sentinel, []byte("preserve"), 0600); err != nil {
				t.Fatal(err)
			}
			if kind == "profile-symlink" {
				if err := os.Symlink(foreign, profile); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(profile, 0700); err != nil {
					t.Fatal(err)
				}
				marker := filepath.Join(profile, ".workspace-owner.json")
				switch kind {
				case "foreign-uuid":
					if err := os.WriteFile(marker, []byte(`{"schemaVersion":1,"workspaceID":"8c410e3d-b059-4aa8-b3b5-5acda3769476"}`), 0600); err != nil {
						t.Fatal(err)
					}
				case "marker-symlink":
					if err := os.Symlink(sentinel, marker); err != nil {
						t.Fatal(err)
					}
				case "marker-directory":
					if err := os.Mkdir(marker, 0700); err != nil {
						t.Fatal(err)
					}
				case "malformed":
					if err := os.WriteFile(marker, []byte("invalid"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := EnsureDefaultProfileOwnership(home, defaultOwnerFixtureID); err == nil {
				t.Fatalf("claimed %s", kind)
			}
			if err := ValidateDefaultProfileOwnership(home, defaultOwnerFixtureID); err == nil {
				t.Fatalf("validated %s", kind)
			}
			got, err := os.ReadFile(sentinel)
			if err != nil || string(got) != "preserve" {
				t.Fatal("foreign sentinel changed")
			}
		})
	}
}

func TestDefaultProfileOwnerPublicationCannotOverwriteExistingMarker(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "complete-owner")
	destination := filepath.Join(directory, ".workspace-owner.json")
	if err := os.WriteFile(source, []byte("new owner"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("foreign existing owner"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := publishDefaultProfileOwner(source, destination); err == nil {
		t.Fatal("exclusive owner publication overwrote occupied destination")
	}
	got, err := os.ReadFile(destination)
	if err != nil || string(got) != "foreign existing owner" {
		t.Fatal("occupied ownership marker changed")
	}
}
