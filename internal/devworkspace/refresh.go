package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
)

const linkResolutionFailureCode = "link_resolution_failed"

type RefreshOptions struct {
	Executable  string
	Diagnostics io.Writer
	Evidence    LinkProtocolEvidence
	Launch      *LaunchOptions
	Restart     bool
	plan        *UpdatePlan
	recoverOnly bool
}

type UpdateOptions struct {
	RefreshOptions
	Repositories []string
	Check        bool
}

type RefreshResult struct {
	WorkspaceID     string      `json:"workspaceID"`
	Phase           string      `json:"phase"`
	BackupDirectory string      `json:"backupDirectory"`
	Status          Status      `json:"status"`
	Plan            *UpdatePlan `json:"plan,omitempty"`
}

type refreshIntent struct {
	WorkspaceID string               `json:"workspaceID"`
	Root        string               `json:"root"`
	Phase       string               `json:"phase"`
	Evidence    LinkProtocolEvidence `json:"evidence"`
	Launch      LaunchOptions        `json:"launch"`
	Refs        map[string]string    `json:"refs,omitempty"`
	WasRunning  bool                 `json:"wasRunning"`
	Plan        *UpdatePlan          `json:"plan,omitempty"`
}

const refreshCrashed = "crashed"

const updateUpToDate = "up_to_date"

func (m *Manager) Refresh(ctx context.Context, name string, options RefreshOptions) (RefreshResult, error) {
	if result, found, err := m.resumeSourceUpdate(ctx, name, options); found || err != nil {
		return result, err
	}
	return m.refresh(ctx, name, options, nil)
}

// Recover resumes retained work only. Retrying completed recovery does not
// create another dependency install or restart a running supervisor.
func (m *Manager) Recover(ctx context.Context, name string, options RefreshOptions) (RefreshResult, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return RefreshResult{}, err
	}
	base := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID)
	receiptPath := filepath.Join(base, "recover-complete.json")
	paths := []string{base, sourceUpdatePath(m, w), filepath.Join(base, "refresh.json"), receiptPath}
	if err = validateRecoveryPaths(paths); err != nil {
		return RefreshResult{}, err
	}
	_, sourceErr := readSourceUpdate(m, w)
	if sourceErr != nil && !os.IsNotExist(sourceErr) {
		return RefreshResult{}, sourceErr
	}
	refreshPending, err := readRecoveryRefresh(w, filepath.Join(base, "refresh.json"))
	if err != nil {
		return RefreshResult{}, err
	}
	options.recoverOnly = sourceErr == nil || refreshPending
	if !options.recoverOnly {
		result, found, receiptErr := m.completedRecovery(ctx, name, receiptPath)
		if found || receiptErr != nil {
			return result, receiptErr
		}
		// Without terminal proof, preserve initial up/install recovery.
	}
	result, err := m.Refresh(ctx, name, options)
	if err != nil {
		return result, err
	}
	proof, _, err := m.recoveryProof(ctx, name)
	if err != nil {
		return result, err
	}
	if err = os.MkdirAll(base, 0700); err == nil {
		err = atomicOwnedJSON(receiptPath, proof, w.Manifest.WorkspaceID)
	}
	return result, err
}

func validateRecoveryPaths(paths []string) error {
	for _, path := range paths {
		canonical, err := devcontract.CanonicalPath(path)
		if err != nil {
			return err
		}
		if canonical != path {
			return sourceUpdateFailure("foreign_recovery", "recovery metadata cannot be redirected")
		}
	}
	return nil
}

func readRecoveryRefresh(w Workspace, path string) (bool, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var intent refreshIntent
	if err = json.Unmarshal(raw, &intent); err != nil {
		return true, err
	}
	if intent.WorkspaceID != w.Manifest.WorkspaceID || intent.Root != w.Root {
		return true, sourceUpdateFailure("foreign_recovery", "refresh intent identity differs from workspace")
	}
	switch intent.Phase {
	case refreshStop, refreshRetire, refreshUpdate, refreshInstall, refreshStart, refreshVerify:
	default:
		return true, sourceUpdateFailure("invalid_refresh", "refresh intent has an unknown phase")
	}
	return true, errors.Join(intent.Evidence.validate(), intent.Launch.Validate())
}

