package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type compilationSource struct {
	ID        string `json:"id"`
	Directory string `json:"directory"`
}

type compilationSources struct {
	SchemaVersion int                 `json:"schemaVersion"`
	Repositories  []compilationSource `json:"repositories"`
	Links         struct {
		SDKRepositoryID *string `json:"sdkRepositoryID"`
	} `json:"links"`
}

// compilationSDK reads only the portable source-selection projection needed to
// compile devcli. It grants no profile, ownership, cache, or publication authority.
// The original arguments are preserved so devcli independently performs full
// manifest/profile/module validation before it publishes an executable.
func compilationSDK(root, explicit string) (string, error) {
	manifestPath, err := compilationManifest(root)
	if err != nil || manifestPath == "" {
		return explicit, err
	}
	var manifest compilationSources
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", err
	}
	if json.Unmarshal(data, &manifest) != nil || manifest.SchemaVersion != 1 {
		return "", errors.New("cannot select bootstrap sources from invalid workspace metadata")
	}
	workspace := filepath.Dir(manifestPath)
	host, sdk := "", ""
	seen := make(map[string]bool, len(manifest.Repositories))
	for _, repository := range manifest.Repositories {
		if err := validateCompilationSource(repository, seen); err != nil {
			return "", err
		}
		seen[repository.ID] = true
		if repository.ID != "omniview" && (manifest.Links.SDKRepositoryID == nil || repository.ID != *manifest.Links.SDKRepositoryID) {
			continue
		}
		resolved, err := resolveCompilationSource(workspace, repository.Directory)
		if err != nil {
			return "", err
		}
		if repository.ID == "omniview" {
			host = resolved
		}
		if manifest.Links.SDKRepositoryID != nil && repository.ID == *manifest.Links.SDKRepositoryID {
			sdk = resolved
		}
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	if host != canonicalRoot {
		return "", errors.New("selected workspace host does not match the actual bootstrap root")
	}
	if manifest.Links.SDKRepositoryID != nil && sdk == "" {
		return "", errors.New("workspace SDK link does not select a repository")
	}
	if explicit != "" && sdk != "" {
		if !filepath.IsAbs(explicit) {
			return "", errors.New("explicit SDK source must be absolute")
		}
		canonical, err := filepath.EvalSymlinks(explicit)
		if err != nil {
			return "", err
		}
		if canonical != sdk {
			return "", errors.New("explicit and enclosing SDK selections disagree")
		}
	}
	if explicit != "" {
		return explicit, nil
	}
	return sdk, nil
}

func validateCompilationSource(source compilationSource, seen map[string]bool) error {
	validID := source.ID != "" && source.ID != "." && source.ID != ".." &&
		!strings.ContainsAny(source.ID, "/\\\x00\r\n") && !seen[source.ID]
	directory := source.Directory
	validDirectory := directory != "" && directory != "." &&
		!strings.ContainsAny(directory, "\\:\x00") && !filepath.IsAbs(directory) &&
		filepath.Clean(directory) == directory && directory != ".." &&
		!strings.HasPrefix(directory, ".."+string(filepath.Separator))
	if !validID || !validDirectory {
		return errors.New("invalid workspace bootstrap source selection")
	}
	return nil
}

func resolveCompilationSource(workspace, directory string) (string, error) {
	resolved, err := filepath.EvalSymlinks(filepath.Join(workspace, directory))
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(workspace, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("workspace bootstrap source resolves outside its selected workspace")
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("workspace bootstrap source is not a directory")
	}
	return resolved, nil
}

func compilationManifest(root string) (string, error) {
	selected := os.Getenv("OMNIVIEW_WORKSPACE_FILE")
	if selected != "" {
		if !filepath.IsAbs(selected) {
			return "", errors.New("environment workspace manifest must be absolute")
		}
		info, err := os.Stat(selected)
		if err != nil {
			return "", err
		}
		if info.IsDir() {
			selected = filepath.Join(selected, "workspace.json")
		}
	} else {
		directory, err := filepath.EvalSymlinks(root)
		if err != nil {
			return "", err
		}
		for {
			candidate := filepath.Join(directory, "workspace.json")
			if _, err := os.Stat(candidate); err == nil {
				if selected != "" {
					return "", errors.New("multiple enclosing workspace manifests; select explicitly")
				}
				selected = candidate
			} else if !os.IsNotExist(err) {
				return "", err
			} else if _, linkErr := os.Lstat(candidate); linkErr == nil {
				return "", errors.New("enclosing workspace manifest is a dangling link")
			} else if !os.IsNotExist(linkErr) {
				return "", linkErr
			}
			if filepath.Dir(directory) == directory {
				break
			}
			directory = filepath.Dir(directory)
		}
	}
	if selected == "" {
		if os.Getenv("OMNIVIEW_STATE_DIR") != "" {
			return "", errors.New("state context requires a selected workspace")
		}
		return "", nil
	}
	canonical, err := filepath.EvalSymlinks(selected)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("workspace bootstrap manifest must be a regular file")
	}
	return canonical, nil
}
