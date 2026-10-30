package devworkspace

import (
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
)

const (
	sourceUpdateBuild            = "build"
	sourceUpdatePinned           = "pinned"
	sourceUpdatePrepared         = "prepared"
	sourceUpdateCheckout         = "checkout"
	sourceUpdateOverlays         = "overlays"
	sourceUpdateComplete         = "complete"
	sourceUpdateStopped          = "stopped"
	sourceUpdateCurrent          = "current"
	sourceUpdateConflictExitCode = 4
)

// sourceUpdateIntent retains immutable targets and overlay bytes across a partial
// cohort checkout. Recovery never resolves a moving upstream a second time.
type sourceUpdateIntent struct {
	WorkspaceID string         `json:"workspaceID"`
	Root        string         `json:"root"`
	Plan        UpdatePlan     `json:"plan"`
	Phase       string         `json:"phase"`
	Running     bool           `json:"running"`
	Files       []linkFile     `json:"files,omitempty"`
	Paths       []string       `json:"paths,omitempty"`
	Launch      *LaunchOptions `json:"launch,omitempty"`
}

func sourceUpdatePath(m *Manager, w Workspace) string {
	return filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "source-update.json")
}

func readSourceUpdate(m *Manager, w Workspace) (sourceUpdateIntent, error) {
	var intent sourceUpdateIntent
	path := sourceUpdatePath(m, w)
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return intent, err
	}
	if canonical != path {
		return intent, sourceUpdateFailure("foreign_recovery", "source update intent cannot be redirected")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return intent, err
	}
	if err = json.Unmarshal(raw, &intent); err != nil {
		return intent, err
	}
	if intent.WorkspaceID != w.Manifest.WorkspaceID || intent.Root != w.Root ||
		intent.Plan.WorkspaceID != w.Manifest.WorkspaceID {
		return intent, sourceUpdateFailure("foreign_recovery", "source update identity differs from workspace")
	}
	switch intent.Phase {
	case sourceUpdatePrepared, sourceUpdateCheckout, sourceUpdateOverlays, sourceUpdateBuild, sourceUpdateComplete:
	default:
		return intent, sourceUpdateFailure("invalid_source_update", "source update phase is invalid")
	}
	return intent, nil
}

func saveSourceUpdate(m *Manager, w Workspace, intent *sourceUpdateIntent, phase string) error {
	intent.Phase = phase
	if err := atomicOwnedJSON(sourceUpdatePath(m, w), intent, w.Manifest.WorkspaceID); err != nil {
		return err
	}
	return m.durablePhase("source", phase)
}

func (m *Manager) applySourceUpdate(
	ctx context.Context, name string, plan UpdatePlan, options UpdateOptions,
) (RefreshResult, error) {
	return m.applySourceUpdateRequest(ctx, name, plan, options, false)
}

func (m *Manager) applySourceUpdateRequest(
	ctx context.Context, name string, plan UpdatePlan, options UpdateOptions, recovering bool,
) (RefreshResult, error) {
	var result RefreshResult
	err := m.executeSourceUpdateRequest(ctx, name, plan, options, recovering, &result)
	if result.Plan == nil {
		result.Plan = &plan
	}
	if result.WorkspaceID == "" {
		result.WorkspaceID = plan.WorkspaceID
	}
	if result.Phase == "" {
		result.Phase = "preflight"
	}
	return result, err
}

func (m *Manager) executeSourceUpdateRequest(
	ctx context.Context, name string, plan UpdatePlan, options UpdateOptions, recovering bool, result *RefreshResult,
) error {
	if plan.DependencyChanged {
		return sourceUpdateFailure(
			"composition_changed", "dependency changes require the owned refresh transaction",
		)
	}
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return err
	}
	var emptyStatus Status
	*result = RefreshResult{
		WorkspaceID: w.Manifest.WorkspaceID, Phase: "", Status: emptyStatus, Plan: &plan,
		BackupDirectory: filepath.Dir(sourceUpdatePath(m, w)),
	}
	base := result.BackupDirectory
	canonical, err := devcontract.CanonicalPath(base)
	if err != nil {
		return err
	}
	if canonical != base {
		return sourceUpdateFailure("foreign_recovery", "source update recovery directory cannot be redirected")
	}
	if err = os.MkdirAll(base, 0700); err != nil {
		return err
	}
	unlock, err := tryLock(filepath.Join(base, "refresh.lock"))
	if err != nil {
		return err
	}
	defer unlock()
	intent, existing, err := m.captureSourceUpdate(ctx, name, w, plan, options, recovering)
	if err != nil {
		return err
	}
	result.Plan = &intent.Plan
	result.Phase = intent.Phase
	defer func() {
		if retained, e := readSourceUpdate(m, w); e == nil {
			result.Plan = &retained.Plan
			result.Phase = retained.Phase
		}
	}()
	if err = validateSourceRecovery(intent, plan, options, existing, recovering); err != nil {
		return err
	}
	if intent.Phase == sourceUpdateComplete {
		result.Phase = sourceUpdateComplete
		result.Status, err = m.Status(ctx, name)
		if err == nil {
			err = os.Remove(sourceUpdatePath(m, w))
		}
		return err
	}
	result.Status, err = m.runCapturedSourceUpdate(ctx, name, w, &intent)
	result.Phase = intent.Phase
	if err == nil {
		result.Phase = sourceUpdateComplete
		err = os.Remove(sourceUpdatePath(m, w))
	}
	return err
}

