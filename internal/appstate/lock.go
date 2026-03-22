// internal/appstate/lock.go
package appstate

import (
	"fmt"
	"log"

	"github.com/gofrs/flock"
)

// acquireLock attempts a non-blocking lock on the given path.
// Returns an error if another process holds the lock.
func acquireLock(path string) (*flock.Flock, error) {
	fl := flock.New(path)
	ok, err := fl.TryLock()
	if err != nil {
		return nil, fmt.Errorf("appstate: failed to acquire lock %q: %w", path, err)
	}
	if !ok {
		return nil, fmt.Errorf("appstate: another instance holds the lock at %q", path)
	}
	return fl, nil
}

// releaseLock releases the flock. Safe to call with nil.
func releaseLock(fl *flock.Flock) {
	if fl != nil {
		if err := fl.Unlock(); err != nil {
			log.Printf("appstate: failed to release lock: %v", err)
		}
	}
}
