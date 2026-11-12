package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gofrs/flock"
	"golang.org/x/mod/semver"
)

// checkpoint advances under a process-wide file lock and never accepts a rollback.
func checkpoint(ctx context.Context, root, channel, version string) error {
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	lock := flock.New(filepath.Join(root, "update-checkpoints.lock"))
	locked, err := lock.TryLockContext(ctx, 50*time.Millisecond)
	if err != nil {
		return err
	}
	defer lock.Unlock()
	if !locked {
		return fmt.Errorf("could not lock update checkpoint")
	}
	path := filepath.Join(root, "update-checkpoints.json")
	values := map[string]string{}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err == nil {
		if err = json.Unmarshal(data, &values); err != nil || values == nil {
			return fmt.Errorf("invalid update checkpoint")
		}
	}
	old := values[channel]
	if old != "" && !semver.IsValid("v"+old) {
		return fmt.Errorf("invalid update checkpoint")
	}
	if old != "" && semver.Compare("v"+version, "v"+old) < 0 {
		return fmt.Errorf("feed version older than last seen")
	}
	if old != "" && semver.Compare("v"+version, "v"+old) == 0 {
		return nil
	}
	values[channel] = version
	data, err = json.Marshal(values)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(root, ".update-checkpoint-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
