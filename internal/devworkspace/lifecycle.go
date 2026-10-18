package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type RemoveOptions struct {
	PurgeState     bool
	DeleteBranches bool
	// ValidateGenerated must validate every non-lifecycle .local resource and
	// nested generated tree against its external ownership ledger, without mutation.
	ValidateGenerated func(context.Context, Workspace) error
	// BeforeRemove runs after every refusal preflight, while UUID/state guards
	// remain held, and before journal/Git/profile mutation. It may complete native
	// cleanup then remove only proven generated resources. Errors retain sources.
	BeforeRemove func(context.Context, Workspace, []GuardFile) error
}

// GuardFile borrows a retained Darwin BSD-flock open file description. Roles are
// exactly uuid, selected-state, and distinct default-state. Callback callers may
// pass duplicates via Cmd.ExtraFiles, but MUST NOT close/unlock the parent file.
// The native child closes its inherited copies WITHOUT explicitly unlocking.
// Other platforms retain ordinary guards and supply no native FD capabilities.
type GuardFile struct {
	Role string
	File *os.File
}

type RemoveResult struct {
	WorkspaceID      string `json:"workspaceID"`
	StateRoot        string `json:"stateRoot"`
	StateRetained    bool   `json:"stateRetained"`
	BranchesRetained bool   `json:"branchesRetained"`
}

func (m *Manager) Create(ctx context.Context, opts CreateOptions) (Workspace, error) {
	if err := ctx.Err(); err != nil {
		return Workspace{}, err
	}
	unlock, err := lockRoot(m.Root)
	if err != nil {
		return Workspace{}, err
	}
	defer unlock()
	reg, err := LoadRegistry(m.Root)
	if err != nil {
		return Workspace{}, err
	}
	manifest, err := m.plan(ctx, reg, opts)
	if err != nil {
		return Workspace{}, err
	}
	profileRelease, err := devcontract.LockProfile(ctx, m.options.Home, manifest.WorkspaceID)
	if err != nil {
		return Workspace{}, err
	}
	defer profileRelease()
	stage, j, err := m.prepareCreate(manifest, reg)
	if err != nil {
		return Workspace{}, err
	}
	root, err := m.publishCreate(stage, j)
	if err != nil {
		return Workspace{}, err
	}
	if err = m.apply(ctx, root, j); err != nil {
		return Workspace{}, err
	}
	return m.Inspect(ctx, j.WorkspaceID)
}

func (m *Manager) prepareCreate(manifest devcontract.WorkspaceManifest, reg Registry) (string, *journal, error) {
	if _, err := m.workspaceRoot(manifest.Slug); err == nil {
		return "", nil, devcontract.Fail(4, "workspace_exists", "workspace has a durable published or staged intent; explicitly resume it")
	} else {
		var target *devcontract.Error
		if !errors.As(err, &target) || target.Code != "missing_workspace" {
			return "", nil, err
		}
	}
	if pending, err := m.findRetirement(manifest.Slug); err != nil {
		return "", nil, err
	} else if pending != nil {
		return "", nil, devcontract.Fail(4, "workspace_exists", "finish the owned retirement before reusing its workspace name")
	}
	root := filepath.Join(m.Root, "workspaces", manifest.Slug)
	canonical, err := devcontract.CanonicalPath(root)
	if err != nil {
		return "", nil, err
	}
	if canonical != root {
		return "", nil, devcontract.Fail(4, "foreign_workspace", "workspace destination is redirected through a symlink")
	}
	if _, err = os.Lstat(root); !os.IsNotExist(err) {
		return "", nil, devcontract.Fail(4, "workspace_exists", "workspace destination exists; explicitly resume an interrupted owned create")
	}
	if err = os.MkdirAll(filepath.Dir(root), 0700); err != nil {
		return "", nil, err
	}
	stage := filepath.Join(filepath.Dir(root), ".create-"+manifest.WorkspaceID)
	if err = os.Mkdir(stage, 0700); err != nil {
		return "", nil, err
	}
	j := newJournal(root, manifest, reg)
	j.StageRoot = stage
	if err = saveJournal(stage, j); err != nil {
		return stage, j, err
	}
	if err = writeManifest(stage, manifest); err != nil {
		return stage, j, err
	}
	return stage, j, syncDirectory(stage)
}

func (m *Manager) publishCreate(root string, j *journal) (string, error) {
	if root == j.Root {
		return root, nil
	}
	if root != j.StageRoot || filepath.Dir(root) != filepath.Join(m.Root, "workspaces") {
		return "", devcontract.Fail(4, "invalid_journal", "create publication has no matching owned stage")
	}
	if err := recoverOwnedStaging(root, j); err != nil {
		return "", err
	}
	if _, err := os.Lstat(j.Root); !os.IsNotExist(err) {
		return "", devcontract.Fail(4, "workspace_exists", "workspace destination became occupied before publication")
	}
	if err := os.Rename(root, j.Root); err != nil {
		return "", err
	}
	if err := syncDirectory(filepath.Dir(j.Root)); err != nil {
		return "", err
	}
	return j.Root, nil
}

