package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type ReconfigureResult struct {
	Workspace
	Links             *LinkReport `json:"links,omitempty"`
	RequiresBootstrap bool        `json:"requiresBootstrap"`
}

// Reconfigure preserves A03's durable intent transaction. Validation failures
// restore the previous link graph; interrupted Git mutations remain resumable,
// not falsely advertised as an atomic inverse of user edits.
func (m *Manager) Reconfigure(ctx context.Context, name string, options EditOptions) (ReconfigureResult, error) {
	before, err := m.Inspect(ctx, name)
	if err != nil {
		return ReconfigureResult{}, err
	}
	unlock, err := withWorkspaceOperation(ctx, before)
	if err != nil {
		return ReconfigureResult{}, err
	}
	defer unlock()
	if err = RequireStopped(ctx, before.ResolvedWorkspace); err != nil {
		return ReconfigureResult{}, err
	}
	evidence, linkErr := m.LinkEvidence(ctx, name)
	linked := linkErr == nil
	if linkErr != nil && !os.IsNotExist(linkErr) {
		return ReconfigureResult{}, linkErr
	}
	if linked {
		if _, err = m.Unlink(ctx, name); err != nil {
			return ReconfigureResult{}, err
		}
	}
	after, editErr := m.Edit(ctx, name, options)
	if editErr != nil {
		current, inspectErr := m.Inspect(ctx, before.Manifest.WorkspaceID)
		if inspectErr == nil && current.Phase == "complete" && sameManifest(current.Manifest, before.Manifest) {
			if linked {
				report, restoreErr := m.Link(ctx, before.Manifest.WorkspaceID, LinkOptions{Evidence: evidence})
				if restoreErr != nil {
					return ReconfigureResult{Workspace: current, Links: &report}, fmt.Errorf("edit was rejected; previous dependency restoration requires attention: %w", restoreErr)
				}
			}
			return ReconfigureResult{Workspace: current}, editErr
		}
		return ReconfigureResult{Workspace: current, RequiresBootstrap: true}, devcontract.Fail(4, "edit_pending", "workspace edit has durable partial intent; use workspace resume before up; no user work was reset")
	}
	if err = ReconcileGeneratedRoot(after); err != nil {
		return ReconfigureResult{Workspace: after, RequiresBootstrap: true}, err
	}
	result := ReconfigureResult{Workspace: after, RequiresBootstrap: linked}
	if linked {
		report, err := m.Link(ctx, after.Manifest.WorkspaceID, LinkOptions{Evidence: evidence})
		result.Links = &report
		if err != nil {
			var typed *devcontract.Error
			if !errors.As(err, &typed) || typed.Code != "link_resolution_failed" || report.Phase != "linked" {
				return result, err
			}
		}
	}
	return result, nil
}

// RemoveWorkspace performs producer-owned teardown before A03's foreign-file
// preflight, while a stable external operation guard excludes concurrent up.
// State and branches are retained unless the caller explicitly selects deletion.
func (m *Manager) RemoveWorkspace(ctx context.Context, name string, options RemoveOptions, diagnostics io.Writer) (RemoveResult, error) {
	validate, before := options.ValidateGenerated, options.BeforeRemove
	options.ValidateGenerated = func(ctx context.Context, w Workspace) error {
		if err := ValidateGenerated(ctx, w); err != nil {
			return err
		}
		if validate != nil {
			return validate(ctx, w)
		}
		return nil
	}
	options.BeforeRemove = func(ctx context.Context, w Workspace, guards []GuardFile) error {
		if before != nil {
			if err := before(ctx, w, guards); err != nil {
				return err
			}
		}
		if options.PurgeState && runtime.GOOS == "darwin" {
			binary, err := prepareNativeSnapshot(w)
			if err != nil {
				return err
			}
			if binary != "" {
				if err = runNativeRemovalCommand(ctx, w, guards, LaunchOptions{Mode: "native"}, binary, diagnostics); err != nil {
					return err
				}
			}
		}
		return CleanGenerated(w)
	}
	w, err := m.Inspect(ctx, name)
	if err != nil {
		receipt, receiptErr := m.findRetirement(name)
		if receiptErr != nil {
			return RemoveResult{}, err
		}
		result, removeErr := m.Remove(ctx, name, options)
		if removeErr != nil {
			return result, removeErr
		}
		state := receipt.SelectedStateRoot
		if state == "" {
			state, _ = m.defaultStateRoot(receipt.WorkspaceID)
		}
		owned := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: receipt.Root, Manifest: receipt.Manifest, StateRoot: state}}
		return result, cleanupNativeSnapshot(owned)
	}
	unlock, err := withWorkspaceOperation(ctx, w)
	if err != nil {
		return RemoveResult{}, err
	}
	defer unlock()
	if err = RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
		return RemoveResult{}, err
	}
	// Restoring dependency overlays is reversible and validates their exact hashes.
	// A03 then performs ALL canonical refusal checks before native side effects.
	if _, err = m.Unlink(ctx, name); err != nil {
		return RemoveResult{}, err
	}
	result, err := m.Remove(ctx, name, options)
	if err != nil {
		return result, err
	}
	if runtime.GOOS == "darwin" {
		if err = cleanupNativeSnapshot(w); err != nil {
			return result, err
		}
	}
	return result, nil
}

type nativeProfileUse struct {
	WorkspaceID string `json:"workspaceID"`
	Binary      string `json:"binary"`
	Generation  string `json:"generation"`
}
