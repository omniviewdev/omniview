package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// AddRepository appends one mapping without rediscovering or replacing sources.
func AddRepository(ctx context.Context, root string, spec SourceSpec) (Registry, error) {
	root, err := registryRoot(root)
	if err != nil {
		return Registry{}, err
	}
	unlock, err := lockRoot(root)
	if err != nil {
		return Registry{}, err
	}
	defer unlock()
	reg, err := LoadRegistry(root)
	if err != nil {
		return Registry{}, err
	}
	if err = ctx.Err(); err != nil {
		return Registry{}, err
	}
	source, err := sourceFromSpec(ctx, root, spec, true)
	if err != nil {
		return Registry{}, err
	}
	reg.Repositories = append(reg.Repositories, source)
	if err = validateSources(ctx, reg.Repositories); err != nil {
		return Registry{}, err
	}
	if err = ctx.Err(); err != nil {
		return Registry{}, err
	}
	return reg, atomicJSON(filepath.Join(root, ".omniview-dev", "repositories.json"), reg)
}

// RemoveRepository unregisters an unused source. It never removes a checkout,
// branch, profile, or workspace. Retained resources still count as references.
func RemoveRepository(ctx context.Context, root, id string) (Registry, error) {
	if !safeID(id) {
		return Registry{}, devcontract.Fail(2, "invalid_repository", "source ID is invalid")
	}
	if id == "omniview" {
		return Registry{}, devcontract.Fail(2, "missing_host", "host cannot be unregistered")
	}
	root, err := registryRoot(root)
	if err != nil {
		return Registry{}, err
	}
	unlock, err := lockRoot(root)
	if err != nil {
		return Registry{}, err
	}
	defer unlock()
	reg, err := LoadRegistry(root)
	if err != nil {
		return Registry{}, err
	}
	index := -1
	for i, source := range reg.Repositories {
		if source.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return Registry{}, devcontract.Fail(3, "missing_repository", "repository is not registered")
	}
	if err = checkRepositoryReferences(ctx, root, id); err != nil {
		return Registry{}, err
	}
	reg.Repositories = append(reg.Repositories[:index:index], reg.Repositories[index+1:]...)
	return reg, atomicJSON(filepath.Join(root, ".omniview-dev", "repositories.json"), reg)
}

func registryRoot(root string) (string, error) {
	if root == "" {
		return "", devcontract.Fail(2, "missing_root", "repository root is required")
	}
	return devcontract.CanonicalPath(root)
}

func checkRepositoryReferences(ctx context.Context, root, id string) error {
	for _, collection := range []string{filepath.Join(root, "workspaces"), filepath.Join(root, ".omniview-dev", "retirements")} {
		canonical, err := devcontract.CanonicalPath(collection)
		if err != nil {
			return err
		}
		if canonical != collection {
			return devcontract.Fail(4, "foreign_workspace", "workspace references cannot be redirected through a symlink")
		}
		entries, err := os.ReadDir(collection)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err = ctx.Err(); err != nil {
				return err
			}
			path := filepath.Join(collection, entry.Name())
			var j *journal
			if entry.IsDir() {
				j, err = loadJournal(path)
				if err != nil {
					return devcontract.Fail(4, "unknown_workspace_references", "repair workspace ownership before unregistering a repository")
				}
			} else if filepath.Ext(entry.Name()) == ".json" && filepath.Base(collection) == "retirements" {
				canonical, e := devcontract.CanonicalPath(path)
				if e != nil || canonical != path {
					return devcontract.Fail(4, "foreign_retirement", "retirement receipt cannot be redirected")
				}
				data, e := os.ReadFile(path)
				j = &journal{}
				if e != nil || json.Unmarshal(data, j) != nil || j.SchemaVersion != 1 || j.Manifest.Validate() != nil || j.WorkspaceID != j.Manifest.WorkspaceID {
					return devcontract.Fail(4, "invalid_retirement", "repair retirement receipt before unregistering a repository")
				}
			} else if entry.Type()&os.ModeSymlink != 0 {
				return devcontract.Fail(4, "unknown_workspace_references", "workspace collection contains a redirected entry")
			} else {
				continue
			}
			for _, repository := range j.Manifest.Repositories {
				if repository.ID == id {
					return devcontract.Fail(4, "repository_in_use", "repository is referenced by a workspace or pending retirement")
				}
			}
			for _, resource := range j.Resources {
				if resource.Repository.ID == id {
					return devcontract.Fail(4, "repository_in_use", "repository has a retained workspace resource")
				}
			}
		}
	}
	return ctx.Err()
}