func (m *Manager) Resume(ctx context.Context, name string) (Workspace, error) {
	unlock, err := lockRoot(m.Root)
	if err != nil {
		return Workspace{}, err
	}
	defer unlock()
	root, err := m.workspaceRoot(name)
	if err != nil {
		return Workspace{}, err
	}
	j, err := loadJournal(root)
	if err != nil {
		return Workspace{}, err
	}
	if j.Phase == "create" {
		root, err = m.publishCreate(root, j)
		if err != nil {
			return Workspace{}, err
		}
	}
	if j.Phase == "remove" {
		return Workspace{}, devcontract.Fail(4, "removal_pending", "resume removal with workspace remove using the original flags")
	}
	if j.Phase == "rollback" {
		return Workspace{}, devcontract.Fail(4, "rollback_pending", "resume rollback with workspace rollback")
	}
	if j.Phase == "complete" {
		if err = checkManifest(root, j); err != nil {
			return Workspace{}, err
		}
		return m.inspectRoot(root)
	}
	if j.Phase != "create" && j.Phase != "edit" && j.Phase != "rename" {
		return Workspace{}, devcontract.Fail(4, "invalid_phase", "workspace journal has an unknown lifecycle phase")
	}
	if _, err = os.Stat(filepath.Join(root, "workspace.json")); os.IsNotExist(err) {
		if err = writeManifest(root, j.Manifest); err != nil {
			return Workspace{}, err
		}
	}
	w, err := m.inspectRoot(root)
	if err != nil {
		return Workspace{}, err
	}
	stopUnlock, err := m.lockStopped(ctx, w.ResolvedWorkspace)
	if err != nil {
		return Workspace{}, err
	}
	defer stopUnlock()
	if err = m.captureProfileBinding(w.ResolvedWorkspace, j); err != nil {
		return Workspace{}, err
	}
	if err = m.apply(ctx, root, j); err != nil {
		return Workspace{}, err
	}
	return m.Inspect(ctx, j.WorkspaceID)
}

func checkManifest(root string, j *journal) error {
	manifest, err := readManifest(root)
	if err != nil {
		return err
	}
	if !sameManifest(manifest, j.Manifest) {
		return devcontract.Fail(4, "manifest_changed", "manifest differs from the owned lifecycle journal; use workspace edit rather than manual mutation")
	}
	return nil
}

func (m *Manager) apply(ctx context.Context, root string, j *journal) error {
	if j.Phase == "rename" {
		return m.finishRename(ctx, root, j)
	}
	if j.Phase == "edit" && j.RenameTo != "" {
		// The validated edit intent precedes cleanup. Resume finishes the same
		// attested deletion plan before applying any source changes or rename.
		w, err := m.inspectRoot(root)
		if err != nil {
			return err
		}
		if _, err = prepareNativeSnapshot(w); err != nil {
			return err
		}
		if err = RestoreRepositoryOutputs(ctx, w); err != nil {
			return err
		}
		if err = CleanGenerated(w); err != nil {
			return err
		}
		if err = preflightFiles(root, j); err != nil {
			return err
		}
	}
	selected := map[string]devcontract.Repository{}
	for _, repo := range j.Manifest.Repositories {
		selected[repo.ID] = repo
	}
	for i := range j.Resources {
		if err := ctx.Err(); err != nil {
			return err
		}
		r := &j.Resources[i]
		desired, wanted := selected[r.Repository.ID]
		if !wanted {
			continue
		}
		if r.GitDir == "" || r.Removed {
			if err := m.addWorktree(ctx, root, j, r); err != nil {
				return err
			}
		}
		if r.Repository.BaseCommit != desired.BaseCommit || r.RefTarget != "" {
			if err := m.updateRef(ctx, root, j, r, desired); err != nil {
				return err
			}
		} else {
			if err := verifyWorktree(ctx, r, false); err != nil {
				return err
			}
			r.Repository = desired
		}
	}
	for i := range j.Resources {
		r := &j.Resources[i]
		if _, wanted := selected[r.Repository.ID]; wanted || r.Removed {
			continue
		}
		if err := removeWorktree(ctx, r); err != nil {
			return err
		}
		r.Removed = true
		if err := saveJournal(root, j); err != nil {
			return err
		}
	}
	if j.RenameTo != "" {
		j.Phase = "rename"
		if err := saveJournal(root, j); err != nil {
			return err
		}
		return m.finishRename(ctx, root, j)
	}
	if err := writeManifest(root, j.Manifest); err != nil {
		return err
	}
	w, err := m.inspectRoot(root)
	if err != nil {
		return err
	}
	if err = m.ensureProfileOwner(w.ResolvedWorkspace); err != nil {
		return err
	}
	if err = m.captureProfileBinding(w.ResolvedWorkspace, j); err != nil {
		return err
	}
	j.Phase, j.StageRoot = "complete", ""
	return saveJournal(root, j)
}

