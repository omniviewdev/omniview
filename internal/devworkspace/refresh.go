package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type RefreshOptions struct {
	Executable  string
	Diagnostics io.Writer
	Evidence    LinkProtocolEvidence
	Launch      *LaunchOptions
}

type UpdateOptions struct {
	RefreshOptions
	Repositories []string
}

type RefreshResult struct {
	WorkspaceID     string `json:"workspaceID"`
	Phase           string `json:"phase"`
	BackupDirectory string `json:"backupDirectory"`
	Status          Status `json:"status"`
}

type refreshIntent struct {
	WorkspaceID string               `json:"workspaceID"`
	Root        string               `json:"root"`
	Phase       string               `json:"phase"`
	Evidence    LinkProtocolEvidence `json:"evidence"`
	Launch      LaunchOptions        `json:"launch"`
	Refs        map[string]string    `json:"refs,omitempty"`
}

func (m *Manager) Refresh(ctx context.Context, name string, options RefreshOptions) (RefreshResult, error) {
	return m.refresh(ctx, name, options, nil)
}

// Update advances only selected tracking refs. Explicit commit pins stay pinned.
// Edit's existing ownership, clean-worktree and fast-forward checks remain final.
func (m *Manager) Update(ctx context.Context, name string, options UpdateOptions) (RefreshResult, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return RefreshResult{}, err
	}
	selected := map[string]bool{}
	for _, id := range options.Repositories {
		selected[id] = true
	}
	refs := map[string]string{}
	for _, repo := range w.Manifest.Repositories {
		if len(selected) > 0 && !selected[repo.ID] {
			continue
		}
		delete(selected, repo.ID)
		if !IsPinnedRef(repo.BaseRef) {
			refs[repo.ID] = repo.BaseRef
		}
	}
	if len(selected) > 0 {
		return RefreshResult{}, devcontract.Fail(2, "unselected_repository", "update repository must belong to selected workspace")
	}
	return m.refresh(ctx, name, options.RefreshOptions, refs)
}