func (m *Manager) completedRecovery(
	ctx context.Context, name, receiptPath string,
) (RefreshResult, bool, error) {
	var result RefreshResult
	raw, err := os.ReadFile(receiptPath)
	if os.IsNotExist(err) {
		return result, false, nil
	}
	if err != nil {
		return RefreshResult{}, true, err
	}
	var receipt recoveryReceipt
	if err = json.Unmarshal(raw, &receipt); err != nil {
		return RefreshResult{}, true, err
	}
	current, status, err := m.recoveryProof(ctx, name)
	if err != nil {
		return RefreshResult{}, true, err
	}
	if !reflect.DeepEqual(receipt, current) {
		return RefreshResult{}, true, sourceUpdateFailure("recovery_state_changed",
			"completed recovery state changed; explicitly refresh or repair the retained output state")
	}
	return RefreshResult{
		WorkspaceID: current.WorkspaceID, Phase: sourceUpdateComplete, Status: status,
		BackupDirectory: filepath.Dir(receiptPath), Plan: nil,
	}, true, nil
}

// Update advances only selected tracking refs. Explicit commit pins stay pinned.
// Edit's existing ownership, clean-worktree and fast-forward checks remain final.
func (m *Manager) Update(ctx context.Context, name string, options UpdateOptions) (RefreshResult, error) {
	plan, err := m.PlanUpdate(ctx, name, options)
	var result RefreshResult
	result.WorkspaceID, result.Phase, result.Plan = plan.WorkspaceID, plan.Result, &plan
	if err != nil {
		return result, err
	}
	return m.applyPlannedUpdate(ctx, name, plan, options)
}

