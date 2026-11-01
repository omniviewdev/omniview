package devworkspace

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// DiscoverCollections lists reachable, validated collections associated with the
// selected Git repository's registered worktrees. It never selects a profile,
// scans sibling directories, fetches refs or creates a machine-global registry.
func DiscoverCollections(ctx context.Context, directory string) ([]string, error) {
	common, err := git(ctx, directory, "", "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return nil, err
	}
	common, err = devcontract.CanonicalPath(common)
	if err != nil {
		return nil, err
	}
	listing, err := git(ctx, directory, "", "worktree", "list", "--porcelain", "-z")
	if err != nil {
		return nil, err
	}
	roots := make([]string, 0)
	visited := make(map[string]bool)
	for _, field := range strings.Split(listing, "\x00") {
		if !strings.HasPrefix(field, "worktree ") {
			continue
		}
		for root := strings.TrimPrefix(field, "worktree "); ; root = filepath.Dir(root) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if visited[root] {
				break
			}
			visited[root] = true
			marker := filepath.Join(root, ".omniview-dev", "repositories.json")
			if canonical, err := filepath.EvalSymlinks(marker); err == nil && canonical == marker {
				registry, err := LoadRegistry(ctx, root)
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				if err == nil {
					for _, source := range registry.Repositories {
						if source.ID == "omniview" && source.CommonDir == common {
							roots = append(roots, root)
							break
						}
					}
				}
			}
			if filepath.Dir(root) == root {
				break
			}
		}
	}
	sort.Strings(roots)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return roots, nil
}
