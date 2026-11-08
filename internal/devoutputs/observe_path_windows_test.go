package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestWindowsInitialObservationPinsIdentityBeforeMetadataCapture(t *testing.T) {
	for _, boundary := range []string{"snapshot", "journal"} {
		t.Run(boundary, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "output")
			original := []byte("original")
			if boundary == "journal" {
				w, repo := outputFixture(t)
				if _, err := Prepare(context.Background(), w, repo, Distribution); err != nil {
					t.Fatal(err)
				}
				s, err := newScope(w)
				if err != nil {
					t.Fatal(err)
				}
				path = s.path
				original, err = os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				writeOutput(t, path, string(original))
			}
			stamp := time.Unix(1100000000, 0).UTC()
			if err := os.Chtimes(path, stamp, stamp); err != nil {
				t.Fatal(err)
			}

			// Opening this metadata-only handle is the initial production observation.
			// Substitute the pathname before Stat obtains either attributes or identity.
			// No earlier pathname Lstat is treated as an identity promise.
			initial, err := openSnapshotObservation(path)
			if err != nil {
				t.Fatal(err)
			}
			defer initial.Close()
			backup := path + "-initial"
			if err = os.Rename(path, backup); err != nil {
				t.Fatal(err)
			}
			replacement := []byte(strings.Repeat("x", len(original)))
			if boundary == "journal" {
				err = devsession.WritePrivateFile(path, replacement)
				if err == nil {
					err = devsession.ValidatePrivateFile(path)
				}
			} else {
				err = os.WriteFile(path, replacement, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = os.Chtimes(path, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			observed, err := initial.Stat()
			if err != nil {
				t.Fatal(err)
			}
			current, err := observeSnapshotPath(path)
			if err != nil {
				t.Fatal(err)
			}
			if observed.Mode() != current.Mode() || observed.Size() != current.Size() || observed.ModTime() != current.ModTime() {
				t.Fatal("replacement must match all compared metadata")
			}
			retained, err := observeSnapshotPath(backup)
			if err != nil {
				t.Fatal(err)
			}
			if !os.SameFile(observed, retained) || os.SameFile(observed, current) {
				t.Fatal("initial handle observation rebased to replacement identity")
			}

			if boundary == "journal" {
				raw, err := readObservedJournalBytes(path, observed)
				var substitution *pathConflict
				if !errors.As(err, &substitution) || len(raw) != 0 {
					t.Fatalf("journal read replacement after capture-window substitution: %v", err)
				}
			} else {
				var reader snapshotReader
				_, err := reader.item(path, observed, false)
				var substitution *pathConflict
				if !errors.As(err, &substitution) {
					t.Fatalf("snapshot read replacement after capture-window substitution: %v", err)
				}
			}
			raw, err := os.ReadFile(backup)
			if err != nil || string(raw) != string(original) {
				t.Fatal("initial bytes changed", err)
			}
			raw, err = os.ReadFile(path)
			if err != nil || string(raw) != string(replacement) {
				t.Fatal("replacement bytes changed", err)
			}
		})
	}
}
