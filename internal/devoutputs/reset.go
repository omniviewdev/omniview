package devoutputs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ResetDependencyTrees deletes every journal-owned dependency tree and cache
// (modules, TypeScript, Vite loader and Vite optimizer caches), forgets their
// entries, and deletes any unrecorded node_modules directly below the supplied
// package roots. It never adopts foreign bytes: new trees come only from a
// later recorded writer. Other producer outputs and their journal entries
// are left untouched.
//
// Unfinished writer records of the reset kinds are discarded, so the caller
// must hold the stopped-profile guard proving no producer process is alive.
//
// duringRestoration admits a journal whose restoration (unlink/remove) was
// interrupted. Reset-kind removal intents complete by deleting their trees;
// every other entry and the Restoring state stay for the resumed restoration.
func ResetDependencyTrees(ctx context.Context, w devcontract.ResolvedWorkspace, roots []string, duringRestoration bool) ([]string, error) {
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	cacheRoot := filepath.Join(s.directory, "cache")
	confined := func(path string, kind Producer) error {
		canonical, err := cleanPath(path)
		if err != nil {
			return err
		}
		boundary := s.workspace.Root
		if kind == viteCache {
			boundary = cacheRoot
		}
		if canonical == boundary || !contains(boundary, canonical) {
			return fmt.Errorf("dependency tree resolves outside its selected root: %s", path)
		}
		return nil
	}
	var removed []string
	err = locked(ctx, s, func(j *journal) error {
		if j.Restoring && !duringRestoration {
			return fmt.Errorf("repository output restoration is incomplete; unlink before resetting modules")
		}
		// Preflight every target before deleting anything.
		targets := map[string]bool{}
		var keys []string
		for key, entry := range j.Entries {
			switch entry.Spec.Kind {
			case modules, typeCache, loaderCache, viteCache:
			default:
				continue
			}
			paths := []string{entry.Spec.Target}
			if entry.Pending != nil {
				paths = append(paths, entry.Pending.Directory, entry.Pending.Backup)
			}
			for _, path := range paths {
				if path == "" {
					continue
				}
				if err := confined(path, entry.Spec.Kind); err != nil {
					return err
				}
				targets[path] = true
			}
			keys = append(keys, key)
		}
		for _, root := range roots {
			if err := confined(filepath.Join(root, "node_modules"), modules); err != nil {
				return err
			}
			targets[filepath.Join(root, "node_modules")] = true
		}
		ordered := make([]string, 0, len(targets))
		for path := range targets {
			if _, err := os.Lstat(path); err == nil {
				ordered = append(ordered, path)
			} else if !os.IsNotExist(err) {
				return err
			}
		}
		sort.Strings(ordered)
		// A nested cache disappears with its enclosing modules tree.
	report:
		for _, path := range ordered {
			for _, parent := range removed {
				if contains(parent, path) {
					continue report
				}
			}
			removed = append(removed, path)
		}
		// Delete before forgetting: an interrupted reset leaves recorded entries
		// for trees that are already gone, and a rerun completes the deletion.
		for _, path := range ordered {
			if err := os.RemoveAll(path); err != nil {
				return err
			}
		}
		if len(keys) == 0 {
			return nil
		}
		for _, key := range keys {
			forgetEntry(j, key)
		}
		return save(s, j)
	})
	if err != nil {
		return nil, err
	}
	return removed, nil
}
