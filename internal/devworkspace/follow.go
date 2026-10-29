package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

const (
	followConflictExit  = 4
	followUsageExit     = 2
	followUpstreamExit  = 5
	followFenceInterval = 100 * time.Millisecond
	followLockInterval  = 50 * time.Millisecond
)

const followDefaultInterval = 30 * time.Second
const followMinimumInterval = 5 * time.Second
const followMaximumBackoff = 5 * time.Minute
const followBackoffThreshold = followMaximumBackoff / followBackoffFactor
const followBackoffFactor = 2
const followUnreachable = "unreachable"
const followApplying = "applying"
const followApplied = "applied"
const followApplyFailed = "apply_failed"

type FollowOptions struct {
	UpdateOptions
	Interval time.Duration
	Apply    bool
	now      func() time.Time
	wait     func(context.Context, time.Duration) error
}

type FollowStatus struct {
	WorkspaceID     string                      `json:"workspaceID"`
	Enabled         bool                        `json:"enabled"`
	Apply           bool                        `json:"apply"`
	Owner           string                      `json:"owner"`
	Process         devcontract.ProcessIdentity `json:"process"`
	LastObservation time.Time                   `json:"lastObservation,omitempty"`
	NextAttempt     time.Time                   `json:"nextAttempt,omitempty"`
	ActiveOperation string                      `json:"activeOperation,omitempty"`
	PendingCohort   string                      `json:"pendingCohort,omitempty"`
	Result          string                      `json:"result"`
	BlockedReason   string                      `json:"blockedReason,omitempty"`
	NextCommand     string                      `json:"nextCommand,omitempty"`
	NextArgv        []string                    `json:"nextArgv,omitempty"`
	Plan            *UpdatePlan                 `json:"plan,omitempty"`
	Error           string                      `json:"error,omitempty"`
}

type followFence struct {
	WorkspaceID string `json:"workspaceID"`
	Epoch       string `json:"epoch"`
}

func followDirectory(m *Manager, w Workspace) (string, error) {
	path, err := upstreamRecoveryDirectory(m, w)
	if err != nil {
		return "", err
	}
	private, err := devsession.EnsurePrivateDirectory(path)
	if err != nil {
		return "", err
	}
	if private != path {
		return "", devcontract.Fail(followConflictExit, "foreign_recovery", "follow authority directory cannot be redirected")
	}
	return private, nil
}

func upstreamRecoveryDirectory(m *Manager, w Workspace) (string, error) {
	id, err := uuid.Parse(w.Manifest.WorkspaceID)
	if err != nil || id == uuid.Nil || id.String() != w.Manifest.WorkspaceID {
		return "", devcontract.Fail(followConflictExit, "foreign_recovery", "recovery requires an exact workspace UUID")
	}
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", id.String())
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", devcontract.Fail(followConflictExit, "foreign_recovery", "follow authority directory cannot be redirected")
	}
	return canonical, nil
}

// fenceFollow revokes foreground consent before a public down operation.
func (m *Manager) fenceFollow(ctx context.Context, name string) error {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return err
	}
	dir, err := followDirectory(m, w)
	if err != nil {
		return err
	}
	return atomicOwnedJSON(
		filepath.Join(dir, "follow-fence.json"),
		followFence{w.Manifest.WorkspaceID, uuid.NewString()}, w.Manifest.WorkspaceID,
	)
}