func (m *Manager) applyPlannedUpdate(
	ctx context.Context, name string, plan UpdatePlan, options UpdateOptions,
) (RefreshResult, error) {
	var result RefreshResult
	result.WorkspaceID, result.Phase, result.Plan = plan.WorkspaceID, plan.Result, &plan
	if options.Check || plan.Result == updateUpToDate || plan.Result == updateBlocked {
		var statusErr error
		result.Status, statusErr = m.Status(ctx, name)
		if statusErr != nil {
			return result, statusErr
		}
	}
	if options.Check || plan.Result == updateUpToDate {
		return result, nil
	}
	if plan.Result == updateBlocked {
		return result, devcontract.Fail(upstreamExitBlocked, "update_blocked",
			"selected upstream cohort is blocked; inspect plan blockers and nextCommand")
	}
	if !plan.DependencyChanged {
		return m.applySourceUpdate(ctx, name, plan, options)
	}
	refs := make(map[string]string)
	for _, repository := range plan.Repositories {
		if repository.Classification == updateBehind {
			refs[repository.ID] = repository.TargetSHA
		}
	}
	options.plan = &plan
	result, err := m.refresh(ctx, name, options.RefreshOptions, refs)
	result.Plan = &plan
	return result, err
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
		if refs != nil && !reflect.DeepEqual(refs, intent.Refs) {
			return result, devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
				"captured update targets differ; resume the retained operation with workspace recover")
		}
		if options.Launch != nil && !reflect.DeepEqual(*options.Launch, intent.Launch) {
			return result, devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
				"launch options differ from retained refresh intent; resume with saved options")
		}
		if options.Evidence.Protocol != "" && !reflect.DeepEqual(options.Evidence, intent.Evidence) {
			return result, devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
				"protocol evidence differs from retained refresh intent")
		}
		if refreshPlanDiffers(options.plan, intent.Plan) {
			return result, devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
				"selected cohort differs from retained refresh intent")
		}
	} else if os.IsNotExist(err) {
		if options.recoverOnly {
			return result, sourceUpdateFailure("recovery_disappeared",
				"retained recovery disappeared before mutation authority was acquired")
		}
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
		intent = refreshIntent{
			WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: refreshStop,
			Evidence: evidence, Launch: launch, Refs: refs, WasRunning: false, Plan: options.plan,
		}
		status, statusErr := m.Status(ctx, name)
		if statusErr != nil {
			return result, statusErr
		}
		intent.WasRunning = options.Restart ||
			(status.Phase != sourceUpdateStopped && status.Phase != refreshCrashed && status.Generation != "")
		if err = atomicOwnedJSON(path, intent, w.Manifest.WorkspaceID); err != nil {
			return result, err
		}
		if err = m.durablePhase("refresh", intent.Phase); err != nil {
			return result, err
		}
	} else {
		return result, err
	}
	switch intent.Phase {
	case refreshStop, refreshRetire, refreshUpdate, refreshInstall, refreshStart, refreshVerify:
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
		if saveErr := atomicOwnedJSON(path, intent, w.Manifest.WorkspaceID); saveErr != nil {
			return saveErr
		}
		return m.durablePhase("refresh", phase)
	}
	result.Phase = intent.Phase
	result.Plan = intent.Plan
	if intent.Phase == "stop" {
		if intent.Plan != nil {
			if err = m.RevalidateUpdatePlan(ctx, name, *intent.Plan); err != nil {
				return result, err
			}
		}
		if _, err = m.down(ctx, name, false); err != nil {
			return result, err
		}
		if err = RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
			return result, err
		}
		if err = save(refreshRetire); err != nil {
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
		if err = save(refreshUpdate); err != nil {
			return result, err
		}
	}
	if intent.Phase == "update" {
		current, inspectErr := m.Inspect(ctx, name)
		if inspectErr != nil {
			return result, inspectErr
		}
		if err = validateRefreshConfiguration(current.Manifest, intent.Plan); err != nil {
			return result, err
		}
		journal, journalErr := loadJournal(current.Root)
		if journalErr != nil {
			return result, journalErr
		}
		if err = validateRefreshConfiguration(journal.Manifest, intent.Plan); err != nil {
			return result, err
		}
		if len(intent.Refs) > 0 {
			if _, err = m.Resume(ctx, name); err != nil {
				return result, err
			}
			var editOptions EditOptions
			editOptions.Refs = intent.Refs
			editOptions.PreserveSelection = true
			if _, err = m.Edit(ctx, name, editOptions); err != nil {
				return result, err
			}
		}
		if err = save(refreshInstall); err != nil {
			return result, err
		}
	}
	if intent.Phase == refreshInstall {
		if err = m.installRefresh(ctx, name, &intent); err != nil {
			return result, err
		}
		if err = save(refreshStart); err != nil {
			return result, err
		}
	}
	if options.Diagnostics == nil {
		options.Diagnostics = io.Discard
	}
	if intent.Phase == "start" {
		if err = m.validateFinalRefreshCohort(ctx, name, intent.Plan); err != nil {
			return result, err
		}
		if !intent.WasRunning {
			result.Status, err = m.Status(ctx, name)
			if err != nil {
				return result, err
			}
			if err = os.Remove(path); err != nil {
				return result, err
			}
			result.Phase = sourceUpdateComplete
			return result, syncDirectory(base)
		}
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
		if err = save(refreshVerify); err != nil {
			return result, err
		}
	}
	if intent.Phase == "verify" {
		if err = m.validateFinalRefreshCohort(ctx, name, intent.Plan); err != nil {
			return result, err
		}
		result.Status, err = m.Status(ctx, name)
		if err != nil {
			return result, err
		}
		if result.Status.Phase != "ready" {
			if result.Status.Phase == sourceUpdateStopped || result.Status.Phase == refreshCrashed {
				if err = save(refreshStart); err != nil {
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
		result.Phase = sourceUpdateComplete
	}
	return result, nil
}

// validateRefreshConfiguration allows only captured old-to-target progress.
// Upstream, selection and launch policy cannot change during stopped recovery.
func validateRefreshConfiguration(manifest devcontract.WorkspaceManifest, plan *UpdatePlan) error {
	if plan == nil {
		return nil
	}
	normalized := manifest
	normalized.Repositories = append([]devcontract.Repository(nil), manifest.Repositories...)
	for i := range normalized.Repositories {
		repository := &normalized.Repositories[i]
		for _, captured := range plan.Repositories {
			if repository.ID != captured.ID {
				continue
			}
			if repository.BaseCommit != captured.OldSHA && repository.BaseCommit != captured.TargetSHA {
				return devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
					"repository revision is outside captured refresh progress")
			}
			repository.BaseCommit = captured.OldSHA
		}
	}
	if UpdateConfigurationFingerprint(normalized) != plan.ConfigurationFingerprint {
		return devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
			"workspace configuration differs from captured refresh policy; "+
				"preserve changes and resume the recorded selection explicitly")
	}
	return nil
}

