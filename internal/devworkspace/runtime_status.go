package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

// RuntimeHealth keeps independent observations independent. Unknown never means ready.
type RuntimeHealth struct {
	Liveness     string `json:"liveness"`
	Build        string `json:"build"`
	Dependencies string `json:"dependencies"`
	ServedSource string `json:"servedSource"`
	Readiness    string `json:"readiness"`
	HMR          string `json:"hmr"`
	SourceReload string `json:"sourceReload"`
}

type CheckoutStatus struct {
	Commit       string `json:"commit"`
	Branch       string `json:"branch,omitempty"`
	Dirty        bool   `json:"dirty"`
	SourceDigest string `json:"sourceDigest"`
	Error        string `json:"error,omitempty"`
}

func checkoutStatuses(ctx context.Context, w Workspace) map[string]CheckoutStatus {
	result := make(map[string]CheckoutStatus, len(w.Manifest.Repositories))
	for _, repository := range w.Manifest.Repositories {
		directory := filepath.Join(w.Root, repository.Directory)
		var state CheckoutStatus
		commit, err := git(ctx, directory, "", "rev-parse", "HEAD")
		if err == nil {
			state.Commit = strings.TrimSpace(commit)
			state.Branch, _ = git(ctx, directory, "", "branch", "--show-current")
			state.Branch = strings.TrimSpace(state.Branch)
			var porcelain, diff, untracked string
			porcelain, err = git(ctx, directory, "", "status", "--porcelain=v1", "--untracked-files=all")
			state.Dirty = porcelain != ""
			if err == nil {
				diff, err = git(ctx, directory, "", "diff", "HEAD", "--binary", "--no-ext-diff")
			}
			if err == nil {
				untracked, err = git(ctx, directory, "", "ls-files", "--others", "--exclude-standard", "-z")
			}
			hash := sha256.New()
			fmt.Fprintf(hash, "%s\x00%s\x00%s", state.Commit, porcelain, diff)
			for _, name := range strings.Split(untracked, "\x00") {
				if name == "" || err != nil {
					continue
				}
				var bytes []byte
				bytes, err = os.ReadFile(filepath.Join(directory, name))
				if err == nil {
					fmt.Fprintf(hash, "\x00%s\x00", name)
					hash.Write(bytes)
				}
			}
			if err == nil {
				state.SourceDigest = hex.EncodeToString(hash.Sum(nil))
			}
		}
		if err != nil {
			state.Error = "cannot inspect selected checkout"
		}
		result[repository.ID] = state
	}
	return result
}

func (s *workspaceSupervisor) observeStatus(ctx context.Context, status Status) Status {
	status.Health = RuntimeHealth{Liveness: "alive", Build: "unknown", Dependencies: "unknown", ServedSource: "unknown", Readiness: "unknown", HMR: "unverified", SourceReload: "unverified"}
	status.Checkouts = checkoutStatuses(ctx, s.workspace)
	if len(status.Builds) > 0 {
		status.Health.Build = "ready"
	}
	for node, build := range status.Builds {
		if build.Phase == "error" || build.Phase == "invalidated" {
			status.Health.Build = "failed"
			status.FailedStage = node
			status.RecoveryCommand = "omniview-dev workspace refresh " + s.workspace.Manifest.WorkspaceID
			break
		}
		if build.Phase == "building" {
			status.Health.Build = "building"
		}
	}
	if report, err := s.manager.InspectLinks(ctx, s.workspace.Manifest.WorkspaceID); err == nil && report.Phase == "linked" {
		status.Health.Dependencies = "current"
		for _, resolution := range report.Resolutions {
			if resolution.Problem != "" {
				status.Health.Dependencies = "stale"
			}
		}
	} else {
		status.Health.Dependencies = "stale"
	}
	if len(status.ServedCheckouts) > 0 {
		status.Health.ServedSource = "stale"
		if reflect.DeepEqual(status.Checkouts, status.ServedCheckouts) {
			status.Health.ServedSource = "current"
		}
	}
	for _, checkout := range status.Checkouts {
		if checkout.Error != "" {
			status.Health.ServedSource = "unknown"
		}
	}
	if status.Instance != nil {
		status.Health.Readiness = "authenticated"
	}
	for _, service := range status.Services {
		if service.Ready && service.HMR != "" {
			status.Health.HMR = "connected"
		}
	}
	return status
}
