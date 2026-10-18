package devworkspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func refValue(ctx context.Context, common, ref string) string {
	out, _ := git(ctx, common, "", "rev-parse", "--verify", "--end-of-options", ref)
	return out
}

// preflightWorktreeAddition checks an absent/newly reselected resource without
// reserving refs or attaching a checkout. Rename uses it before output cleanup.
func preflightWorktreeAddition(ctx context.Context, root string, r *resource) error {
	path, err := devcontract.CanonicalPath(r.Path)
	if err != nil {
		return err
	}
	if path != r.Path || !inside(root, path) {
		return devcontract.Fail(4, "foreign_worktree", "owned worktree path was redirected")
	}
	if _, err = os.Lstat(path); !os.IsNotExist(err) {
		if err != nil {
			return err
		}
		return devcontract.Fail(4, "foreign_worktree", "worktree destination already exists before source selection")
	}
	marker := refValue(ctx, r.CommonDir, r.Marker)
	branch := "refs/heads/" + r.Repository.Branch
	tip := refValue(ctx, r.CommonDir, branch)
	if err = ctx.Err(); err != nil {
		return err
	}
	if marker == "" {
		refs, err := git(ctx, r.CommonDir, "", "for-each-ref", "--format=%(refname)")
		if err != nil {
			return err
		}
		plannedRefs := [2]string{branch, r.Marker}
		for _, existing := range strings.Split(refs, "\n") {
			for _, planned := range plannedRefs {
				if existing == planned || strings.HasPrefix(existing, planned+"/") || strings.HasPrefix(planned, existing+"/") {
					return devcontract.Fail(4, "occupied_branch", "source ref namespace conflicts with an existing Git ref")
				}
			}
		}
		return nil
	}
	if marker != r.Repository.BaseCommit || tip == "" || (tip != r.Repository.BaseCommit && !r.Removed) {
		return devcontract.Fail(4, "ownership_changed", "reserved feature branch or ownership marker changed")
	}
	list, err := git(ctx, r.CommonDir, "", "worktree", "list", "--porcelain")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(list, "\n") {
		if line == "branch "+branch {
			return devcontract.Fail(4, "occupied_branch", "owned branch is attached to a foreign worktree")
		}
	}
	return nil
}

func (m *Manager) addWorktree(ctx context.Context, root string, j *journal, r *resource) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := devcontract.CanonicalPath(r.Path)
	if err != nil {
		return err
	}
	if path != r.Path || !inside(root, path) {
		return devcontract.Fail(4, "foreign_worktree", "owned worktree path was redirected")
	}
	marker := refValue(ctx, r.CommonDir, r.Marker)
	branchRef := "refs/heads/" + r.Repository.Branch
	if marker == "" {
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			return devcontract.Fail(4, "foreign_worktree", "worktree destination already exists without ownership")
		}
		// Atomic create-if-absent of both refs distinguishes our interrupted
		// creation from an identically named user branch, even at the same commit.
		transaction := fmt.Sprintf("start\ncreate %s %s\ncreate %s %s\nprepare\ncommit\n", branchRef, r.Repository.BaseCommit, r.Marker, r.Repository.BaseCommit)
		if _, err = git(ctx, r.CommonDir, transaction, "update-ref", "--stdin"); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return devcontract.Fail(4, "occupied_branch", "feature branch already exists or cannot be reserved; no existing branch was attached")
		}
		marker = r.Repository.BaseCommit
	}
	tip := refValue(ctx, r.CommonDir, branchRef)
	if marker != r.Repository.BaseCommit || tip == "" || (tip != r.Repository.BaseCommit && !r.Removed) {
		return devcontract.Fail(4, "ownership_changed", "reserved feature branch or ownership marker changed")
	}
	if _, err = os.Lstat(path); os.IsNotExist(err) {
		if r.Removed {
			r.GitDir = ""
			if err = saveJournal(root, j); err != nil {
				return err
			}
		}
		if _, err = git(ctx, r.CommonDir, "", "-c", "core.hooksPath="+os.DevNull, "worktree", "add", "--", path, r.Repository.Branch); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if err = verifyWorktree(ctx, r, false); err != nil {
		return err
	}
	r.GitDir, err = git(ctx, path, "", "rev-parse", "--absolute-git-dir")
	if err != nil {
		return err
	}
	r.GitDir, err = devcontract.CanonicalPath(r.GitDir)
	if err != nil {
		return err
	}
	r.Removed = false
	return saveJournal(root, j)
}

