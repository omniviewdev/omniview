//go:build e2eapplication

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"syscall"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

type configuration struct {
	Root     string            `json:"root"`
	Sources  map[string]string `json:"sources"`
	Refs     map[string]string `json:"refs"`
	Evidence string            `json:"evidence"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	resetModules := len(os.Args) == 4 && os.Args[1] == "retire" && os.Args[3] == "--reset-modules"
	if len(os.Args) < 3 || (os.Args[1] != "run" && os.Args[1] != "build" && os.Args[1] != "build-plugin-ui" && os.Args[1] != "sdk-identity" && len(os.Args) != 3 && !resetModules) {
		return fmt.Errorf("expected prepare|verify|retire [--reset-modules]|run|build|build-plugin-ui|sdk-identity and private cohort configuration")
	}
	var config configuration
	if err := devsession.ReadPrivateJSON(os.Args[2], &config); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	const target = "application-build"
	if os.Args[1] == "prepare" {
		var ids []string
		for id := range config.Sources {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		var sources []devworkspace.SourceSpec
		for _, id := range ids {
			sources = append(sources, devworkspace.SourceSpec{ID: id, Path: config.Sources[id], DefaultRef: config.Refs[id]})
		}
		if _, err := devworkspace.Init(ctx, devworkspace.InitOptions{Root: config.Root, Sources: sources}); err != nil {
			return err
		}
	}
	manager, err := devworkspace.Open(config.Root, devworkspace.Options{Stopped: devworkspace.RequireStopped})
	if err != nil {
		return err
	}
	var result any
	switch os.Args[1] {
	case "build-plugin-ui":
		if len(os.Args) != 4 || os.Args[3] == "" {
			return fmt.Errorf("plugin UI build requires the selected plugin ID")
		}
		assets, buildErr := manager.BuildPluginUI(ctx, target, os.Args[3], os.Stderr)
		if buildErr != nil {
			return buildErr
		}
		result = map[string]string{"assets": assets}
	case "build":
		if len(os.Args) != 5 {
			return fmt.Errorf("application build requires private artifact directory and execution report")
		}
		workspace, inspectErr := manager.Inspect(ctx, target)
		if inspectErr != nil {
			return inspectErr
		}
		if err = devworkspace.RequireStopped(ctx, workspace.ResolvedWorkspace); err != nil {
			return err
		}
		if err = buildApplicationCohort(ctx, manager, target, config, os.Args[2], os.Args[3], os.Args[4]); err != nil {
			return err
		}
		result = map[string]bool{"built": true}
	case "sdk-identity":
		if len(os.Args) != 5 {
			return fmt.Errorf("SDK identity requires actual consumer directory and effective modfile")
		}
		result, err = applicationSDKIdentity(ctx, manager, target, config, os.Args[3], os.Args[4])
	case "run":
		if len(os.Args) < 5 {
			return fmt.Errorf("owned cohort command requires directory and program")
		}
		workspace, inspectErr := manager.Inspect(ctx, target)
		if inspectErr != nil {
			return inspectErr
		}
		if err = devworkspace.RequireStopped(ctx, workspace.ResolvedWorkspace); err != nil {
			return err
		}
		command := exec.Command(os.Args[4], os.Args[5:]...)
		command.Dir, command.Env, command.Stdout, command.Stderr = os.Args[3], os.Environ(), os.Stdout, os.Stderr
		return devworkspace.RunRepositoryCommand(ctx, command, devsession.ProcessOwner{WorkspaceID: workspace.Manifest.WorkspaceID, Generation: uuid.NewString(), Role: "application-build-command", Source: command.Dir})
	case "prepare":
		if _, err = manager.Create(ctx, devworkspace.CreateOptions{Slug: target, Repositories: []string{"plugin-sdk", "ui"}, Plugins: []string{"kubernetes", "workspace-probe"}}); err != nil {
			return err
		}
		var evidence devworkspace.LinkProtocolEvidence
		if err = devsession.ReadPrivateJSON(config.Evidence, &evidence); err != nil {
			return err
		}
		if _, err = manager.Link(ctx, target, devworkspace.LinkOptions{Evidence: evidence}); err != nil {
			return err
		}
		result, err = manager.ApplicationFixturePackageCommands(ctx, target)
	case "verify":
		report, inspectErr := manager.InspectLinks(ctx, target)
		if inspectErr != nil {
			return inspectErr
		}
		if report.Phase != "linked" {
			return fmt.Errorf("application cohort is not linked")
		}
		for _, resolution := range report.Resolutions {
			if resolution.Problem != "" {
				return fmt.Errorf("actual selected package resolution failed for %s", resolution.Package)
			}
		}
		paths, pathsErr := manager.Paths(ctx, target)
		if pathsErr != nil {
			return pathsErr
		}
		if err = validateApplicationUIResolutions(paths, report); err != nil {
			return err
		}
		result = report
	case "retire":
		workspace, inspectErr := manager.Inspect(ctx, target)
		if inspectErr != nil {
			return inspectErr
		}
		if err = devworkspace.RequireStopped(ctx, workspace.ResolvedWorkspace); err != nil {
			return err
		}
		if err = unlinkApplicationCohort(ctx, manager, target, resetModules); err != nil {
			return err
		}
		result, err = manager.RemoveWorkspace(ctx, target, devworkspace.RemoveOptions{PurgeState: true, DeleteBranches: true}, os.Stderr)
	default:
		return fmt.Errorf("unsupported cohort operation")
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

// This recovery is explicit and limited to the owned application fixture.
// The first Unlink must retain its normal ownership guards and reach unlinking;
// ResetModules then deletes dependencies only before canonical Unlink resumes.
func unlinkApplicationCohort(ctx context.Context, manager *devworkspace.Manager, target string, resetModules bool) error {
	_, unlinkErr := manager.Unlink(ctx, target)
	if unlinkErr == nil || !resetModules {
		return unlinkErr
	}
	if target != "application-build" {
		return fmt.Errorf("dependency reset is limited to the owned application cohort: %w", unlinkErr)
	}
	links, err := manager.InspectLinks(ctx, target)
	if err != nil {
		return fmt.Errorf("inspect interrupted cohort unlink: %w (initial unlink: %v)", err, unlinkErr)
	}
	if links.Phase != "unlinking" {
		return unlinkErr
	}
	fmt.Fprintf(os.Stderr, "application cohort dependency reset after guarded unlink: %v\n", unlinkErr)
	reset, err := manager.ResetModules(ctx, target)
	if err != nil {
		return fmt.Errorf("reset application cohort dependencies during unlink: %w", err)
	}
	if reset.Phase != "unlinking" || reset.Reinstalled {
		return fmt.Errorf("application cohort dependency reset did not remain delete-only in unlinking phase")
	}
	_, err = manager.Unlink(ctx, target)
	return err
}

func validateApplicationUIResolutions(paths devworkspace.WorkspacePaths, report devworkspace.LinkReport) error {
	for _, name := range []string{"base-ui", "ai-ui", "editors"} {
		expected := filepath.Join(paths.Repositories["ui"], "packages", name)
		found := false
		for _, resolution := range report.Resolutions {
			if resolution.Consumer != paths.Repositories["omniview"] || resolution.Package != "@omniviewdev/"+name {
				continue
			}
			if resolution.Problem != "" || resolution.Expected != expected || resolution.Resolved != expected {
				return fmt.Errorf("host did not consume actual selected UI package %s", name)
			}
			found = true
		}
		if !found {
			return fmt.Errorf("missing actual selected UI resolution for %s", name)
		}
	}
	return nil
}