func (m *Manager) refresh(ctx context.Context, name string, options RefreshOptions, refs map[string]string) (RefreshResult, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return RefreshResult{}, err
	}
	base := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID)
	canonical, err := devcontract.CanonicalPath(base)
	if err != nil {
		return RefreshResult{}, err
	}
	if canonical != base {
		return RefreshResult{}, devcontract.Fail(4, "foreign_recovery", "recovery directory cannot be redirected")
	}
	if err = os.MkdirAll(base, 0700); err != nil {
		return RefreshResult{}, err
	}
	unlock, err := tryLock(filepath.Join(base, "refresh.lock"))
	if err != nil {
		return RefreshResult{}, err
	}
	defer unlock()
	path := filepath.Join(base, "refresh.json")
	canonical, err = devcontract.CanonicalPath(path)
	if err != nil {
		return RefreshResult{}, err
	}
	if canonical != path {
		return RefreshResult{}, devcontract.Fail(4, "foreign_recovery", "refresh intent cannot be redirected")
	}
	result := RefreshResult{WorkspaceID: w.Manifest.WorkspaceID, BackupDirectory: base}
	intent := refreshIntent{}
	raw, err := os.ReadFile(path)
	if err == nil {
		if err = json.Unmarshal(raw, &intent); err != nil {
			return result, err
		}
		if intent.WorkspaceID != w.Manifest.WorkspaceID || intent.Root != w.Root {
			return result, devcontract.Fail(4, "foreign_recovery", "refresh intent identity differs from workspace")
		}
	} else if os.IsNotExist(err) {
		evidence := options.Evidence
		if evidence.Protocol == "" {
			evidence, err = m.ProtocolEvidence(ctx, name)
			if os.IsNotExist(err) {
				return result, devcontract.Fail(3, "refresh_evidence_required", "workspace has no accepted protocol proof; run the protocol probe and up with its evidence before refresh")
			}
			if err != nil {
				return result, err
			}
		}
		if err = evidence.validate(); err != nil {
			return result, err
		}
		launch, loadErr := LoadLaunchOptions(w)
		if options.Launch != nil {
			launch = *options.Launch
			loadErr = nil
		}
		if os.IsNotExist(loadErr) {
			return result, devcontract.Fail(3, "refresh_launch_required", "workspace has no saved launch configuration; run up with launch and protocol options before refresh, or supply RefreshOptions.Launch")
		}
		if loadErr != nil {
			return result, loadErr
		}
		if err = launch.Validate(); err != nil {
			return result, err
		}
		intent = refreshIntent{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "stop", Evidence: evidence, Launch: launch, Refs: refs}
		if err = atomicOwnedJSON(path, intent, w.Manifest.WorkspaceID); err != nil {
			return result, err
		}
	} else {
		return result, err
	}
	switch intent.Phase {
	case "stop", "retire", "update", "install", "start", "verify":
	default:
		return result, devcontract.Fail(4, "invalid_refresh", "refresh intent has an unknown phase")
	}
	if err = intent.Evidence.validate(); err != nil {
		return result, err
	}
	if err = intent.Launch.Validate(); err != nil {
		return result, err
	}
	save := func(phase string) error {
		intent.Phase = phase
		result.Phase = phase
		return atomicOwnedJSON(path, intent, w.Manifest.WorkspaceID)
	}
	result.Phase = intent.Phase
	if intent.Phase == "stop" {
		if _, err = m.Down(ctx, name); err != nil {
			return result, err
		}
		if err = RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
			return result, err
		}
		if err = save("retire"); err != nil {
			return result, err
		}
	}
	if intent.Phase == "retire" {
		if err = RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
			return result, err
		}
		if err = preserveGeneratedEdits(w, base); err != nil {
			return result, err
		}
		if _, err = m.RecoverLinks(ctx, name); err != nil {
			return result, err
		}
		if _, err = m.Unlink(ctx, name); err != nil {
			return result, err
		}
		if err = save("update"); err != nil {
			return result, err
		}
	}
	if intent.Phase == "update" {
		if len(intent.Refs) > 0 {
			if _, err = m.Resume(ctx, name); err != nil {
				return result, err
			}
			if _, err = m.Edit(ctx, name, EditOptions{Refs: intent.Refs}); err != nil {
				return result, err
			}
		}
		if err = save("install"); err != nil {
			return result, err
		}
	}
	if intent.Phase == "install" {
		// Retire an interrupted install before retrying; pending outputs never
		// become accepted merely because their bytes exist after a crash.
		if _, err = m.RecoverLinks(ctx, name); err != nil {
			return result, err
		}
		if _, err = m.Unlink(ctx, name); err != nil {
			return result, err
		}
		report, linkErr := m.Link(ctx, name, LinkOptions{Evidence: intent.Evidence})
		if linkErr != nil {
			var typed *devcontract.Error
			if !errors.As(linkErr, &typed) || typed.Code != "link_resolution_failed" || report.Phase != "linked" {
				return result, linkErr
			}
		}
		if err = save("start"); err != nil {
			return result, err
		}
	}
	if options.Diagnostics == nil {
		options.Diagnostics = io.Discard
	}
	if intent.Phase == "start" {
		intent.Launch.LinkEvidence = intent.Evidence
		result.Status, err = m.Status(ctx, name)
		if err != nil {
			return result, err
		}
		if result.Status.Phase != "ready" {
			result.Status, err = m.Start(ctx, name, intent.Launch, options.Executable, options.Diagnostics)
			if err != nil {
				return result, err
			}
		}
		if err = save("verify"); err != nil {
			return result, err
		}
	}
	if intent.Phase == "verify" {
		result.Status, err = m.Status(ctx, name)
		if err != nil {
			return result, err
		}
		if result.Status.Phase != "ready" {
			if result.Status.Phase == "stopped" || result.Status.Phase == "crashed" {
				if err = save("start"); err != nil {
					return result, err
				}
			}
			return result, devcontract.Fail(4, "refresh_not_ready", "refreshed workspace has not reached ready; retry refresh to resume")
		}
		if _, err = m.InspectLinks(ctx, name); err != nil {
			return result, err
		}
		if err = os.Remove(path); err != nil {
			return result, err
		}
		if err = syncDirectory(base); err != nil {
			return result, err
		}
		result.Phase = "complete"
	}
	return result, nil
}