func (m *Manager) resumeSourceUpdate(
	ctx context.Context, name string, options RefreshOptions,
) (RefreshResult, bool, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return RefreshResult{}, false, err
	}
	intent, err := readSourceUpdate(m, w)
	if os.IsNotExist(err) {
		var result RefreshResult
		return result, false, nil
	}
	if err != nil {
		return RefreshResult{}, true, err
	}
	result, err := m.applySourceUpdateRequest(ctx, name, intent.Plan, UpdateOptions{
		RefreshOptions: options, Repositories: nil, Check: false,
	}, true)
	return result, true, err
}

// RevalidateUpdatePlan checks captured authority without fetching or resolving a
// new target. Refresh calls it again under its mutation authority.
func (m *Manager) RevalidateUpdatePlan(ctx context.Context, name string, plan UpdatePlan) error {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return err
	}
	return validateCapturedUpdate(ctx, w, plan)
}

func validateCapturedUpdate(ctx context.Context, w Workspace, plan UpdatePlan) error {
	if plan.WorkspaceID != w.Manifest.WorkspaceID || plan.Result == "blocked" ||
		plan.ConfigurationFingerprint != UpdateConfigurationFingerprint(w.Manifest) {
		return sourceUpdateFailure("stale_update_plan", "captured update configuration changed or cohort is blocked")
	}
	j, err := loadJournal(w.Root)
	if err != nil {
		return err
	}
	if !sameManifest(j.Manifest, w.Manifest) {
		return sourceUpdateFailure("ownership_changed", "source manifest differs from ownership journal")
	}
	seen := map[string]bool{}
	for _, p := range plan.Repositories {
		if seen[p.ID] {
			return sourceUpdateFailure("stale_update_plan", "captured cohort repeats a repository")
		}
		seen[p.ID] = true
		var found bool
		found, err = validateCapturedRepository(ctx, w, j, p)
		if err != nil {
			return err
		}
		if !found {
			return sourceUpdateFailure("stale_update_plan", "captured repository is no longer selected")
		}
	}
	return nil
}

func (m *Manager) applySourceCheckout(ctx context.Context, w Workspace, intent *sourceUpdateIntent) error {
	if intent.Phase == sourceUpdateComplete {
		return nil
	}
	unlock, err := lockRoot(m.Root)
	if err != nil {
		return err
	}
	defer unlock()
	if intent.Phase == sourceUpdateBuild {
		return m.rebaseSourceComposition(ctx, w, intent)
	}
	j, err := loadJournal(w.Root)
	if err != nil {
		return err
	}
	if intent.Phase == sourceUpdatePrepared {
		if err = validateCapturedUpdate(ctx, w, intent.Plan); err != nil {
			return err
		}
		if err = saveSourceUpdate(m, w, intent, sourceUpdateCheckout); err != nil {
			return err
		}
	}
	if intent.Phase == sourceUpdateCheckout {
		if err = m.checkoutSourceCohort(ctx, w, j, intent); err != nil {
			return err
		}
		if err = saveSourceUpdate(m, w, intent, sourceUpdateOverlays); err != nil {
			return err
		}
	}
	if intent.Phase == sourceUpdateOverlays {
		if err = m.restoreSourceOverlays(ctx, w, intent); err != nil {
			return err
		}
		if err = saveSourceUpdate(m, w, intent, sourceUpdateBuild); err != nil {
			return err
		}
	}
	return nil
}

func (s *workspaceSupervisor) startSourceWatcher(ctx context.Context) {
	if !s.options.Watch {
		return
	}
	watchCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	s.mu.Lock()
	s.watchCancel = cancel
	s.watchDone = done
	s.mu.Unlock()
	go func() {
		defer cancel()
		defer close(done)
		if err := s.graphInstance.Watch(watchCtx, s.watchHooks()); err != nil && watchCtx.Err() == nil {
			s.failed(err)
		}
	}()
}

