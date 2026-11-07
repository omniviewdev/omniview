//go:build darwin || linux

package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestSnapshotRejectsSubstitutedRegularFilesBeforeReading(t *testing.T) {
	for _, replacement := range []string{"link", "fifo", "file", "directory"} {
		t.Run(replacement, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "output")
			writeOutput(t, path, "original")
			observed, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.Rename(path, path+"-original"); err != nil {
				t.Fatal(err)
			}
			foreign := filepath.Join(t.TempDir(), "private")
			writeOutput(t, foreign, "do not read foreign payload")
			switch replacement {
			case "link":
				err = os.Symlink(foreign, path)
			case "fifo":
				err = unix.Mkfifo(path, 0600)
			case "file":
				err = os.WriteFile(path, []byte("replacement"), 0600)
			case "directory":
				err = os.Mkdir(path, 0700)
			}
			if err != nil {
				t.Fatal(err)
			}
			// The observer has already captured metadata; substitute deterministically
			// before invoking the same open/read boundary used by parallel snapshots.
			var reader snapshotReader
			done := make(chan error, 1)
			go func() { _, e := reader.item(path, observed, false); done <- e }()
			select {
			case err = <-done:
			case <-time.After(2 * time.Second):
				if replacement == "fifo" {
					fd, e := unix.Open(path, unix.O_WRONLY|unix.O_NONBLOCK, 0)
					if e == nil {
						unix.Close(fd)
					}
				}
				t.Fatal("snapshot open blocked on substituted entry")
			}
			var substitution *pathConflict
			if !errors.As(err, &substitution) || substitution.Path != path || substitution.ExpectedKind != "file" {
				t.Fatalf("missing typed substitution: %v", err)
			}
			if reader.digest != nil || reader.buffer != nil {
				t.Fatal("replacement reached payload hashing")
			}
			raw, e := os.ReadFile(foreign)
			if e != nil || string(raw) != "do not read foreign payload" {
				t.Fatal("foreign bytes changed", e)
			}
		})
	}
}

func TestSnapshotLinksRemainOpaqueAndIOErrorsRemainFailures(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "missing-target")
	path := filepath.Join(root, "link")
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	observed, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	var reader snapshotReader
	value, err := reader.item(path, observed, true)
	if err != nil || value.Kind != "link" || value.Link != target || reader.digest != nil {
		t.Fatalf("link was not observed opaquely: %+v %v", value, err)
	}
	file := filepath.Join(root, "denied")
	writeOutput(t, file, "private")
	if err = os.Chmod(file, 0); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(file, 0600)
	observed, err = os.Lstat(file)
	if err != nil {
		t.Fatal(err)
	}
	_, err = reader.item(file, observed, false)
	if os.Geteuid() == 0 {
		t.Skip("root bypasses the permission probe")
	}
	var ioFailure *os.PathError
	var substitution *pathConflict
	if !errors.As(err, &ioFailure) || errors.As(err, &substitution) || inspectionBoundaryConflict(err) {
		t.Fatalf("I/O failure mislabeled as ownership drift: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w, _ := outputFixture(t)
	_, err = Inspect(ctx, w, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}

func TestPinnedPreservationDoesNotFollowSubstitutedParents(t *testing.T) {
	for _, replace := range []string{"source", "destination"} {
		t.Run(replace, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			sourceParent, destinationParent, foreign := filepath.Join(root, "source"), filepath.Join(root, "destination"), filepath.Join(root, "foreign")
			for _, path := range []string{sourceParent, destinationParent, foreign} {
				if err = os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			source := filepath.Join(sourceParent, "output")
			writeOutput(t, filepath.Join(source, "private.txt"), "owned bytes")
			writeOutput(t, filepath.Join(foreign, "output/private.txt"), "foreign bytes")
			sourceID, err := directoryIdentity(sourceParent)
			if err != nil {
				t.Fatal(err)
			}
			destinationID, err := directoryIdentity(destinationParent)
			if err != nil {
				t.Fatal(err)
			}
			parents, err := pinPreservationParents(source, filepath.Join(destinationParent, "saved"), sourceID, destinationID)
			if err != nil {
				t.Fatal(err)
			}
			defer parents.close()
			replaced := sourceParent
			if replace == "destination" {
				replaced = destinationParent
			}
			before := replaced + "-before"
			if err = os.Rename(replaced, before); err != nil {
				t.Fatal(err)
			}
			if err = os.Symlink(foreign, replaced); err != nil {
				t.Fatal(err)
			}
			// Both capabilities are already pinned. Only now substitute the namespace,
			// then perform the actual platform no-replace operation through those handles.
			if err = parents.move("output", "saved"); err == nil {
				t.Fatal("namespace replacement went unnoticed")
			}
			preserved := filepath.Join(destinationParent, "saved/private.txt")
			if replace == "destination" {
				preserved = filepath.Join(before, "saved/private.txt")
			}
			raw, err := os.ReadFile(preserved)
			if err != nil || string(raw) != "owned bytes" {
				t.Fatal("owned bytes were not retained in the pinned directory", err)
			}
			raw, err = os.ReadFile(filepath.Join(foreign, "output/private.txt"))
			if err != nil || string(raw) != "foreign bytes" {
				t.Fatal("foreign source changed", err)
			}
			if _, err = os.Lstat(filepath.Join(foreign, "saved")); !os.IsNotExist(err) {
				t.Fatalf("move followed unchecked parent: %v", err)
			}
		})
	}
}

func TestPinnedPreservationNeverOverwritesAnOccupiedDestination(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sourceParent, destinationParent := filepath.Join(root, "source"), filepath.Join(root, "destination")
	if err = os.Mkdir(sourceParent, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(destinationParent, 0700); err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(sourceParent, "output/private.txt"), "retained")
	occupied := filepath.Join(destinationParent, "saved")
	if err = os.Mkdir(occupied, 0700); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(occupied)
	if err != nil {
		t.Fatal(err)
	}
	sourceID, err := directoryIdentity(sourceParent)
	if err != nil {
		t.Fatal(err)
	}
	destinationID, err := directoryIdentity(destinationParent)
	if err != nil {
		t.Fatal(err)
	}
	parents, err := pinPreservationParents(filepath.Join(sourceParent, "output"), occupied, sourceID, destinationID)
	if err != nil {
		t.Fatal(err)
	}
	defer parents.close()
	if err = parents.move("output", "saved"); err == nil {
		t.Fatal("occupied destination was replaced")
	}
	after, err := os.Lstat(occupied)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("destination identity changed", err)
	}
	raw, err := os.ReadFile(filepath.Join(sourceParent, "output/private.txt"))
	if err != nil || string(raw) != "retained" {
		t.Fatal("source bytes moved on refusal", err)
	}
}