func cohortKey(plan UpdatePlan) string {
	// Hash only the immutable selected targets, not transient observation metadata.
	targets := make(map[string]string, len(plan.Repositories))
	for _, r := range plan.Repositories {
		targets[r.ID] = r.TargetSHA
	}
	raw, _ := json.Marshal(targets)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func followConfigurationFingerprint(manifest devcontract.WorkspaceManifest) string {
	// BaseCommit records update progress, including a failed apply that needs
	// explicit recovery. It does not change the selected ref or upstream policy.
	manifest.Repositories = append([]devcontract.Repository(nil), manifest.Repositories...)
	for i := range manifest.Repositories {
		manifest.Repositories[i].BaseCommit = ""
	}
	return UpdateConfigurationFingerprint(manifest)
}

// Follow owns scheduling only. Update and the existing supervisor own all producers.
func (m *Manager) Follow(
	ctx context.Context, name string, options FollowOptions, emit func(FollowStatus) error,
) (resultErr error) {
	if err := normalizeFollowOptions(&options); err != nil {
		return err
	}
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return err
	}
	dir, err := followDirectory(m, w)
	if err != nil {
		return err
	}
	release, err := tryLock(filepath.Join(dir, "follow.lock"))
	if err != nil {
		return devcontract.Fail(followConflictExit, "follow_owned",
			"another foreground follower owns this workspace; stop it or run workspace down before following")
	}
	defer release()
	fencePath := filepath.Join(dir, "follow-fence.json")
	var initial followFence
	err = devsession.ReadPrivateJSON(fencePath, &initial)
	fenceExisted := err == nil
	if err == nil {
		if initial.WorkspaceID != w.Manifest.WorkspaceID || initial.Epoch == "" {
			return devcontract.Fail(followConflictExit, "foreign_recovery", "follow fence identity differs")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	owned, cancelCause := context.WithCancelCause(ctx)
	cancel := func() { cancelCause(context.Canceled) }
	defer cancel()
	monitorDone := make(chan struct{})
	go monitorFollowFence(owned, cancelCause, monitorDone, fencePath, initial, fenceExisted, w.Manifest.WorkspaceID)
	defer func() { cancel(); <-monitorDone }()
	status, captureErr := newFollowStatus(w, options.Apply)
	if captureErr != nil {
		return captureErr
	}
	defer func() {
		status.Enabled = false
		status.NextAttempt = time.Time{}
		_ = atomicOwnedJSON(filepath.Join(dir, "follow-status.json"), status, w.Manifest.WorkspaceID)
	}()
	publish := func() error {
		saveErr := atomicOwnedJSON(filepath.Join(dir, "follow-status.json"), status, w.Manifest.WorkspaceID)
		if saveErr != nil {
			return saveErr
		}
		if emit != nil {
			return emit(status)
		}
		return nil
	}
	interruptedApply := false
	defer func() {
		resultErr = finishFollow(owned, &status, interruptedApply, publish, resultErr)
	}()
	return m.runFollow(owned, name, w, options, &status, publish, &interruptedApply)
}

func normalizeFollowOptions(options *FollowOptions) error {
	if options.now == nil {
		options.now = time.Now
	}
	if options.wait == nil {
		options.wait = waitFollowInterval
	}
	if options.Interval == 0 {
		options.Interval = followDefaultInterval
	}
	if options.Interval < followMinimumInterval {
		return devcontract.Fail(followUsageExit, "invalid_follow_interval", "follow interval must be at least 5s")
	}
	return nil
}

func newFollowStatus(w Workspace, apply bool) (FollowStatus, error) {
	var status FollowStatus
	status.WorkspaceID = w.Manifest.WorkspaceID
	status.Enabled = true
	status.Apply = apply
	status.Owner = uuid.NewString()
	status.Result = "observing"
	process, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: status.Owner, Role: "follower", Source: w.Root,
	})
	status.Process = process
	return status, err
}

func finishFollow(
	ctx context.Context, status *FollowStatus, interruptedApply bool, publish func() error, resultErr error,
) error {
	if errors.Is(context.Cause(ctx), errFollowFenceIntegrity) {
		status.Result = updateBlocked
		status.Enabled = false
		status.BlockedReason = "follow_fence_invalid"
		_ = publish()
		return devcontract.Fail(followConflictExit, "follow_fence_invalid",
			"follow consent metadata changed unexpectedly; no further updates are authorized")
	}
	if (errors.Is(context.Cause(ctx), errFollowConsentRevoked) ||
		errors.Is(resultErr, errFollowConsentRevoked)) && !interruptedApply {
		status.Result = "consent_revoked"
		status.Enabled = false
		status.ActiveOperation = ""
		status.NextAttempt = time.Time{}
		status.Plan = nil
		status.PendingCohort = ""
		status.NextCommand = ""
		status.NextArgv = nil
		return publish()
	}
	return resultErr
}