func (s *workspaceSupervisor) applySourceUpdate(ctx context.Context) (Status, error) {
	if err := s.sourceMu.LockContext(ctx); err != nil {
		return s.snapshot(), err
	}
	defer s.sourceMu.Unlock()
	intent, err := readSourceUpdate(s.manager, s.workspace)
	if err != nil {
		return s.snapshot(), err
	}
	if intent.Phase == sourceUpdateComplete {
		return s.snapshot(), nil
	}
	graph := s.graphInstance
	if graph == nil {
		return s.snapshot(), sourceUpdateFailure("missing_build_graph", "running workspace has no owned build graph")
	}
	// Once the watcher is canceled, every refusal must report a degraded
	// supervisor, not a ready runtime that silently lost its build producer.
	if err = s.applyQuiescedSourceUpdate(ctx, graph, &intent); err != nil {
		s.failed(err)
		return s.snapshot(), err
	}
	s.setPhase("ready", nil)
	s.startSourceWatcher(s.sessionContext)
	return s.observeStatus(ctx, s.snapshot()), nil
}

// affectedSourceBackends identifies A08 Go source producers, not UI consumers.
// Host frontend edits never stop unrelated plugin runtimes.
func affectedSourceBackends(w Workspace, paths []string) []string {
	var ids []string
	sdk := ""
	if w.Manifest.Links.SDKRepositoryID != nil {
		for _, repo := range w.Manifest.Repositories {
			if repo.ID == *w.Manifest.Links.SDKRepositoryID {
				sdk = filepath.Join(w.Root, repo.Directory)
			}
		}
	}
	for _, plugin := range w.Manifest.Plugins {
		root, err := w.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			continue
		}
		for _, path := range paths {
			if filepath.Ext(path) != ".go" {
				continue
			}
			if inside(root, path) || (sdk != "" && inside(sdk, path)) {
				ids = append(ids, plugin.ID)
				break
			}
		}
	}
	return ids
}

func (s *workspaceSupervisor) quiesceSourceBackends(ctx context.Context, paths []string) ([]string, error) {
	ids := affectedSourceBackends(s.workspace, paths)
	if len(ids) == 0 {
		return nil, nil
	}
	client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	for _, id := range ids {
		if _, err = controlMutation(
			ctx, client, "plugin.dev.stop", devcontrol.PluginParams{ID: id}, s.options.Timeout,
		); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func (s *workspaceSupervisor) restoreUnstartedSourceWatcher(done <-chan struct{}) {
	<-done
	s.sourceMu.Lock()
	defer s.sourceMu.Unlock()
	if s.sessionContext != nil && s.sessionContext.Err() == nil && s.graphInstance != nil {
		s.startSourceWatcher(s.sessionContext)
	}
}

func (m *Manager) captureSourceUpdate(
	ctx context.Context, name string, w Workspace, plan UpdatePlan, options UpdateOptions, recovering bool,
) (sourceUpdateIntent, bool, error) {
	intent, err := readSourceUpdate(m, w)
	if !os.IsNotExist(err) {
		return intent, err == nil, err
	}
	if recovering {
		return intent, false, sourceUpdateFailure("source_recovery_mismatch",
			"retained source update disappeared before recovery acquired mutation authority")
	}
	if err = validateCapturedUpdate(ctx, w, plan); err != nil {
		return intent, false, err
	}
	intent = sourceUpdateIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Launch: options.Launch,
		Phase: "", Running: false, Files: nil, Paths: nil,
	}
	status, err := m.Status(ctx, name)
	if err != nil {
		return intent, false, err
	}
	if err = m.requireSourceUpdateSupervisor(w, status); err != nil {
		return intent, false, err
	}
	intent.Running = status.Phase != sourceUpdateStopped && status.Phase != "created" && status.Phase != ""
	if !intent.Running {
		if err = RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
			return intent, false, err
		}
	}
	if err = captureSourceOverlays(ctx, w, &intent); err != nil {
		return intent, false, err
	}
	if err = captureSourcePaths(ctx, w, &intent); err != nil {
		return intent, false, err
	}
	err = saveSourceUpdate(m, w, &intent, sourceUpdatePrepared)
	return intent, false, err
}

func captureSourceOverlays(ctx context.Context, w Workspace, intent *sourceUpdateIntent) error {
	links, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, file := range links.Files {
		if err = captureSourceOverlay(ctx, w, intent, file); err != nil {
			return err
		}
	}
	return nil
}

func captureSourceOverlay(ctx context.Context, w Workspace, intent *sourceUpdateIntent, file linkFile) error {
	for _, p := range intent.Plan.Repositories {
		if p.Classification != updateBehind {
			continue
		}
		for _, repo := range w.Manifest.Repositories {
			root := filepath.Join(w.Root, repo.Directory)
			path := filepath.Join(w.Root, file.Path)
			if repo.ID != p.ID || !inside(root, path) {
				continue
			}
			relative, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			// Unchanged overlays stay byte-for-byte in place. Removing
			// go.mod unnecessarily would wake unaffected A08 producers.
			old := refValue(ctx, root, p.OldSHA+":"+filepath.ToSlash(relative))
			target := refValue(ctx, root, p.TargetSHA+":"+filepath.ToSlash(relative))
			if old != target {
				intent.Files = append(intent.Files, file)
			}
		}
	}
	return nil
}