func (m *Manager) Edit(ctx context.Context, name string, opts EditOptions) (Workspace, error) {
	unlock, err := lockRoot(m.Root)
	if err != nil {
		return Workspace{}, err
	}
	defer unlock()
	root, err := m.workspaceRoot(name)
	if err != nil {
		return Workspace{}, err
	}
	j, err := loadJournal(root)
	if err != nil {
		return Workspace{}, err
	}
	if j.Phase != "complete" {
		return Workspace{}, devcontract.Fail(4, "workspace_incomplete", "resume or roll back pending lifecycle operation first")
	}
	if err = checkManifest(root, j); err != nil {
		return Workspace{}, err
	}
	w, err := m.inspectRoot(root)
	if err != nil {
		return Workspace{}, err
	}
	stopUnlock, err := m.lockStopped(ctx, w.ResolvedWorkspace)
	if err != nil {
		return Workspace{}, err
	}
	defer stopUnlock()
	if err = m.captureProfileBinding(w.ResolvedWorkspace, j); err != nil {
		return Workspace{}, err
	}
	old := j.Manifest
	repos, plugins := map[string]bool{}, map[string]bool{}
	for _, r := range old.Repositories {
		repos[r.ID] = true
	}
	for _, p := range old.Plugins {
		plugins[p.ID] = true
	}
	for _, id := range opts.RemovePlugins {
		if !plugins[id] {
			return Workspace{}, devcontract.Fail(2, "missing_selection", "plugin to remove is not selected")
		}
		delete(plugins, id)
	}
	for _, id := range opts.AddPlugins {
		if plugins[id] {
			return Workspace{}, devcontract.Fail(2, "duplicate_selection", "plugin is already selected")
		}
		plugins[id] = true
	}
	for _, id := range opts.RemoveRepositories {
		if id == "omniview" {
			return Workspace{}, devcontract.Fail(2, "missing_host", "host cannot be removed")
		}
		if !repos[id] {
			return Workspace{}, devcontract.Fail(2, "missing_selection", "repository to remove is not selected")
		}
		for _, p := range old.Plugins {
			if p.RepositoryID == id && plugins[p.ID] {
				return Workspace{}, devcontract.Fail(2, "plugin_source_required", "remove the plugin selection before removing its source repository")
			}
		}
		delete(repos, id)
	}
	for _, id := range opts.AddRepositories {
		if repos[id] {
			return Workspace{}, devcontract.Fail(2, "duplicate_selection", "repository is already selected")
		}
		repos[id] = true
	}
	create := CreateOptions{Slug: old.Slug, DisplayName: old.DisplayName, Baseline: old.Profile.Baseline, Refs: map[string]string{}, Ports: opts.Ports, workspaceID: old.WorkspaceID}
	if opts.Slug != nil {
		create.Slug = *opts.Slug
	}
	if opts.DisplayName != nil {
		create.DisplayName = *opts.DisplayName
		if create.DisplayName == "" {
			return Workspace{}, devcontract.Fail(2, "invalid_name", "display name cannot be empty")
		}
	}
	for id := range repos {
		create.Repositories = append(create.Repositories, id)
	}
	for id := range plugins {
		create.Plugins = append(create.Plugins, id)
	}
	// Unchanged refs stay pinned even if the source's main branch advanced.
	for _, r := range j.Resources {
		if repos[r.Repository.ID] {
			create.Refs[r.Repository.ID] = r.Repository.BaseCommit
		}
	}
	for id, ref := range opts.Refs {
		create.Refs[id] = ref
	}
	reg, err := LoadRegistry(m.Root)
	if err != nil {
		return Workspace{}, err
	}
	desired, err := m.plan(ctx, reg, create)
	if err != nil {
		return Workspace{}, err
	}
	if desired.Slug != old.Slug {
		if err = preflightWorkspaceFiles(root, j, true); err != nil {
			return Workspace{}, err
		}
		if err = ValidateGenerated(ctx, w); err != nil {
			return Workspace{}, err
		}
		if err = ValidateRepositoryOutputs(ctx, w); err != nil {
			return Workspace{}, err
		}
		j.RenameTo = filepath.Join(m.Root, "workspaces", desired.Slug)
		if _, e := os.Lstat(j.RenameTo); !os.IsNotExist(e) {
			return Workspace{}, devcontract.Fail(4, "workspace_exists", "renamed workspace destination already exists")
		}
		canonical, e := devcontract.CanonicalPath(j.RenameTo)
		if e != nil {
			return Workspace{}, e
		}
		if canonical != j.RenameTo {
			return Workspace{}, devcontract.Fail(4, "foreign_workspace", "rename target cannot be redirected through a symlink")
		}
	}
	if opts.Ports == nil {
		desired.Ports = copyWorkspacePortPolicy(old.Ports)
	}
	desired.Links.HostPackages = old.Links.HostPackages
	for i := range desired.Repositories {
		for _, previous := range j.Resources {
			if desired.Repositories[i].ID == previous.Repository.ID {
				desired.Repositories[i].Branch = previous.Repository.Branch
				if _, changed := opts.Refs[previous.Repository.ID]; !changed {
					desired.Repositories[i].BaseRef = previous.Repository.BaseRef
				}
			}
		}
	}
	// Reconfigure restores dependency/producer overlays before Edit. A rename
	// must validate every clean worktree and ref before retiring generated output;
	// non-rename edits retain their existing producer restoration behavior.
	outputsRestored := false
	for i := range j.Resources {
		r := &j.Resources[i]
		if r.Removed {
			continue
		}
		var target *devcontract.Repository
		for k := range desired.Repositories {
			if desired.Repositories[k].ID == r.Repository.ID {
				target = &desired.Repositories[k]
			}
		}
		mutating := target == nil || target.BaseCommit != r.Repository.BaseCommit || j.RenameTo != ""
		if mutating && !outputsRestored && j.RenameTo == "" {
			if err = RestoreRepositoryOutputs(ctx, w); err != nil {
				return Workspace{}, err
			}
			outputsRestored = true
		}
		if err = verifyWorktree(ctx, r, mutating); err != nil {
			return Workspace{}, err
		}
		if target != nil && target.BaseCommit != r.Repository.BaseCommit {
			if refValue(ctx, r.CommonDir, "refs/heads/"+r.Repository.Branch) != r.Repository.BaseCommit {
				return Workspace{}, devcontract.Fail(4, "user_commits", "source ref edit would replace user commits")
			}
			if _, err = git(ctx, r.CommonDir, "", "merge-base", "--is-ancestor", r.Repository.BaseCommit, target.BaseCommit); err != nil {
				return Workspace{}, devcontract.Fail(4, "non_fast_forward", "source ref edits must fast-forward the owned branch; no branch history is rewritten")
			}
		}
	}
	for _, repo := range desired.Repositories {
		found := false
		for i := range j.Resources {
			if j.Resources[i].Repository.ID == repo.ID {
				found = true
				if j.Resources[i].Removed && j.Resources[i].Repository.BaseCommit != repo.BaseCommit {
					return Workspace{}, devcontract.Fail(4, "retained_branch", "reselect retained source at its previous base before changing its ref")
				}
			}
		}
		if !found {
			for _, source := range reg.Repositories {
				if source.ID == repo.ID {
					j.Resources = append(j.Resources, makeResource(root, old.WorkspaceID, repo, source))
				}
			}
		}
	}
	if j.RenameTo != "" {
		for i := range j.Resources {
			r := &j.Resources[i]
			if r.GitDir != "" && !r.Removed {
				continue
			}
			for _, repo := range desired.Repositories {
				if repo.ID == r.Repository.ID {
					if err = preflightWorktreeAddition(ctx, root, r); err != nil {
						return Workspace{}, err
					}
					break
				}
			}
		}
		if err = ctx.Err(); err != nil {
			return Workspace{}, err
		}
		// Preserve the original UUID-scoped native bundle before its attested
		// build tree is retired; a later purge still needs its real callback.
		if _, err = prepareNativeSnapshot(w); err != nil {
			return Workspace{}, err
		}
	}
	j.Manifest, j.Phase = desired, "edit"
	if err = saveJournal(root, j); err != nil {
		return Workspace{}, err
	}
	if err = m.apply(ctx, root, j); err != nil {
		return Workspace{}, err
	}
	return m.Inspect(ctx, j.WorkspaceID)
}

