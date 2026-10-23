package devbaseline

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// strictPath rejects supplied symlink aliases, including symlinked ancestors and
// dangling symlinks. Callers on platforms with aliased temporary roots must pass
// their canonical temporary HOME, just as runtime profile resolution does.
func strictPath(path string) (string, error) {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return "", fmt.Errorf("baseline: root must be a clean absolute canonical path")
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", fmt.Errorf("baseline: symlink or aliased path is not allowed")
	}
	return canonical, nil
}

func resolveDestination(opts ImportOptions) (string, string, error) {
	p := opts.Destination
	if p.Workspace == nil || p.Descriptor.Kind != "development" || p.Descriptor.Channel != "local" || p.Descriptor.DisplayName == "" {
		return "", "", fmt.Errorf("baseline: destination must be a resolved named development profile")
	}
	home := opts.Home
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return "", "", err
		}
	}
	home, err := devcontract.CanonicalPath(home)
	if err != nil {
		return "", "", err
	}
	// Resolve the explicitly selected manifest through the canonical ownership
	// contract. It accepts default UUID roots or an established custom binding,
	// owner marker and global claim; an arbitrary environment root is not authority.
	root, err := strictPath(p.Descriptor.StateRoot)
	if err != nil {
		return "", "", err
	}
	if p.Workspace.StateRoot != root || p.Descriptor.WorkspaceID != p.Workspace.Manifest.WorkspaceID || p.Descriptor.InstanceID != p.Workspace.Manifest.WorkspaceID {
		return "", "", fmt.Errorf("baseline: destination disagrees with selected workspace identity")
	}
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: p.Workspace.ManifestPath, StateRoot: root, Home: home})
	if err != nil {
		return "", "", err
	}
	if resolved.StateRoot != root || resolved.Manifest.WorkspaceID != p.Descriptor.WorkspaceID || resolved.ManifestPath != p.Workspace.ManifestPath || resolved.Root != p.Workspace.Root {
		return "", "", fmt.Errorf("baseline: destination workspace identity changed")
	}
	return root, home, nil
}

func validateDestination(opts ImportOptions) (string, error) {
	root, _, err := resolveDestination(opts)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(root); err == nil {
		return "", ErrDestinationExists
	} else if !os.IsNotExist(err) {
		return "", err
	}
	return root, nil
}

func overlaps(a, b string) bool { return contained(a, b) || contained(b, a) }
func contained(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func regularInfo(path string) (os.FileInfo, error) {
	if _, err := strictPath(path); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("baseline: source input must be a regular independent file")
	}
	if err := independentFile(path, info); err != nil {
		return nil, err
	}
	return info, nil
}

func openRegular(path string) (*os.File, error) {
	before, err := regularInfo(path)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.Open(filepath.Base(path))
	if err != nil {
		return nil, err
	}
	after, err := regularInfo(path)
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	if !os.SameFile(before, after) || !os.SameFile(before, opened) {
		_ = file.Close()
		return nil, fmt.Errorf("baseline: source input changed identity while opening")
	}
	return file, nil
}

func verifySourceLock(path string, file *os.File) error {
	named, err := regularInfo(path)
	if err != nil {
		return err
	}
	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(named, opened) {
		return fmt.Errorf("baseline: source lock changed identity")
	}
	return nil
}
