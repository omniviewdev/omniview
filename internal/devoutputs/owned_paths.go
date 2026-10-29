package devoutputs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ValidatedOwnedPaths returns exact currently validated producer boundaries.
// It grants no mutation authority and never adopts an unrecorded output tree.
func ValidatedOwnedPaths(ctx context.Context, w devcontract.ResolvedWorkspace) ([]string, error) {
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	if _, err = os.Lstat(s.path); os.IsNotExist(err) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var paths []string
	err = locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return errors.New("repository output restoration is incomplete")
		}
		for _, entry := range j.Entries {
			values, entryErr := validatedOwnedSnapshot(ctx, entry)
			if entryErr != nil {
				return entryErr
			}
			paths = appendOwnedPaths(paths, entry, values)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func validatedOwnedSnapshot(ctx context.Context, entry *outputEntry) (snapshot, error) {
	values := entry.Expected
	if len(entry.Live) > 0 {
		// Live Vite caches retain a narrow inode-checked capability.
		// Observing that boundary never authorizes recording its bytes,
		// retiring its writer, or exempting immutable dependency stores.
		switch entry.Spec.Kind {
		case loaderCache, typeCache, viteCache, loaderFiles:
			if err := validateLiveCacheRoot(entry); err != nil {
				return nil, err
			}
			var err error
			values, err = snapshotPath(entry.Spec, nil)
			if err != nil {
				return nil, err
			}
		case Distribution, Bindings, Shims, YAMLWorker, modules:
			return nil, errors.New("repository output has an active or interrupted non-cache writer")
		default:
			return nil, errors.New("repository output has an active or interrupted non-cache writer")
		}
	} else if err := validateEntry(ctx, entry, false); err != nil {
		return nil, err
	}
	if entry.Pending != nil || entry.Cleanup != nil {
		return nil, errors.New("repository output has an active producer or cleanup")
	}
	return values, nil
}

func appendOwnedPaths(paths []string, entry *outputEntry, values snapshot) []string {
	if entry.Spec.Mode == filteredOutputMode {
		for relative, value := range values {
			if relative != "." && value.Kind != "absent" {
				paths = append(paths, filepath.Join(entry.Spec.Target, relative))
			}
		}
	} else if value, ok := values["."]; ok && value.Kind != "absent" {
		paths = append(paths, entry.Spec.Target)
	}
	return paths
}
