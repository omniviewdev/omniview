package devworkspace

import (
	"context"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devoutputs"
)

// InspectOwnership enumerates every selected composition module root and staged
// producer, including unowned standalone trees. It does not install, lock, or
// create metadata. Launch repeats admission before starting each real writer.
func InspectOwnership(ctx context.Context, w Workspace) (devoutputs.Inspection, error) {
	plan, err := makeLinkPlan(w)
	if err != nil {
		return devoutputs.Inspection{}, err
	}
	requests := []devoutputs.Request{devoutputs.ModuleRequest(w.Root)}
	for _, pkg := range plan.Composition.Packages {
		requests = append(requests, devoutputs.ModuleRequest(pkg.Path))
	}
	nodes, err := planBuildNodes(w)
	if err != nil {
		return devoutputs.Inspection{}, err
	}
	for _, node := range nodes {
		switch node.Kind {
		case bindingsNode:
			requests = append(requests, devoutputs.Request{Consumer: node.Directory, Producer: devoutputs.Bindings})
		case "javascript":
			requests = append(requests, devoutputs.Request{Consumer: node.Directory, Producer: devoutputs.Distribution})
			if node.ID == "vite-plugin" {
				requests = append(requests, devoutputs.Request{Consumer: node.Directory, Producer: devoutputs.Shims})
			}
			if node.ID == "host-frontend" {
				requests = append(requests, devoutputs.Request{Consumer: node.Directory, Producer: devoutputs.YAMLWorker})
			}
		}
	}
	report, err := devoutputs.Inspect(ctx, w.ResolvedWorkspace, requests)
	if err != nil {
		return report, err
	}
	report.LifecyclePhase = "unlinked"
	if j, e := loadLinkJournal(w); e == nil {
		report.LifecyclePhase = j.Phase
	} else if !os.IsNotExist(e) {
		return report, e
	}
	report.ReentryGuidance = "Preserve every unowned dependency root externally before linking; no automatic adoption or deletion is authorized. Stop the workspace before moving any root. Retain source and profile data."
	if report.LifecyclePhase == "applying" {
		report.ReentryGuidance += " Run workspace unlink with this exact workspace target to retire the interrupted overlay before linking again. Unlink may refuse changed owned outputs; it does not authorize deletion of standalone trees."
	}
	return report, nil
}

// OwnershipMetadataPaths exposes output metadata separately from runtime and
// profile state. The producer journal intentionally lives outside worktrees.
func OwnershipMetadataPaths(w Workspace) map[string]string {
	directory := filepath.Join(filepath.Dir(filepath.Dir(w.Root)), ".omniview-dev", "repository-outputs", w.Manifest.WorkspaceID)
	return map[string]string{
		"repositoryOutputs":         filepath.Join(directory, "journal.json"),
		"repositoryOutputDirectory": directory,
		"workspaceOwnership":        filepath.Join(w.Root, ".local", "ownership.json"),
		"links":                     filepath.Join(w.Root, ".local", "links.json"),
		"launchStatus":              filepath.Join(w.Root, ".local", "launch-status.json"),
		"profileState":              w.StateRoot,
	}
}