func captureSourcePaths(ctx context.Context, w Workspace, intent *sourceUpdateIntent) error {
	j, err := loadJournal(w.Root)
	if err != nil {
		return err
	}
	for _, p := range intent.Plan.Repositories {
		if p.Classification != updateBehind {
			continue
		}
		for _, r := range j.Resources {
			if r.Repository.ID != p.ID {
				continue
			}
			changed, diffErr := git(ctx, r.Path, "", "diff", "--name-only", "-z", p.OldSHA, p.TargetSHA, "--")
			if diffErr != nil {
				return diffErr
			}
			intent.Paths = appendSourcePaths(intent.Paths, r.Path, changed)
		}
	}
	return nil
}

func appendSourcePaths(paths []string, root, changed string) []string {
	for _, path := range strings.Split(changed, "\x00") {
		if path != "" {
			paths = append(paths, filepath.Join(root, path))
		}
	}
	return paths
}

func validateSourceRecovery(
	intent sourceUpdateIntent, plan UpdatePlan, options UpdateOptions, existing, recovering bool,
) error {
	if existing && !recovering {
		return sourceUpdateFailure("source_recovery_required",
			"a captured source update already exists; run workspace recover to resume its exact cohort and targets")
	}
	if !recovering {
		return nil
	}
	requested, _ := json.Marshal(plan)
	captured, _ := json.Marshal(intent.Plan)
	if string(requested) != string(captured) {
		return sourceUpdateFailure("source_recovery_mismatch",
			"retained source cohort changed before recovery acquired mutation authority")
	}
	if options.Launch != nil {
		requested, _ = json.Marshal(options.Launch)
		captured, _ = json.Marshal(intent.Launch)
		if string(requested) != string(captured) {
			return sourceUpdateFailure("source_recovery_mismatch",
				"launch options differ from the retained source update; recover without launch overrides")
		}
	}
	return nil
}

func (m *Manager) runCapturedSourceUpdate(
	ctx context.Context, name string, w Workspace, intent *sourceUpdateIntent,
) (Status, error) {
	// Recovery after a supervisor crash can finish source ownership while stopped.
	// It never starts an application merely to retire a captured source intent.
	if intent.Running && RequireStopped(ctx, w.ResolvedWorkspace) == nil {
		intent.Running = false
		if err := saveSourceUpdate(m, w, intent, intent.Phase); err != nil {
			return Status{}, err
		}
	}
	if intent.Running {
		status, err := m.Status(ctx, name)
		if err != nil {
			return Status{}, err
		}
		if err = m.requireSourceUpdateSupervisor(w, status); err != nil {
			return Status{}, err
		}
		return m.supervisorCommand(ctx, name, supervisorSourceUpdateCommand)
	}
	if err := RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
		return Status{}, err
	}
	if err := m.applySourceCheckout(ctx, w, intent); err != nil {
		return Status{}, err
	}
	if err := saveSourceUpdate(m, w, intent, sourceUpdateComplete); err != nil {
		return Status{}, err
	}
	return m.Status(ctx, name)
}

func validateCapturedRepository(ctx context.Context, w Workspace, j *journal, p RepositoryUpdatePlan) (bool, error) {
	found := false
	for i := range j.Resources {
		r := &j.Resources[i]
		if r.Removed || r.Repository.ID != p.ID {
			continue
		}
		found = true
		if err := validateCapturedResource(ctx, w, r, p); err != nil {
			return found, err
		}
	}
	return found, nil
}

func validateCapturedResource(ctx context.Context, w Workspace, r *resource, p RepositoryUpdatePlan) error {
	if r.Repository.BaseCommit != p.OldSHA || refValue(ctx, r.Path, "HEAD") != p.ActualHEAD {
		return sourceUpdateFailure("stale_update_plan", "selected HEAD changed after planning")
	}
	if err := verifyWorktree(ctx, r, false); err != nil {
		return err
	}
	if err := plannerCleanWorktree(ctx, w, *r); err != nil {
		return err
	}
	if p.BlockedReason != "" {
		return sourceUpdateFailure("stale_update_plan", "captured cohort contains a blocker")
	}
	switch p.Classification {
	case updateBehind, sourceUpdateCurrent, sourceUpdatePinned:
	default:
		return sourceUpdateFailure("stale_update_plan", "captured ancestry is not safe to apply")
	}
	if err := validateCapturedUpstream(ctx, r, p); err != nil {
		return err
	}
	if err := validateCapturedPlugins(ctx, w, r, p); err != nil {
		return err
	}
	if p.Classification == updateBehind {
		if p.ActualHEAD != p.OldSHA || !IsPinnedRef(p.TargetSHA) || (len(p.TargetSHA) != 40 && len(p.TargetSHA) != 64) {
			return sourceUpdateFailure("stale_update_plan", "captured fast-forward target is invalid")
		}
		if _, err := git(ctx, r.Path, "", "merge-base", "--is-ancestor", p.OldSHA, p.TargetSHA); err != nil {
			return sourceUpdateFailure("non_fast_forward", "captured target no longer permits fast-forward")
		}
	}
	return nil
}

