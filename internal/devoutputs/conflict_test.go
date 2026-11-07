package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestTrackedPlaceholderChangesRemainTypedConflicts(t *testing.T) {
	for _, change := range []string{"edited", "removed", "unknown-neighbor"} {
		t.Run(change, func(t *testing.T) {
			w, repo := outputFixture(t)
			placeholder := filepath.Join(repo, "dist/.gitkeep")
			switch change {
			case "edited":
				writeOutput(t, placeholder, "user edit")
			case "removed":
				if err := os.Remove(placeholder); err != nil {
					t.Fatal(err)
				}
			case "unknown-neighbor":
				writeOutput(t, filepath.Join(repo, "dist/user.txt"), "private")
			}
			_, err := Prepare(context.Background(), w, repo, Distribution)
			var c *Conflict
			if !errors.As(err, &c) || c.Target != filepath.Join(repo, "dist") || c.Ownership != "unowned" || c.MetadataPath == "" || len(c.ChangedPaths) == 0 {
				t.Fatalf("lost conflict identity: %v", err)
			}
		})
	}
}

func TestPublicationConflictRetainsExactDestinationStageAndBackup(t *testing.T) {
	w, repo := outputFixture(t)
	ctx := context.Background()
	stage, err := Prepare(ctx, w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "managed")
	s, _ := newScope(w)
	var backup string
	err = locked(ctx, s, func(j *journal) error {
		entry := j.Entries[stage.key]
		backup = entry.Pending.Backup
		writeOutput(t, filepath.Join(entry.Spec.Target, "private.txt"), "private")
		writeOutput(t, filepath.Join(backup, "foreign.txt"), "foreign")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	err = Publish(ctx, stage)
	var c *Conflict
	if !errors.As(err, &c) || c.Target != filepath.Join(repo, "dist") || c.Stage != stage.Directory || c.Backup != backup {
		t.Fatalf("missing publication paths: %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(backup, "foreign.txt"))
	if string(raw) != "foreign" {
		t.Fatal("foreign backup lost")
	}
	raw, _ = os.ReadFile(filepath.Join(repo, "dist/private.txt"))
	if string(raw) != "private" {
		t.Fatal("destination changed")
	}
}