func (m *Manager) validateFinalRefreshCohort(ctx context.Context, name string, plan *UpdatePlan) error {
	if plan == nil {
		return nil
	}
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return err
	}
	if err = validateRefreshConfiguration(w.Manifest, plan); err != nil {
		return err
	}
	j, err := loadJournal(w.Root)
	if err != nil {
		return err
	}
	if !sameManifest(j.Manifest, w.Manifest) {
		return devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
			"workspace manifest differs from retained lifecycle ownership")
	}
	for _, captured := range plan.Repositories {
		if err = validateFinalRefreshRepository(ctx, j.Resources, captured); err != nil {
			return err
		}
	}
	return ctx.Err()
}

func refreshPlanDiffers(selected, retained *UpdatePlan) bool {
	return selected != nil && (retained == nil ||
		selected.ConfigurationFingerprint != retained.ConfigurationFingerprint ||
		!reflect.DeepEqual(selected.Repositories, retained.Repositories))
}

func validateFinalRefreshRepository(ctx context.Context, resources []resource, captured RepositoryUpdatePlan) error {
	found := false
	for i := range resources {
		owned := &resources[i]
		if owned.Removed || owned.Repository.ID != captured.ID {
			continue
		}
		found = true
		if captured.TargetSHA == "" || owned.Repository.BaseCommit != captured.TargetSHA ||
			refValue(ctx, owned.Path, "HEAD") != captured.TargetSHA {
			return devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch",
				"checked-out source differs from the completed captured cohort; "+
					"no dependency install or launch is authorized")
		}
		if err := verifyWorktree(ctx, owned, false); err != nil {
			return err
		}
	}
	if !found {
		return devcontract.Fail(upstreamExitBlocked, "refresh_intent_mismatch", "captured source selection is missing")
	}
	return nil
}

// recoveryReceipt is evidence of a completed recovery, not new build authority.
// Existing output/link validators must still accept the current filesystem.
type recoveryReceipt struct {
	WorkspaceID string            `json:"workspaceID"`
	Root        string            `json:"root"`
	Manifest    string            `json:"manifest"`
	Generation  string            `json:"generation"`
	Phase       string            `json:"phase"`
	Heads       map[string]string `json:"heads"`
	Diffs       map[string]string `json:"diffs"`
	Journals    map[string]string `json:"journals"`
}

func (m *Manager) recoveryProof(ctx context.Context, name string) (recoveryReceipt, Status, error) {
	var proof recoveryReceipt
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return proof, Status{}, err
	}
	status, err := m.Status(ctx, name)
	if err != nil {
		return proof, status, err
	}
	if status.Phase != "ready" && status.Phase != sourceUpdateStopped {
		return proof, status, sourceUpdateFailure("recovery_not_terminal", "workspace has not completed recovery")
	}
	manifest, err := json.Marshal(w.Manifest)
	if err != nil {
		return proof, status, err
	}
	proof = recoveryReceipt{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root,
		Manifest: linkHash(manifest, true), Generation: status.Generation, Phase: status.Phase,
		Heads: map[string]string{}, Diffs: map[string]string{}, Journals: map[string]string{}}
	if err = proof.captureSources(ctx, w); err != nil {
		return proof, status, err
	}
	if err = validateRecoveryLinks(w); err != nil {
		return proof, status, err
	}
	err = proof.captureJournals(ctx, m, w)
	return proof, status, err
}