func validateCapturedUpstream(ctx context.Context, r *resource, p RepositoryUpdatePlan) error {
	if p.Remote == "" {
		return nil
	}
	upstream, err := ResolveRepositoryUpstream(ctx, r.CommonDir, r.Repository)
	if err != nil {
		return err
	}
	if upstream == nil || upstream.Remote != p.Remote || upstream.Branch != p.Branch {
		return sourceUpdateFailure("stale_update_plan", "captured upstream configuration changed")
	}
	return nil
}

func validateCapturedPlugins(ctx context.Context, w Workspace, r *resource, p RepositoryUpdatePlan) error {
	for _, plugin := range w.Manifest.Plugins {
		if plugin.RepositoryID != p.ID {
			continue
		}
		raw, err := git(ctx, r.CommonDir, "", "show", p.TargetSHA+":plugin.yaml")
		var meta struct {
			ID string `yaml:"id"`
		}
		if err != nil || yaml.Unmarshal([]byte(raw), &meta) != nil || meta.ID != plugin.ID {
			return sourceUpdateFailure("plugin_identity_changed", "captured target changes selected plugin identity")
		}
	}
	return nil
}

func (m *Manager) checkoutSourceCohort(ctx context.Context, w Workspace, j *journal, intent *sourceUpdateIntent) error {
	if err := validateSourceRecoveryCohort(ctx, w, j, intent.Plan); err != nil {
		return err
	}
	// Remove only the exact recorded overlay. Any authored delta is merged by
	// the existing three-way recovery primitive, never overwritten.
	for _, file := range intent.Files {
		if err := removeSourceOverlay(ctx, w, file); err != nil {
			return err
		}
	}
	for _, p := range intent.Plan.Repositories {
		if p.Classification != updateBehind {
			continue
		}
		if err := m.checkoutSourceRepository(ctx, w, j, p); err != nil {
			return err
		}
	}
	return writeManifest(w.Root, j.Manifest)
}

func validateSourceRecoveryCohort(ctx context.Context, w Workspace, j *journal, plan UpdatePlan) error {
	// Recheck every member before resuming any checkout. HEAD may differ only
	// where the durable ownership journal already records this exact target.
	manifest := j.Manifest
	manifest.Repositories = append(manifest.Repositories[:0:0], manifest.Repositories...)
	for _, p := range plan.Repositories {
		for k := range manifest.Repositories {
			if manifest.Repositories[k].ID == p.ID {
				manifest.Repositories[k].BaseCommit = p.OldSHA
			}
		}
		if err := validateSourceRecoveryRepository(ctx, w, j, p); err != nil {
			return err
		}
	}
	if UpdateConfigurationFingerprint(manifest) != plan.ConfigurationFingerprint {
		return sourceUpdateFailure("stale_update_plan", "source configuration changed during recovery")
	}
	return nil
}

func validateSourceRecoveryRepository(ctx context.Context, w Workspace, j *journal, p RepositoryUpdatePlan) error {
	found := false
	for i := range j.Resources {
		r := &j.Resources[i]
		if r.Removed || r.Repository.ID != p.ID {
			continue
		}
		found = true
		if err := validateSourceRecoveryResource(ctx, w, r, p); err != nil {
			return err
		}
	}
	if !found {
		return sourceUpdateFailure("ownership_changed", "captured source repository disappeared")
	}
	return nil
}

func validateSourceRecoveryResource(ctx context.Context, w Workspace, r *resource, p RepositoryUpdatePlan) error {
	head := refValue(ctx, r.Path, "HEAD")
	if head != p.ActualHEAD &&
		(head != p.TargetSHA || (r.RefTarget != p.TargetSHA && r.Repository.BaseCommit != p.TargetSHA)) {
		return sourceUpdateFailure("stale_update_plan", "source HEAD changed during recovery")
	}
	probe := *r
	if r.RefTarget == p.TargetSHA && refValue(ctx, r.CommonDir, r.Marker) == p.TargetSHA {
		probe.Repository.BaseCommit = p.TargetSHA
	}
	if err := verifyWorktree(ctx, &probe, false); err != nil {
		return err
	}
	return plannerCleanWorktree(ctx, w, *r)
}

