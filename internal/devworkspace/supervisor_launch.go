package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// This private one-shot handoff binds a retained launch to the exact child
// started by the controller, not to a caller-selected environment value. It is
// not a sandbox against a same-user actor who can rewrite private metadata.
type supervisorLaunchAuthorization struct {
	WorkspaceID string                      `json:"workspaceID"`
	Root        string                      `json:"root"`
	Generation  string                      `json:"generation"`
	Process     devcontract.ProcessIdentity `json:"process"`
	Claimed     bool                        `json:"claimed"`
}

func validateLaunchGeneration(generation string) error {
	parsed, err := uuid.Parse(generation)
	if err != nil || parsed == uuid.Nil || parsed.String() != generation {
		return devcontract.Fail(4, "invalid_launch_generation", "launch generation must be a canonical nonzero identity")
	}
	return nil
}

func (m *Manager) supervisorLaunchAuthorizationPath(w Workspace, generation string) (string, error) {
	if err := validateLaunchGeneration(generation); err != nil {
		return "", err
	}
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "launch-"+generation+".json")
	if err := validateRecoveryPaths([]string{path}); err != nil {
		return "", err
	}
	return path, nil
}

func (m *Manager) authorizeSupervisorLaunch(ctx context.Context, w Workspace, generation string, process devcontract.ProcessIdentity) error {
	path, err := m.supervisorLaunchAuthorizationPath(w, generation)
	if err != nil {
		return err
	}
	directory, err := devsession.EnsurePrivateDirectory(filepath.Dir(path))
	if err != nil {
		return err
	}
	if directory != filepath.Dir(path) {
		return devcontract.Fail(4, "foreign_recovery", "launch authorization directory is redirected")
	}
	lock, err := devsession.AcquirePrivateLock(ctx, directory, filepath.Base(path)+".lock")
	if err != nil {
		return err
	}
	defer lock.Unlock()
	if _, err = os.Lstat(path); err == nil {
		return devcontract.Fail(4, "launch_authorization_exists", "launch authorization cannot be replaced or replayed")
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = devsession.VerifyOwnedProcess(process, devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root,
	}); err != nil {
		return err
	}
	return atomicOwnedJSON(path, supervisorLaunchAuthorization{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Generation: generation, Process: process,
	}, w.Manifest.WorkspaceID)
}

func matchingSupervisorLaunch(authorization supervisorLaunchAuthorization, w Workspace, generation string, process devcontract.ProcessIdentity) bool {
	return !authorization.Claimed && authorization.WorkspaceID == w.Manifest.WorkspaceID &&
		authorization.Root == w.Root && authorization.Generation == generation && authorization.Process == process
}

func (m *Manager) claimSupervisorLaunch(ctx context.Context, w Workspace, generation string) (devcontract.ProcessIdentity, error) {
	var process devcontract.ProcessIdentity
	path, err := m.supervisorLaunchAuthorizationPath(w, generation)
	if err != nil {
		return process, err
	}
	process, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root,
	})
	if err != nil {
		return process, err
	}
	deadline, cancel := context.WithTimeout(ctx, execCaptureTimeout)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var authorization supervisorLaunchAuthorization
		err = devsession.ReadPrivateJSON(path, &authorization)
		if os.IsNotExist(err) {
			select {
			case <-deadline.Done():
				return process, devcontract.Fail(4, "launch_authorization_missing", "assigned supervisor generation has no native launch authorization")
			case <-ticker.C:
				continue
			}
		}
		if err != nil {
			return process, err
		}
		if !matchingSupervisorLaunch(authorization, w, generation, process) {
			return process, devcontract.Fail(4, "launch_authorization_invalid", "assigned generation does not authorize this native invocation or was already claimed")
		}
		lock, lockErr := devsession.AcquirePrivateLock(deadline, filepath.Dir(path), filepath.Base(path)+".lock")
		if lockErr != nil {
			return process, lockErr
		}
		err = devsession.ReadPrivateJSON(path, &authorization)
		if err == nil && !matchingSupervisorLaunch(authorization, w, generation, process) {
			err = devcontract.Fail(4, "launch_authorization_invalid", "native launch authorization changed or was already claimed")
		}
		if err == nil {
			authorization.Claimed = true
			err = atomicOwnedJSON(path, authorization, w.Manifest.WorkspaceID)
		}
		lock.Unlock()
		return process, err
	}
}