func monitorFollowFence(
	ctx context.Context, cancel context.CancelCauseFunc, done chan<- struct{},
	path string, initial followFence, existed bool, workspaceID string,
) {
	defer close(done)
	ticker := time.NewTicker(followFenceInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var current followFence
			readErr := devsession.ReadPrivateJSON(path, &current)
			switch {
			case readErr == nil && (current.WorkspaceID != workspaceID || current.Epoch == ""):
				cancel(errFollowFenceIntegrity)
				return
			case readErr == nil && current != initial:
				cancel(errFollowConsentRevoked)
				return
			case readErr != nil && (existed || !os.IsNotExist(readErr)):
				cancel(errFollowFenceIntegrity)
				return
			}
		}
	}
}

func (m *Manager) runFollow(
	ctx context.Context, name string, w Workspace, options FollowOptions,
	status *FollowStatus, publish func() error, interruptedApply *bool,
) error {
	var failedCohort followFailedCohort
	var consent string
	if options.Apply {
		consent = followConfigurationFingerprint(w.Manifest)
	}
	delay := options.Interval
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		plan, observeErr := m.PlanUpdate(ctx, name, options.UpdateOptions)
		if options.Apply {
			current, err := m.Inspect(ctx, name)
			if err != nil {
				return err
			}
			if followConfigurationFingerprint(current.Manifest) != consent {
				status.BlockedReason = "configuration_changed"
				return errFollowConsentRevoked
			}
		}
		resetFollowObservation(status, &plan)
		observeErr = followObservationError(plan, observeErr)
		retained, pending, pendingErr := m.pendingUpdatePlan(w)
		if pendingErr != nil {
			return pendingErr
		}
		switch {
		case pending:
			m.blockFollowRecovery(name, status, retained)
			recordFollowObservation(status, plan, observeErr, options.now)
			delay = options.Interval
		case observeErr != nil:
			if ctx.Err() != nil {
				return ctx.Err()
			}
			status.Result = "observation_failed"
			status.BlockedReason = followErrorCode(observeErr, "upstream_unreachable")
			delay = followBackoff(delay)
		default:
			delay = options.Interval
			status.LastObservation = options.now().UTC()
			status.Result = plan.Result
			status.PendingCohort = cohortKey(plan)
			if err := m.followObservedPlan(ctx, name, options, status, plan, &failedCohort,
				publish, interruptedApply); err != nil {
				return err
			}
		}
		status.NextAttempt = options.now().UTC().Add(delay)
		if err := publish(); err != nil {
			return err
		}
		if err := options.wait(ctx, delay); err != nil {
			return err
		}
	}
}

func resetFollowObservation(status *FollowStatus, plan *UpdatePlan) {
	status.Plan = plan
	status.ActiveOperation = ""
	status.BlockedReason = ""
	status.Error = ""
	status.NextCommand = plan.NextCommand
	status.NextArgv = plan.NextArgv
}

func followObservationError(plan UpdatePlan, err error) error {
	if err != nil {
		return err
	}
	for _, repository := range plan.Repositories {
		if repository.Classification == followUnreachable {
			return devcontract.Fail(followUpstreamExit, "upstream_unreachable", "configured upstream could not be fetched")
		}
	}
	return nil
}

func followErrorCode(err error, fallback string) string {
	// Raw child diagnostics may contain credentials. Public failures stay typed.
	var typed *devcontract.Error
	if errors.As(err, &typed) {
		return typed.Code
	}
	return fallback
}

func (m *Manager) blockFollowRecovery(name string, status *FollowStatus, retained *UpdatePlan) {
	status.Result = "blocked_recovery"
	status.BlockedReason = "explicit_recovery_required"
	if retained != nil {
		status.Plan = retained
		status.ActiveOperation = retained.OperationID
	}
	m.followRecoveryCommand(name, status)
}

func (m *Manager) followRecoveryCommand(name string, status *FollowStatus) {
	status.NextArgv = []string{"omniview-dev", "workspace", "recover", name, "--root", m.Root}
	status.NextCommand = shellCommand(status.NextArgv)
}