func (m *Manager) finishRename(ctx context.Context, root string, j *journal) error {
	target := j.RenameTo
	if target == "" || filepath.Dir(target) != filepath.Join(m.Root, "workspaces") || filepath.Base(target) != j.Manifest.Slug {
		return devcontract.Fail(4, "invalid_journal", "workspace rename intent has an invalid target")
	}
	if root != target {
		if root != j.Root {
			return devcontract.Fail(4, "invalid_journal", "rename source differs from its ownership journal")
		}
		if err := preflightFiles(root, j); err != nil {
			return err
		}
		if _, err := os.Lstat(target); !os.IsNotExist(err) {
			return devcontract.Fail(4, "workspace_exists", "rename destination is occupied")
		}
		// Rename the whole owned directory atomically, then repair Git's reverse
		// administrative pointers. The persisted intent remains inside the moved
		// directory, so interruption before/during repair is explicitly resumable.
		if err := os.Rename(root, target); err != nil {
			return err
		}
	}
	for i := range j.Resources {
		r := &j.Resources[i]
		if r.Removed {
			continue
		}
		probe := *r
		probe.Path = filepath.Join(target, r.Repository.Directory)
		if err := verifyWorktree(ctx, &probe, true); err != nil {
			return err
		}
		if _, err := git(ctx, r.CommonDir, "", "worktree", "repair", "--", probe.Path); err != nil {
			return err
		}
	}
	for i := range j.Resources {
		j.Resources[i].Path = filepath.Join(target, j.Resources[i].Repository.Directory)
	}
	j.Root, j.RenameTo, j.Phase = target, "", "complete"
	if err := writeManifest(target, j.Manifest); err != nil {
		return err
	}
	return saveJournal(target, j)
}

func (m *Manager) lockStopped(ctx context.Context, w devcontract.ResolvedWorkspace) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if m.options.Stopped == nil {
		return nil, devcontract.Fail(4, "stop_check_required", "a session-aware stopped guard is required before editing or removing owned resources")
	}
	parentRelease, err := devcontract.LockProfile(ctx, m.options.Home, w.Manifest.WorkspaceID)
	if err != nil {
		return nil, err
	}
	rootRelease := func() {}
	defaultRelease := func() {}
	unlock := func() { defaultRelease(); rootRelease(); _ = parentRelease() }
	if _, e := os.Stat(filepath.Dir(w.StateRoot)); e == nil {
		if e = m.ensureProfileOwner(w); e != nil {
			unlock()
			return nil, e
		}
	} else if !os.IsNotExist(e) {
		unlock()
		return nil, e
	}
	if _, err = os.Stat(w.StateRoot); err == nil {
		lockPath := filepath.Join(w.StateRoot, ".lock")
		canonical, e := devcontract.CanonicalPath(lockPath)
		if e != nil {
			unlock()
			return nil, e
		}
		if canonical != lockPath {
			unlock()
			return nil, devcontract.Fail(4, "foreign_profile", "profile lock cannot be a symlink")
		}
		rootRelease, err = tryLock(lockPath)
		if err != nil {
			_ = parentRelease()
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		unlock()
		return nil, err
	}
	defaultState, err := m.defaultStateRoot(w.Manifest.WorkspaceID)
	if err != nil {
		unlock()
		return nil, err
	}
	if defaultState != w.StateRoot {
		if _, err = os.Stat(defaultState); err == nil {
			if err = devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID); err != nil {
				unlock()
				return nil, err
			}
			lockPath := filepath.Join(defaultState, ".lock")
			canonical, e := devcontract.CanonicalPath(lockPath)
			if e != nil {
				unlock()
				return nil, e
			}
			if canonical != lockPath {
				unlock()
				return nil, devcontract.Fail(4, "foreign_profile", "default state lock cannot be a symlink")
			}
			release, e := tryLock(lockPath)
			if e != nil {
				unlock()
				return nil, e
			}
			defaultRelease = release
		} else if !os.IsNotExist(err) {
			unlock()
			return nil, err
		}
	}
	// Hold the stable guard even when no state root exists. Baseline publication
	// and startup use this same guard; never scaffold state merely to lock it.
	if err = m.options.Stopped(ctx, w); err != nil {
		unlock()
		return nil, err
	}
	return unlock, nil
}

