package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
)

// Status separates lifecycle/build progress from an identity-checked live host.
// A saved status file is diagnostic history, never evidence of current readiness.
type Status struct {
	Workspace
	Generation      string                          `json:"generation,omitempty"`
	Phase           string                          `json:"launchPhase"`
	Instance        *devcontract.InstanceDescriptor `json:"instance,omitempty"`
	Builds          map[string]BuildEvent           `json:"builds,omitempty"`
	Services        map[string]ServiceStatus        `json:"services,omitempty"`
	LastError       *devcontract.Error              `json:"lastError,omitempty"`
	Health          RuntimeHealth                   `json:"health"`
	Checkouts       map[string]CheckoutStatus       `json:"checkouts,omitempty"`
	ServedCheckouts map[string]CheckoutStatus       `json:"servedCheckouts,omitempty"`
	FailedStage     string                          `json:"failedStage,omitempty"`
	WaitStage       string                          `json:"waitStage,omitempty"`
	RecoveryCommand string                          `json:"recoveryCommand,omitempty"`
	Follow          *FollowStatus                   `json:"follow,omitempty"`
	Update          *UpdatePlan                     `json:"update,omitempty"`

	// SourceUpdateSupported is evidence only in an authenticated live response.
	SourceUpdateSupported bool `json:"sourceUpdateSupported,omitempty"`
}

type ServiceStatus struct {
	URL     string                      `json:"url"`
	HMR     string                      `json:"hmr,omitempty"`
	Process devcontract.ProcessIdentity `json:"process"`
	Ready   bool                        `json:"ready"`
}

func launchPath(w Workspace, name string) string { return filepath.Join(w.Root, ".local", name) }

func rawSaveLaunchJSON(path string, value any) error {
	directory, err := devsession.EnsurePrivateDirectory(filepath.Dir(path))
	if err != nil {
		return err
	}
	if directory != filepath.Dir(path) {
		return devcontract.Fail(4, "launch_conflict", "launch metadata directory is redirected")
	}
	return devsession.WritePrivateJSON(path, value)
}

func readLaunchJSON(path string, value any) error { return devsession.ReadPrivateJSON(path, value) }

func hostDescriptorReady(actual, target devcontract.InstanceDescriptor) error {
	if actual.WorkspaceID != target.WorkspaceID || actual.InstanceID != target.InstanceID || actual.Generation != target.Generation || actual.StateRoot != target.StateRoot {
		return devcontract.Fail(4, "stale_target", "host identity differs from the selected workspace generation")
	}
	if actual.Readiness != "host-ready" && actual.Readiness != "ready" {
		return devcontract.Fail(3, "host_not_ready", "selected host has not completed application startup")
	}
	return nil
}

func profileFor(w Workspace, home, generation string) (instance.Profile, error) {
	return instance.Resolve(instance.Options{Workspace: w.ManifestPath, StateRoot: w.StateRoot, Home: home, Generation: generation, Channel: "local"})
}

// ConnectWorkspaceControl verifies kernel process identity and an authenticated
// protocol round trip. Neither a lease, /health nor an open TCP port is adopted.
func ConnectWorkspaceControl(ctx context.Context, w Workspace, home, generation string) (*devcontrol.Client, devcontract.InstanceDescriptor, error) {
	var descriptor devcontract.InstanceDescriptor
	profile, err := profileFor(w, home, generation)
	if err != nil {
		return nil, descriptor, err
	}
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		return nil, descriptor, err
	}
	discovery, err := store.Read(ctx, w.Manifest.WorkspaceID, generation)
	if err != nil {
		return nil, descriptor, err
	}
	process := discovery.Process
	if err = devsession.VerifyOwnedProcess(process, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: discovery.Generation, Role: "host", Source: process.Source}); err != nil {
		return nil, descriptor, err
	}
	host, err := w.RepositoryPath("omniview")
	if err != nil {
		return nil, descriptor, err
	}
	if process.Source != host || discovery.StateRoot != w.StateRoot || discovery.Endpoints.Control == nil {
		return nil, descriptor, devcontract.Fail(4, "stale_target", "discovery does not name the selected host source/profile")
	}
	token, err := os.ReadFile(discovery.TokenFile)
	if err != nil {
		return nil, descriptor, err
	}
	client, err := devcontrol.NewClient(*discovery.Endpoints.Control, token, w.Manifest.WorkspaceID, discovery.Generation)
	if err != nil {
		return nil, descriptor, err
	}
	response, err := client.Call(ctx, "instance.inspect", devcontrol.EmptyParams{})
	if err != nil {
		client.Close()
		return nil, descriptor, err
	}
	raw, err := json.Marshal(response.Result)
	if err == nil {
		err = json.Unmarshal(raw, &descriptor)
	}
	if err != nil {
		client.Close()
		return nil, descriptor, fmt.Errorf("invalid instance inspection: %w", err)
	}
	if descriptor.WorkspaceID != w.Manifest.WorkspaceID || descriptor.Generation != discovery.Generation || descriptor.Process != process || descriptor.StateRoot != w.StateRoot {
		client.Close()
		return nil, descriptor, devcontract.Fail(4, "stale_target", "authenticated host inspection differs from discovery")
	}
	return client, descriptor, nil
}