type followFailedCohort struct {
	key           string
	blockedReason string
	nextCommand   string
	nextArgv      []string
}

func (m *Manager) followObservedPlan(
	ctx context.Context, name string, options FollowOptions, status *FollowStatus, plan UpdatePlan,
	failedCohort *followFailedCohort, publish func() error, interruptedApply *bool,
) error {
	key := status.PendingCohort
	if !options.Apply || plan.Result != updateAvailable {
		return nil
	}
	if failedCohort.key == key {
		status.Result = "blocked_failed_cohort"
		status.BlockedReason = failedCohort.blockedReason
		status.NextCommand = failedCohort.nextCommand
		status.NextArgv = failedCohort.nextArgv
		return nil
	}
	status.ActiveOperation = plan.OperationID
	status.Result = followApplying
	if err := publish(); err != nil {
		return err
	}
	applyOptions := options.UpdateOptions
	applyOptions.Check = false
	result, applyErr := m.applyPlannedUpdate(ctx, name, plan, applyOptions)
	status.Plan = result.Plan
	status.ActiveOperation = ""
	if applyErr == nil {
		status.Result = followApplied
		var cleared followFailedCohort
		*failedCohort = cleared
		return nil
	}
	status.Result = followApplyFailed
	status.BlockedReason = followErrorCode(applyErr, "update_failed")
	m.followRecoveryCommand(name, status)
	var typed *devcontract.Error
	if errors.As(applyErr, &typed) && typed.Code == "supervisor_upgrade_required" {
		status.NextArgv, _ = typed.Details["nextArgv"].([]string)
		status.NextCommand, _ = typed.Details["nextCommand"].(string)
	}
	*failedCohort = followFailedCohort{
		key: key, blockedReason: "explicit_recovery_required",
		nextCommand: status.NextCommand, nextArgv: status.NextArgv,
	}
	if status.BlockedReason == "supervisor_upgrade_required" {
		failedCohort.blockedReason = status.BlockedReason
	}
	if err := publish(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		*interruptedApply = true
		return ctx.Err()
	}
	return nil
}

func followBackoff(delay time.Duration) time.Duration {
	if delay >= followBackoffThreshold {
		return followMaximumBackoff
	}
	return delay * followBackoffFactor
}

func waitFollowInterval(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// waitUpdateAuthority joins an in-flight update after down revokes follow consent.
// It never holds a lifecycle/root lock while waiting for the supervisor.
func (m *Manager) waitUpdateAuthority(ctx context.Context, name string) (func(), error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return nil, err
	}
	directory, err := followDirectory(m, w)
	if err != nil {
		return nil, err
	}
	for {
		release, lockErr := tryLock(filepath.Join(directory, "refresh.lock"))
		if lockErr == nil {
			return release, nil
		}
		var typed *devcontract.Error
		if !errors.As(lockErr, &typed) || typed.Code != "workspace_busy" {
			return nil, lockErr
		}
		if err = waitFollowInterval(ctx, followLockInterval); err != nil {
			return nil, err
		}
	}
}

var errFollowConsentRevoked = errors.New("foreground follow consent revoked")

var errFollowFenceIntegrity = errors.New("foreground follow consent metadata changed")

func (m *Manager) pendingUpdatePlan(w Workspace) (*UpdatePlan, bool, error) {
	if intent, err := readSourceUpdate(m, w); err == nil {
		return &intent.Plan, true, nil
	} else if !os.IsNotExist(err) {
		return nil, false, err
	}
	var intent refreshIntent
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	if err := devsession.ReadPrivateJSON(path, &intent); err == nil {
		if intent.WorkspaceID != w.Manifest.WorkspaceID || intent.Root != w.Root {
			return nil, false, devcontract.Fail(followConflictExit, "foreign_recovery", "retained update identity differs")
		}
		return intent.Plan, true, nil
	} else if !os.IsNotExist(err) {
		return nil, false, err
	}
	return nil, false, nil
}

func recordFollowObservation(status *FollowStatus, plan UpdatePlan, err error, now func() time.Time) {
	if err == nil {
		status.LastObservation = now().UTC()
		status.PendingCohort = cohortKey(plan)
	}
}