func (m *Manager) ensureProfileOwner(w devcontract.ResolvedWorkspace) error {
	defaultState, err := m.defaultStateRoot(w.Manifest.WorkspaceID)
	if err != nil {
		return err
	}
	if w.StateRoot != defaultState {
		return devcontract.ValidateCustomProfileClaim(w.StateRoot, w.Manifest.WorkspaceID, m.options.Home)
	}
	return devcontract.EnsureDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID)
}

func (m *Manager) verifyProfileOwner(w devcontract.ResolvedWorkspace) error {
	defaultState, err := m.defaultStateRoot(w.Manifest.WorkspaceID)
	if err != nil {
		return err
	}
	if w.StateRoot != defaultState {
		return devcontract.ValidateCustomProfileClaim(w.StateRoot, w.Manifest.WorkspaceID, m.options.Home)
	}
	return devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID)
}

func profileBindingDigest(root string) (string, error) {
	path := filepath.Join(root, ".local", "profile.json")
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", devcontract.Fail(4, "foreign_profile", "profile binding is not an owned regular file")
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", devcontract.Fail(4, "foreign_profile", "profile binding cannot be redirected through a symlink")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:]), nil
}

func checkProfileBindingFile(root string, j *journal) error {
	if j.ProfileBindingSHA256 == "" || j.SelectedStateRoot == "" {
		return devcontract.Fail(4, "foreign_profile", "profile binding has no validated lifecycle ownership snapshot")
	}
	digest, err := profileBindingDigest(root)
	if err != nil {
		return err
	}
	if digest != j.ProfileBindingSHA256 {
		return devcontract.Fail(4, "profile_binding_changed", "profile binding differs from its validated lifecycle snapshot")
	}
	return nil
}

func (m *Manager) captureProfileBinding(w devcontract.ResolvedWorkspace, j *journal) error {
	if j.Phase != "complete" && j.SelectedStateRoot != "" && j.SelectedStateRoot != w.StateRoot {
		return devcontract.Fail(4, "profile_binding_changed", "profile selection changed during a pending lifecycle operation")
	}
	state, present, err := devcontract.ReadCustomProfileBinding(w.Root, w.Manifest.WorkspaceID, m.options.Home)
	if err != nil {
		return err
	}
	digest := ""
	if present {
		if state != w.StateRoot {
			return devcontract.Fail(4, "profile_binding_changed", "resolved state differs from its owned profile binding")
		}
		digest, err = profileBindingDigest(w.Root)
		if err != nil {
			return err
		}
	} else {
		expected, e := m.defaultStateRoot(w.Manifest.WorkspaceID)
		if e != nil {
			return e
		}
		if w.StateRoot != expected {
			return devcontract.Fail(4, "profile_binding_changed", "custom state has no local profile binding")
		}
	}
	if j.Phase != "complete" && j.ProfileBindingSHA256 != "" && j.ProfileBindingSHA256 != digest {
		return devcontract.Fail(4, "profile_binding_changed", "profile binding contents changed during a pending lifecycle operation")
	}
	j.SelectedStateRoot, j.ProfileBindingSHA256 = w.StateRoot, digest
	return nil
}

func (m *Manager) validateRetiredBinding(root string, j *journal) error {
	state, present, err := devcontract.ReadCustomProfileBinding(root, j.WorkspaceID, m.options.Home)
	if err != nil {
		return err
	}
	if present {
		if state != j.SelectedStateRoot {
			return devcontract.Fail(4, "profile_binding_changed", "retired profile selection differs from its receipt")
		}
		return checkProfileBindingFile(root, j)
	}
	if j.ProfileBindingSHA256 != "" {
		return devcontract.ValidateCustomProfileClaim(j.SelectedStateRoot, j.WorkspaceID, m.options.Home)
	}
	return nil
}

func (m *Manager) profilePurgePath(w devcontract.ResolvedWorkspace) (string, error) {
	defaultState, err := m.defaultStateRoot(w.Manifest.WorkspaceID)
	if err != nil {
		return "", err
	}
	if w.StateRoot != defaultState {
		return w.StateRoot, nil
	}
	return filepath.Dir(defaultState), nil
}