func removeSourceOverlay(ctx context.Context, w Workspace, file linkFile) error {
	if file.AppliedHash == file.OriginalHash {
		return nil
	}
	current, err := snapshotLinkFile(w.Root, filepath.Join(w.Root, file.Path))
	if err != nil {
		return err
	}
	if current.OriginalHash == file.OriginalHash {
		return nil
	}
	original, err := removeOwnedLinkDelta(ctx, file.Original, file.Applied, current.Original)
	if err != nil {
		return err
	}
	return writeLinkFile(w.Root, file, original, file.OriginalExists)
}

func (m *Manager) checkoutSourceRepository(ctx context.Context, w Workspace, j *journal, p RepositoryUpdatePlan) error {
	for i := range j.Resources {
		r := &j.Resources[i]
		if r.Repository.ID != p.ID || r.Removed {
			continue
		}
		desired := r.Repository
		desired.BaseCommit = p.TargetSHA
		if err := m.updateRefChecked(ctx, w.Root, j, r, desired, false); err != nil {
			return err
		}
		for k := range j.Manifest.Repositories {
			if j.Manifest.Repositories[k].ID == p.ID {
				j.Manifest.Repositories[k] = desired
			}
		}
		if err := saveJournal(w.Root, j); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) restoreSourceOverlays(ctx context.Context, w Workspace, intent *sourceUpdateIntent) error {
	for _, file := range intent.Files {
		if err := restoreSourceOverlay(ctx, w, file); err != nil {
			return err
		}
	}
	return m.rebaseSourceComposition(ctx, w, intent)
}

func restoreSourceOverlay(ctx context.Context, w Workspace, file linkFile) error {
	if file.AppliedHash == file.OriginalHash {
		return nil
	}
	current, err := snapshotLinkFile(w.Root, filepath.Join(w.Root, file.Path))
	if err != nil {
		return err
	}
	if current.OriginalHash == file.AppliedHash {
		return nil
	}
	// Apply the same owned delta against the captured source; overlap remains
	// an explicit conflict rather than silently trusting regenerated bytes.
	applied, err := removeOwnedLinkDelta(ctx, file.Applied, file.Original, current.Original)
	if err != nil {
		return err
	}
	return writeLinkFile(w.Root, file, applied, true)
}

func (s *workspaceSupervisor) stopSourceWatcher(ctx context.Context) error {
	s.mu.Lock()
	cancel, done := s.watchCancel, s.watchDone
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		// No feedback or source write has begun. Rejoin the canceled
		// producer before restoring it under the normal session lifetime.
		go s.restoreUnstartedSourceWatcher(done)
		return ctx.Err()
	}
}

func (s *workspaceSupervisor) rebuildCapturedSource(
	ctx context.Context, graph *BuildGraph, intent *sourceUpdateIntent, stopped []string,
) error {
	if err := s.manager.applySourceCheckout(ctx, s.workspace, intent); err != nil {
		return err
	}
	fresh, err := s.manager.Inspect(ctx, s.workspace.Manifest.WorkspaceID)
	if err != nil {
		return err
	}
	if err = graph.adoptSourceComposition(fresh, intent); err != nil {
		return err
	}
	s.workspace = fresh
	s.mu.Lock()
	s.status.Workspace = fresh
	s.mu.Unlock()
	hooks := s.watchHooks()
	// A08 source producers remain stopped until all graph producers finish.
	// Their restart below compiles the current source and waits for readiness.
	hooks.Generations = func(context.Context) (map[string]string, error) { return map[string]string{}, nil }
	hooks.CommitFeedback = func(context.Context, WatchChange) error { return nil }
	if err = graph.rebuildSourceChange(ctx, intent.Paths, hooks, true); err != nil {
		return err
	}
	ready, err := s.sourcePluginsReady(ctx)
	if err != nil {
		return err
	}
	if !ready {
		if err = s.restartSourceBackends(ctx, stopped); err != nil {
			return err
		}
	}
	if err = s.waitSourcePlugins(ctx); err != nil {
		return err
	}
	change := WatchChange{Paths: intent.Paths, Nodes: nil, SDKChanged: false, RuntimeChanged: false}
	if err = s.commitFeedback(ctx, change); err != nil {
		return err
	}
	return saveSourceUpdate(s.manager, fresh, intent, sourceUpdateComplete)
}