func (m *Manager) Status(ctx context.Context, name string) (Status, error) {
	result, err := m.status(ctx, name)
	if result.Manifest.WorkspaceID != "" {
		// Render launch recovery from the selected identity, never from an
		// opaque command retained by a supervisor or an older status record.
		if result.RecoveryCommand != "" {
			result.RecoveryCommand = workspaceRecoveryCommand(result.Workspace, "refresh")
		}
		m.addUpstreamStatus(&result)
	}
	return result, err
}

func (m *Manager) status(ctx context.Context, name string) (Status, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return Status{}, err
	}
	status := Status{Workspace: w, Phase: "stopped", Health: RuntimeHealth{Liveness: "stopped", Build: "unknown", Dependencies: "unknown", ServedSource: "not-serving", Readiness: "not-ready", HMR: "unverified", SourceReload: "unverified"}}
	var record supervisorRecord
	err = readLaunchJSON(launchPath(w, "supervisor.json"), &record)
	if os.IsNotExist(err) {
		status.Checkouts = checkoutStatuses(ctx, w)
		return status, nil
	}
	if err != nil {
		return status, err
	}
	if record.WorkspaceID != w.Manifest.WorkspaceID {
		return status, devcontract.Fail(4, "stale_target", "supervisor metadata belongs to another workspace")
	}
	status.Generation = record.Generation
	if err = verifySupervisor(record, w); err != nil {
		if errors.Is(err, devsession.ErrProcessGone) {
			return exitedSupervisorStatus(ctx, status), nil
		}
		return status, err
	}
	token, err := readSupervisorToken(w, record)
	if err != nil {
		return status, err
	}
	live, err := callSupervisor(ctx, record, token, supervisorStatusCommand)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return status, devcontract.Fail(7, "timeout", "workspace inspection timed out or was canceled; supervisor ownership is retained")
		}
		return status, devcontract.Fail(4, "supervisor_unreachable", "live supervisor cannot be authenticated; refusing adoption or PID-only cleanup")
	}
	// Authentication binds the response to the requested owner, not to the
	// owner still selected after a concurrent restart publishes its successor.
	var current supervisorRecord
	if err = readLaunchJSON(launchPath(w, "supervisor.json"), &current); err != nil || current != record {
		return status, devcontract.Fail(4, "stale_target", "workspace supervisor changed during inspection; retry the selected workspace")
	}
	if err = verifySupervisor(current, w); err != nil {
		if errors.Is(err, devsession.ErrProcessGone) {
			return exitedSupervisorStatus(ctx, status), nil
		}
		return status, err
	}
	live.Workspace = w
	return live, nil
}

// exitedSupervisorStatus preserves diagnostics without treating an obsolete
// ready snapshot as evidence that an exited generation stopped cleanly.
func exitedSupervisorStatus(ctx context.Context, status Status) Status {
	status.Checkouts = checkoutStatuses(ctx, status.Workspace)
	var saved Status
	if readLaunchJSON(launchPath(status.Workspace, "launch-status.json"), &saved) == nil && saved.Generation == status.Generation {
		status.Builds = saved.Builds
		status.LastError = saved.LastError
		status.FailedStage = saved.FailedStage
		status.WaitStage = saved.WaitStage
		status.RecoveryCommand = saved.RecoveryCommand
		status.ServedCheckouts = saved.ServedCheckouts
		if saved.Phase == "stopped" {
			return status
		}
	}
	status.Phase = "crashed"
	status.Health.Liveness = "crashed"
	return status
}

// RequireStopped is suitable for Manager.Options.Stopped. A live supervisor owns
// build outputs even before its host has obtained the profile root lock.
func RequireStopped(ctx context.Context, w devcontract.ResolvedWorkspace) error {
	workspace := Workspace{ResolvedWorkspace: w}
	var record supervisorRecord
	if err := readLaunchJSON(launchPath(workspace, "supervisor.json"), &record); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	err := verifySupervisor(record, workspace)
	if errors.Is(err, devsession.ErrProcessGone) {
		return nil
	}
	if err != nil {
		return err
	}
	return devcontract.Fail(4, "workspace_running", "stop the owned workspace supervisor before changing its source selection")
}