func verifyWorktree(ctx context.Context, r *resource, clean bool) error {
	path, err := devcontract.CanonicalPath(r.Path)
	if err != nil {
		return err
	}
	if path != r.Path {
		return devcontract.Fail(4, "foreign_worktree", "worktree path resolves through a symlink")
	}
	common, err := git(ctx, path, "", "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return devcontract.Fail(4, "foreign_worktree", "owned worktree is missing or no longer a Git checkout")
	}
	common, err = devcontract.CanonicalPath(common)
	if err != nil {
		return err
	}
	if common != r.CommonDir {
		return devcontract.Fail(4, "foreign_worktree", "worktree now belongs to another Git repository")
	}
	gitDir, err := git(ctx, path, "", "rev-parse", "--absolute-git-dir")
	if err != nil {
		return err
	}
	gitDir, err = devcontract.CanonicalPath(gitDir)
	if err != nil {
		return err
	}
	if r.GitDir != "" && gitDir != r.GitDir {
		return devcontract.Fail(4, "foreign_worktree", "worktree administrative identity changed")
	}
	if gitDir == common || !inside(filepath.Join(common, "worktrees"), gitDir) {
		return devcontract.Fail(4, "foreign_worktree", "resource is not a linked worktree")
	}
	branch, err := git(ctx, path, "", "symbolic-ref", "--quiet", "HEAD")
	if err != nil || branch != "refs/heads/"+r.Repository.Branch {
		return devcontract.Fail(4, "foreign_worktree", "worktree is no longer on its owned branch")
	}
	marker := refValue(ctx, common, r.Marker)
	if marker != r.Repository.BaseCommit {
		return devcontract.Fail(4, "ownership_changed", "Git ownership marker does not match the journal")
	}
	if clean {
		status, err := git(ctx, path, "", "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching")
		if err != nil {
			return err
		}
		if status != "" {
			return devcontract.Fail(4, "dirty_worktree", "worktree contains tracked, untracked or ignored changes; no forced cleanup is allowed")
		}
	}
	return nil
}

func (m *Manager) updateRef(ctx context.Context, root string, j *journal, r *resource, desired devcontract.Repository) error {
	head := refValue(ctx, r.CommonDir, "refs/heads/"+r.Repository.Branch)
	marker := refValue(ctx, r.CommonDir, r.Marker)
	probe := *r
	if r.RefTarget == desired.BaseCommit && head == desired.BaseCommit && marker == desired.BaseCommit {
		probe.Repository.BaseCommit = desired.BaseCommit
	}
	if err := verifyWorktree(ctx, &probe, true); err != nil {
		return err
	}
	if head != r.Repository.BaseCommit && !(r.RefTarget == desired.BaseCommit && head == desired.BaseCommit) {
		return devcontract.Fail(4, "user_commits", "source ref change would replace user commits; preserve them on the feature branch")
	}
	if head != desired.BaseCommit {
		if _, err := git(ctx, r.CommonDir, "", "merge-base", "--is-ancestor", r.Repository.BaseCommit, desired.BaseCommit); err != nil {
			return devcontract.Fail(4, "non_fast_forward", "source ref edit cannot rewrite feature history")
		}
	}
	if r.RefTarget == "" {
		r.RefTarget = desired.BaseCommit
		if err := saveJournal(root, j); err != nil {
			return err
		}
	}
	if head != desired.BaseCommit {
		// Fast-forward only: never reset, force-checkout or rewrite a user branch.
		if _, err := git(ctx, r.Path, "", "-c", "core.hooksPath="+os.DevNull, "merge", "--ff-only", "--no-edit", desired.BaseCommit); err != nil {
			return err
		}
	}
	if marker != desired.BaseCommit {
		if _, err := git(ctx, r.CommonDir, "", "update-ref", r.Marker, desired.BaseCommit, r.Repository.BaseCommit); err != nil {
			return err
		}
	}
	r.Repository = desired
	r.RefTarget = ""
	return saveJournal(root, j)
}

func removeWorktree(ctx context.Context, r *resource) error {
	if _, err := os.Lstat(r.Path); os.IsNotExist(err) {
		// A crash after Git removal is safe to resume only if the original admin
		// directory disappeared too. A manually moved worktree is not ours to prune.
		if r.GitDir != "" {
			if _, e := os.Stat(r.GitDir); !os.IsNotExist(e) {
				return devcontract.Fail(4, "foreign_worktree", "owned worktree was moved or its Git registration remains")
			}
		}
		return nil
	} else if err != nil {
		return err
	}
	if err := verifyWorktree(ctx, r, true); err != nil {
		return err
	}
	_, err := git(ctx, r.CommonDir, "", "worktree", "remove", "--", r.Path)
	return err
}

func deleteOwnedBranch(ctx context.Context, r *resource) error {
	branch := "refs/heads/" + r.Repository.Branch
	marker := refValue(ctx, r.CommonDir, r.Marker)
	tip := refValue(ctx, r.CommonDir, branch)
	if err := ctx.Err(); err != nil {
		return err
	}
	if marker == "" && tip == "" {
		return nil
	}
	if marker != r.Repository.BaseCommit || tip != r.Repository.BaseCommit {
		return devcontract.Fail(4, "user_commits", "branch or ownership marker changed; branch deletion would lose user commits")
	}
	// Refuse deletion if a user attached the retained branch to another worktree.
	list, err := git(ctx, r.CommonDir, "", "worktree", "list", "--porcelain")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(list, "\n") {
		if line == "branch "+branch {
			return devcontract.Fail(4, "occupied_branch", "owned branch remains checked out in another worktree")
		}
	}
	transaction := fmt.Sprintf("start\ndelete %s %s\ndelete %s %s\nprepare\ncommit\n", branch, tip, r.Marker, marker)
	_, err = git(ctx, r.CommonDir, transaction, "update-ref", "--stdin")
	return err
}