func (proof *recoveryReceipt) captureSources(ctx context.Context, w Workspace) error {
	for _, repository := range w.Manifest.Repositories {
		directory := filepath.Join(w.Root, repository.Directory)
		head, err := git(ctx, directory, "", "rev-parse", "HEAD")
		if err != nil {
			return err
		}
		proof.Heads[repository.ID] = head
		diff, err := git(ctx, directory, "", "diff", "HEAD", "--")
		if err != nil {
			return err
		}
		proof.Diffs[repository.ID] = linkHash([]byte(diff), true)
	}
	return nil
}

func validateRecoveryLinks(w Workspace) error {
	link, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if link.Phase != "linked" {
		return sourceUpdateFailure("link_interrupted", "dependency transaction is unfinished; explicitly refresh")
	}
	return errors.Join(checkLinkFiles(w.Root, link), devcompose.CheckInputs(*link.Plan.Composition))
}

func (proof *recoveryReceipt) captureJournals(ctx context.Context, m *Manager, w Workspace) error {
	generatedLedgerPath := filepath.Join(m.Root, ".omniview-dev", "generated", w.Manifest.WorkspaceID+".json")
	outputPath := filepath.Join(m.Root, ".omniview-dev", "repository-outputs", w.Manifest.WorkspaceID, "journal.json")
	paths := []string{launchPath(w, "launch.json"), launchPath(w, "links.json"), generatedLedgerPath, outputPath}
	if err := validateRecoveryPaths(paths); err != nil {
		return err
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		proof.Journals[path] = linkHash(raw, true)
		switch path {
		case generatedLedgerPath:
			if err = validateRecoveryGenerated(w, raw); err != nil {
				return err
			}
		case outputPath:
			if _, err = devoutputs.ValidatedOwnedPaths(ctx, w.ResolvedWorkspace); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateRecoveryGenerated(w Workspace, raw []byte) error {
	var ledger generatedLedger
	if err := json.Unmarshal(raw, &ledger); err != nil {
		return err
	}
	if ledger.SchemaVersion != 1 || ledger.WorkspaceID != w.Manifest.WorkspaceID || ledger.Root != w.Root ||
		len(ledger.Pending) != 0 || ledger.Cleanup != nil {
		return sourceUpdateFailure("generated_conflict",
			"generated publication is unfinished or belongs to another workspace")
	}
	for relative, entry := range ledger.Entries {
		path, err := generatedPath(w, relative)
		if err != nil {
			return err
		}
		if err = checkGeneratedEntry(path, entry); err != nil {
			return err
		}
	}
	return nil
}

const (
	refreshStop    = "stop"
	refreshRetire  = "retire"
	refreshUpdate  = "update"
	refreshInstall = "install"
	refreshStart   = "start"
	refreshVerify  = "verify"
)

func (m *Manager) installRefresh(ctx context.Context, name string, intent *refreshIntent) error {
	if err := m.validateFinalRefreshCohort(ctx, name, intent.Plan); err != nil {
		return err
	}
	// Retire an interrupted install before retrying; pending outputs never
	// become accepted merely because their bytes exist after a crash.
	if _, err := m.RecoverLinks(ctx, name); err != nil {
		return err
	}
	if _, err := m.Unlink(ctx, name); err != nil {
		return err
	}
	report, err := m.Link(ctx, name, LinkOptions{Evidence: intent.Evidence})
	if err == nil {
		return nil
	}
	var typed *devcontract.Error
	if errors.As(err, &typed) && typed.Code == linkResolutionFailureCode && report.Phase == "linked" {
		return nil
	}
	return err
}