func (s *workspaceSupervisor) sourcePluginsReady(ctx context.Context) (bool, error) {
	for _, plugin := range s.workspace.Manifest.Plugins {
		generation, ready := s.sourcePluginGeneration(ctx, plugin.ID)
		if !ready {
			return false, nil
		}
		if err := s.waitSourcePluginReady(ctx, plugin.ID, generation); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (s *workspaceSupervisor) restartSourceBackends(ctx context.Context, stopped []string) error {
	for _, id := range stopped {
		state, err := s.pluginState(ctx, id)
		if err == nil && state.Ready {
			continue
		}
		client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
		if err != nil {
			return err
		}
		_, err = controlMutation(ctx, client, "plugin.dev.start", devcontrol.PluginParams{ID: id}, s.options.Timeout)
		client.Close()
		if err != nil {
			return err
		}
		if err = s.waitSourcePluginReady(ctx, id, ""); err != nil {
			return err
		}
	}
	return nil
}

func (s *workspaceSupervisor) waitSourcePlugins(ctx context.Context) error {
	for _, plugin := range s.workspace.Manifest.Plugins {
		state, err := s.pluginState(ctx, plugin.ID)
		if err != nil {
			return err
		}
		if err = s.waitSourcePluginReady(ctx, plugin.ID, state.Generation); err != nil {
			return err
		}
	}
	return nil
}

// Keep readiness failures distinct from a successful compiler invocation. The
// served cohort advances only after every selected plugin has become ready.
func (s *workspaceSupervisor) waitSourcePluginReady(ctx context.Context, id, generation string) error {
	s.setPhase("plugin:"+id+":readiness", nil)
	err := s.waitPluginReady(ctx, id, generation)
	if err == nil {
		return nil
	}
	if state, inspectErr := s.pluginState(ctx, id); inspectErr == nil {
		stage := devcontract.FailedReadinessStage(
			state.BuildStatus, state.ViteStatus, state.RPCStatus, state.ControllerStatus,
		)
		if stage != "" {
			s.setPhase("plugin:"+id+":"+stage, nil)
		}
	}
	return err
}

func sourceUpdateFailure(code, message string) error {
	return devcontract.Fail(sourceUpdateConflictExitCode, code, message)
}

func (s *workspaceSupervisor) sourcePluginGeneration(ctx context.Context, id string) (string, bool) {
	state, err := s.pluginState(ctx, id)
	return state.Generation, err == nil && state.Ready
}

func (s *workspaceSupervisor) applyQuiescedSourceUpdate(
	ctx context.Context, graph *BuildGraph, intent *sourceUpdateIntent,
) error {
	if err := s.stopSourceWatcher(ctx); err != nil {
		return err
	}
	// Hold before stopping A08's watchers, and before the first Git write.
	change := WatchChange{Paths: intent.Paths, Nodes: nil, SDKChanged: false, RuntimeChanged: false}
	if err := s.beginFeedback(ctx, change); err != nil {
		return err
	}
	stopped, err := s.quiesceSourceBackends(ctx, intent.Paths)
	if err != nil {
		return err
	}
	return graph.withBuildLock(ctx, func() error {
		return s.rebuildCapturedSource(ctx, graph, intent, stopped)
	})
}

// rebaseSourceComposition advances only the workspace metadata fingerprint.
// Every dependency input and installed output retains its original authority.
func (m *Manager) rebaseSourceComposition(ctx context.Context, w Workspace, intent *sourceUpdateIntent) error {
	fresh, err := m.Inspect(ctx, w.Manifest.WorkspaceID)
	if err != nil {
		return err
	}
	old, err := sourceUpdateOldManifest(fresh.Manifest, intent.Plan)
	if err != nil {
		return err
	}
	if err = validateFinalSourceCohort(ctx, fresh, intent.Plan); err != nil {
		return err
	}
	links, err := loadLinkJournal(fresh)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if links.Phase != "linked" ||
		(!sameManifest(links.Manifest, old) && !sameManifest(links.Manifest, fresh.Manifest)) {
		return sourceUpdateFailure("link_conflict", "composition manifest differs from captured source cohort")
	}
	if err = rebaseSourceManifestHash(fresh, links, old); err != nil {
		return err
	}
	links.Manifest = fresh.Manifest
	return saveLinkJournal(links)
}

func sourceUpdateOldManifest(
	current devcontract.WorkspaceManifest, plan UpdatePlan,
) (devcontract.WorkspaceManifest, error) {
	old := current
	old.Repositories = append(old.Repositories[:0:0], old.Repositories...)
	seen := make(map[string]bool, len(plan.Repositories))
	for _, repository := range plan.Repositories {
		if seen[repository.ID] {
			return old, sourceUpdateFailure("stale_update_plan", "captured cohort repeats a repository")
		}
		seen[repository.ID] = true
		if err := restoreCapturedRepositoryBase(&old, repository); err != nil {
			return old, err
		}
	}
	if plan.DependencyChanged || current.WorkspaceID != plan.WorkspaceID ||
		UpdateConfigurationFingerprint(old) != plan.ConfigurationFingerprint {
		return old, sourceUpdateFailure("stale_update_plan", "source manifest differs from captured metadata-only update")
	}
	return old, nil
}

func restoreCapturedRepositoryBase(manifest *devcontract.WorkspaceManifest, plan RepositoryUpdatePlan) error {
	target := plan.OldSHA
	switch plan.Classification {
	case updateBehind:
		target = plan.TargetSHA
	case sourceUpdateCurrent, sourceUpdatePinned:
	default:
		return sourceUpdateFailure("stale_update_plan", "captured ancestry is not safe to apply")
	}
	for i := range manifest.Repositories {
		repository := &manifest.Repositories[i]
		if repository.ID != plan.ID {
			continue
		}
		if repository.BaseCommit != target {
			return sourceUpdateFailure("stale_update_plan", "source manifest does not record captured target")
		}
		repository.BaseCommit = plan.OldSHA
		return nil
	}
	return sourceUpdateFailure("stale_update_plan", "captured repository is no longer selected")
}

func rebaseSourceManifestHash(w Workspace, links *linkJournal, old devcontract.WorkspaceManifest) error {
	oldBytes, err := json.MarshalIndent(old, "", "  ")
	if err != nil {
		return err
	}
	path, err := safeLinkPath(w.Root, "workspace.json")
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var current devcontract.WorkspaceManifest
	if json.Unmarshal(raw, &current) != nil || !sameManifest(current, w.Manifest) {
		return sourceUpdateFailure("stale_update_plan", "source manifest changed while rebasing composition metadata")
	}
	oldHash := linkHash(append(oldBytes, '\n'), true)
	currentHash := linkHash(raw, true)
	composition := *links.Plan.Composition
	recorded := composition.SourceHashes["workspace.json"]
	if recorded != oldHash && recorded != currentHash {
		return sourceUpdateFailure("link_conflict", "composition metadata hash differs from captured source cohort")
	}
	composition.SourceHashes = maps.Clone(composition.SourceHashes)
	composition.SourceHashes["workspace.json"] = currentHash
	if err = devcompose.CheckInputs(composition); err != nil {
		return err
	}
	links.Plan.Composition = &composition
	return nil
}

// validateFinalSourceCohort proves checked-out source still belongs to the
// captured transaction before a retained build can authorize any new work.
func validateFinalSourceCohort(ctx context.Context, w Workspace, plan UpdatePlan) error {
	j, err := loadJournal(w.Root)
	if err != nil {
		return err
	}
	if !sameManifest(j.Manifest, w.Manifest) {
		return sourceUpdateFailure("ownership_changed", "source manifest differs from ownership journal")
	}
	for _, repository := range plan.Repositories {
		if err = validateFinalSourceRepository(ctx, j, repository); err != nil {
			return err
		}
	}
	return nil
}

func validateFinalSourceRepository(ctx context.Context, j *journal, plan RepositoryUpdatePlan) error {
	target := plan.OldSHA
	head := plan.ActualHEAD
	if plan.Classification == updateBehind {
		target = plan.TargetSHA
		head = plan.TargetSHA
	}
	found := false
	for i := range j.Resources {
		r := &j.Resources[i]
		if r.Removed || r.Repository.ID != plan.ID {
			continue
		}
		found = true
		if r.Repository.BaseCommit != target || refValue(ctx, r.Path, "HEAD") != head {
			return sourceUpdateFailure("stale_update_plan", "checked-out source differs from captured final target")
		}
		if err := verifyWorktree(ctx, r, false); err != nil {
			return err
		}
	}
	if !found {
		return sourceUpdateFailure("ownership_changed", "captured source repository disappeared")
	}
	return nil
}

// adoptSourceComposition runs under the supervisor's source and graph build
// locks. A source update may refresh cached metadata, never graph topology,
// dependency policy, installed bytes, or the original build configuration.
func (g *BuildGraph) adoptSourceComposition(w Workspace, intent *sourceUpdateIntent) error {
	if g.plan.Composition == nil {
		return sourceUpdateFailure("link_conflict", "cached dependency composition is absent")
	}
	old, err := sourceUpdateOldManifest(w.Manifest, intent.Plan)
	if err != nil {
		return err
	}
	links, err := loadLinkJournal(w)
	if err != nil {
		return err
	}
	if links.Phase != "linked" || !sameManifest(links.Manifest, w.Manifest) {
		return sourceUpdateFailure("link_conflict", "composition manifest differs from captured source cohort")
	}
	candidate := *links
	candidate.Plan = g.plan
	if err = rebaseSourceManifestHash(w, &candidate, old); err != nil {
		return err
	}
	if !reflect.DeepEqual(candidate.Plan, links.Plan) {
		return sourceUpdateFailure("link_conflict", "cached dependency composition differs beyond source metadata")
	}
	if err = checkLinkFiles(w.Root, links); err != nil {
		return err
	}
	g.plan = links.Plan
	g.workspace = w
	return nil
}