// preflightFiles prevents metadata cleanup from silently swallowing foreign data.
func preflightFiles(root string, j *journal) error {
	return preflightWorkspaceFiles(root, j, false)
}

func preflightWorkspaceFiles(root string, j *journal, generatedValidatorPresent bool) error {
	if err := recoverOwnedStaging(root, j); err != nil {
		return err
	}
	allowed := map[string]bool{"workspace.json": true, ".local": true}
	for _, r := range j.Resources {
		allowed[r.Repository.Directory] = true
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !allowed[e.Name()] {
			return devcontract.Fail(4, "foreign_files", "workspace contains files not owned by its lifecycle journal")
		}
	}
	entries, err = os.ReadDir(filepath.Join(root, ".local"))
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.Name() == "ownership.json" {
			continue
		}
		if e.Name() == "profile.json" {
			if err := checkProfileBindingFile(root, j); err != nil {
				return err
			}
			continue
		}
		if generatedValidatorPresent {
			continue
		}
		return devcontract.Fail(4, "foreign_files", "local workspace metadata contains resources not owned by this lifecycle")
	}
	return nil
}

func (m *Manager) Remove(ctx context.Context, name string, opts RemoveOptions) (RemoveResult, error) {
	return m.remove(ctx, name, opts, false)
}

func (m *Manager) Rollback(ctx context.Context, name string) error {
	_, err := m.remove(ctx, name, RemoveOptions{DeleteBranches: true}, true)
	return err
}

