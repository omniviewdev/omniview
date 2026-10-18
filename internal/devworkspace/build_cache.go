package devworkspace

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func prepareWorkspaceBuildCache(ctx context.Context, w Workspace, home, generation string) (directory string, resultErr error) {
	release, err := devcontract.LockProfile(ctx, home, w.Manifest.WorkspaceID)
	if err != nil {
		return "", err
	}
	defer func() { resultErr = errors.Join(resultErr, release()) }()
	if err = devcontract.EnsureDefaultProfileOwnership(home, w.Manifest.WorkspaceID); err != nil {
		return "", err
	}
	profile, err := profileFor(w, home, generation)
	if err != nil {
		return "", err
	}
	expected := filepath.Join(profile.RuntimeRoot, "go-build")
	directory, err = devsession.EnsurePrivateDirectory(expected)
	if err != nil {
		return "", err
	}
	if directory != expected {
		return "", devcontract.Fail(4, "profile_conflict", "compiler cache is redirected outside the UUID runtime")
	}
	return directory, nil
}