func (m *Manager) remove(ctx context.Context, name string, opts RemoveOptions, rollback bool) (RemoveResult, error) {
	var result RemoveResult
	unlock, err := lockRoot(m.Root)
	if err != nil {
		return result, err
	}
	defer unlock()
	pending, err := m.findRetirement(name)
	if err != nil {
		return result, err
	}
	if pending != nil {
		return m.resumeRetirement(ctx, pending, opts, rollback)
	}
	root, err := m.workspaceRoot(name)
	if err != nil {
		return result, err
	}
	j, err := loadJournal(root)
	if err != nil {
		return result, err
	}
	if j.Phase == "retire" {
		return m.resumeRetirement(ctx, j, opts, rollback)
	}
	if rollback && j.Phase == "create" {
		root, err = m.publishCreate(root, j)
		if err != nil {
			return result, err
		}
	}
	if rollback {
		if j.Phase != "create" && j.Phase != "rollback" {
			return result, devcontract.Fail(4, "rollback_not_allowed", "rollback applies only to an interrupted initial create")
		}
	} else if j.Phase != "complete" && j.Phase != "remove" {
		return result, devcontract.Fail(4, "workspace_incomplete", "resume or roll back the pending operation first")
	}
	if _, e := os.Stat(filepath.Join(root, "workspace.json")); os.IsNotExist(e) && j.Phase != "complete" {
		if err = writeManifest(root, j.Manifest); err != nil {
			return result, err
		}
	}
	if j.Phase == "complete" || j.Phase == "create" {
		if err = checkManifest(root, j); err != nil {
			return result, err
		}
	}
	if j.Phase == "remove" && (opts.DeleteBranches != j.DeleteBranches || opts.PurgeState != j.PurgeState) {
		return result, devcontract.Fail(4, "removal_options_changed", "resume removal with the original purge/delete options")
	}
	w, err := m.inspectRoot(root)
	if err != nil {
		return result, err
	}
	stopUnlock, guards, err := m.lockRemoval(ctx, w.ResolvedWorkspace)
	if err != nil {
		return result, err
	}
	defer stopUnlock()
	if err = m.captureProfileBinding(w.ResolvedWorkspace, j); err != nil {
		return result, err
	}
	// Retire only verified tool-authored outputs before ordinary source-clean
	// checks. Human edits and unknown files remain refusal conditions.
	if err = RestoreRepositoryOutputs(ctx, w); err != nil {
		return result, err
	}
	if err = preflightWorkspaceFiles(root, j, opts.ValidateGenerated != nil); err != nil {
		return result, err
	}
	if opts.ValidateGenerated != nil {
		if err = opts.ValidateGenerated(ctx, w); err != nil {
			return result, err
		}
	}
	purgeProfile := opts.PurgeState
	purgePath, err := m.profilePurgePath(w.ResolvedWorkspace)
	if err != nil {
		return result, err
	}
	if purgeProfile {
		if _, e := os.Lstat(purgePath); os.IsNotExist(e) && (j.Phase == "remove" || purgePath == w.StateRoot) {
			// A completed owned purge may precede the retirement journal write.
			// Its durable remove intent permits finishing without recreating state.
			purgeProfile = false
		} else if e != nil {
			return result, e
		} else if err = m.verifyProfileOwner(w.ResolvedWorkspace); err != nil {
			return result, err
		}
	}
	defaultProfile, err := m.defaultProfileRoot(w.Manifest.WorkspaceID)
	if err != nil {
		return result, err
	}
	if err = devsession.ValidateUnixSocketDirectoriesRemoved(filepath.Join(defaultProfile, "runtime")); err != nil {
		return result, err
	}
	purgeDefaultProfile := opts.PurgeState && purgePath == w.StateRoot
	if purgeDefaultProfile {
		if _, e := os.Lstat(defaultProfile); os.IsNotExist(e) {
			purgeDefaultProfile = false
		} else if e != nil {
			return result, e
		} else if err = devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID); err != nil {
			return result, err
		}
	}
	// Preflight all resources before removing the first one. Explicit deletion
	// is stricter than default removal: no user commit may become unreachable.
	unowned := map[int]bool{}
	for i := range j.Resources {
		r := &j.Resources[i]
		if _, e := os.Lstat(r.Path); e == nil {
			if err = verifyWorktree(ctx, r, true); err != nil {
				return result, err
			}
		} else if !os.IsNotExist(e) {
			return result, e
		}
		if opts.DeleteBranches {
			tip, marker := refValue(ctx, r.CommonDir, "refs/heads/"+r.Repository.Branch), refValue(ctx, r.CommonDir, r.Marker)
			if err = ctx.Err(); err != nil {
				return result, err
			}
			if rollback && r.GitDir == "" && marker == "" {
				if _, e := os.Lstat(r.Path); os.IsNotExist(e) {
					// A planned branch whose reservation failed is not ours.
					// Roll back the owned siblings without touching that branch.
					unowned[i] = true
					continue
				}
			}
			if tip != "" || marker != "" {
				if tip != r.Repository.BaseCommit || marker != r.Repository.BaseCommit {
					return result, devcontract.Fail(4, "user_commits", "branch deletion cannot discard changed branches or user commits")
				}
				list, e := git(ctx, r.CommonDir, "", "worktree", "list", "--porcelain")
				if e != nil {
					return result, e
				}
				attached := 0
				for _, line := range strings.Split(list, "\n") {
					if line == "branch refs/heads/"+r.Repository.Branch {
						attached++
					}
				}
				expected := 0
				if _, e := os.Lstat(r.Path); e == nil {
					expected = 1
				}
				if attached != expected {
					return result, devcontract.Fail(4, "occupied_branch", "owned branch is attached to a foreign worktree")
				}
			}
		}
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	if opts.BeforeRemove != nil {
		if err = opts.BeforeRemove(ctx, w, guards); err != nil {
			return result, err
		}
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	// Generated cleanup must finish before the first source mutation; callback
	// success is not permission to leave unowned metadata behind.
	if err = preflightFiles(root, j); err != nil {
		return result, err
	}
	j.Phase = "remove"
	if rollback {
		j.Phase = "rollback"
	}
	j.DeleteBranches, j.PurgeState = opts.DeleteBranches, opts.PurgeState
	if err = saveJournal(root, j); err != nil {
		return result, err
	}
	for i := range j.Resources {
		r := &j.Resources[i]
		if err = ctx.Err(); err != nil {
			return result, err
		}
		if unowned[i] {
			continue
		}
		if !r.Removed {
			if err = removeWorktree(ctx, r); err != nil {
				return result, err
			}
			r.Removed = true
			if err = saveJournal(root, j); err != nil {
				return result, err
			}
		}
		if opts.DeleteBranches {
			if err = deleteOwnedBranch(ctx, r); err != nil {
				return result, err
			}
		}
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	if purgeProfile {
		if err = m.verifyProfileOwner(w.ResolvedWorkspace); err != nil {
			return result, err
		}
		if err = os.RemoveAll(purgePath); err != nil {
			return result, err
		}
	}
	if purgeDefaultProfile {
		if err = devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID); err != nil {
			return result, err
		}
		if err = os.RemoveAll(defaultProfile); err != nil {
			return result, err
		}
	}
	j.Phase, j.Rollback = "retire", rollback
	if err = saveJournal(root, j); err != nil {
		return result, err
	}
	return m.finishRetirement(ctx, j, w.StateRoot)
}

func (m *Manager) retirementPath(id string) string {
	return filepath.Join(m.Root, ".omniview-dev", "retirements", id+".json")
}

func (m *Manager) saveRetirement(j *journal) error {
	path := m.retirementPath(j.WorkspaceID)
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return err
	}
	if canonical != path {
		return devcontract.Fail(4, "foreign_retirement", "retirement receipt cannot be redirected through a symlink")
	}
	return atomicOwnedJSON(path, j, j.WorkspaceID)
}

func (m *Manager) findRetirement(name string) (*journal, error) {
	dir := filepath.Dir(m.retirementPath("unused"))
	canonical, err := devcontract.CanonicalPath(dir)
	if err != nil {
		return nil, err
	}
	if canonical != dir {
		return nil, devcontract.Fail(4, "foreign_retirement", "retirement receipts cannot be redirected through a symlink")
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var found *journal
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		canonical, e := devcontract.CanonicalPath(path)
		if e != nil {
			return nil, e
		}
		if canonical != path {
			return nil, devcontract.Fail(4, "foreign_retirement", "retirement receipt is a symlink")
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return nil, e
		}
		var j journal
		if json.Unmarshal(data, &j) != nil || j.Manifest.Validate() != nil || j.SchemaVersion != 1 || j.Phase != "retire" || j.WorkspaceID != j.Manifest.WorkspaceID || entry.Name() != j.WorkspaceID+".json" || j.Root != filepath.Join(m.Root, "workspaces", j.Manifest.Slug) {
			return nil, devcontract.Fail(4, "invalid_retirement", "retirement receipt has no matching workspace identity")
		}
		if name != j.Manifest.Slug && name != j.WorkspaceID {
			continue
		}
		if name != j.WorkspaceID {
			if current, e := readManifest(j.Root); e == nil && current.WorkspaceID != j.WorkspaceID {
				return nil, devcontract.Fail(3, "ambiguous_workspace", "name now selects another workspace; resume retirement using its original UUID")
			}
		}
		if found != nil {
			return nil, devcontract.Fail(3, "ambiguous_workspace", "multiple retired workspaces match; use the UUID")
		}
		found = &j
	}
	return found, nil
}

func (m *Manager) resumeRetirement(ctx context.Context, j *journal, opts RemoveOptions, rollback bool) (RemoveResult, error) {
	if opts.PurgeState != j.PurgeState || opts.DeleteBranches != j.DeleteBranches || rollback != j.Rollback {
		return RemoveResult{}, devcontract.Fail(4, "removal_options_changed", "resume retirement with its original remove/rollback operation and flags")
	}
	profiles, err := devcontract.CanonicalPath(filepath.Join(m.options.Home, ".omniview-dev", "profiles"))
	if err != nil {
		return RemoveResult{}, err
	}
	profile := filepath.Join(profiles, j.WorkspaceID)
	canonical, err := devcontract.CanonicalPath(profile)
	if err != nil {
		return RemoveResult{}, err
	}
	if canonical != profile {
		return RemoveResult{}, devcontract.Fail(4, "foreign_profile", "retired profile identity resolves through a symlink")
	}
	state := filepath.Join(profile, "state")
	if j.SelectedStateRoot != "" {
		state = j.SelectedStateRoot
	}
	canonical, err = devcontract.CanonicalPath(state)
	if err != nil {
		return RemoveResult{}, err
	}
	if canonical != state {
		return RemoveResult{}, devcontract.Fail(4, "foreign_profile", "retired state root resolves through a symlink")
	}
	w := devcontract.ResolvedWorkspace{ManifestPath: filepath.Join(j.Root, "workspace.json"), Root: j.Root, StateRoot: state, Manifest: j.Manifest}
	unlock, _, err := m.lockRemoval(ctx, w)
	if err != nil {
		return RemoveResult{}, err
	}
	defer unlock()
	return m.finishRetirement(ctx, j, state)
}

func (m *Manager) finishRetirement(ctx context.Context, j *journal, state string) (RemoveResult, error) {
	result := RemoveResult{WorkspaceID: j.WorkspaceID, StateRoot: state, StateRetained: !j.PurgeState, BranchesRetained: !j.DeleteBranches}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	tomb := retiredRoot(j)
	if !j.Retired {
		if _, err := os.Lstat(tomb); err == nil {
			owned, e := loadJournal(tomb)
			if e != nil || owned.WorkspaceID != j.WorkspaceID {
				return result, devcontract.Fail(4, "foreign_retirement", "retirement destination is not the owned interrupted move")
			}
		} else if os.IsNotExist(err) {
			owned, e := loadJournal(j.Root)
			if e != nil || owned.WorkspaceID != j.WorkspaceID {
				return result, devcontract.Fail(4, "foreign_retirement", "retirement source no longer matches its durable ownership")
			}
			if err = m.saveRetirement(j); err != nil {
				return result, err
			}
			if err = os.Rename(j.Root, tomb); err != nil {
				return result, err
			}
			if err = syncDirectory(filepath.Dir(tomb)); err != nil {
				return result, err
			}
		} else {
			return result, err
		}
		j.Retired = true
	}
	// This external receipt survives unlinking every file in the retired tree.
	// It is removed only after the directory itself is durably gone.
	if err := m.saveRetirement(j); err != nil {
		return result, err
	}
	if err := m.validateRetiredBinding(tomb, j); err != nil {
		return result, err
	}
	if err := cleanupRetired(tomb, j); err != nil {
		return result, err
	}
	if err := syncDirectory(filepath.Dir(tomb)); err != nil {
		return result, err
	}
	if err := os.Remove(m.retirementPath(j.WorkspaceID)); err != nil && !os.IsNotExist(err) {
		return result, err
	}
	if err := syncDirectory(filepath.Dir(m.retirementPath(j.WorkspaceID))); err != nil {
		return result, err
	}
	return result, nil
}

func cleanupRetired(root string, j *journal) error {
	canonical, err := devcontract.CanonicalPath(root)
	if err != nil {
		return err
	}
	if canonical != root {
		return devcontract.Fail(4, "foreign_retirement", "retired directory cannot be redirected through a symlink")
	}
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = recoverOwnedStaging(root, j); err != nil {
		return err
	}
	entries, err = os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.Name() != "workspace.json" && e.Name() != ".local" {
			return devcontract.Fail(4, "foreign_files", "retired directory contains unowned files")
		}
	}
	local := filepath.Join(root, ".local")
	canonical, err = devcontract.CanonicalPath(local)
	if err != nil {
		return err
	}
	if canonical != local {
		return devcontract.Fail(4, "foreign_retirement", "retired metadata cannot be a symlink")
	}
	entries, err = os.ReadDir(local)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, e := range entries {
		if e.Name() == "ownership.json" {
			continue
		}
		if e.Name() == "profile.json" {
			if err := checkProfileBindingFile(root, j); err != nil {
				return err
			}
			continue
		}
		return devcontract.Fail(4, "foreign_files", "retired metadata contains unowned files")
	}
	for _, path := range []string{filepath.Join(local, "profile.json"), filepath.Join(root, "workspace.json"), filepath.Join(local, "ownership.json"), local, root} {
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
