package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"golang.org/x/mod/modfile"
)

// Preflight reads the selected graph before installers, bindings or compilers run.
func compatibilityPreflight(ctx context.Context, w Workspace, verify devsdk.Verifier) error {
	plan, err := makeLinkPlan(w)
	if err != nil {
		return err
	}
	sdk, ok := plan.SDK.Directory()
	if !ok {
		return sdkSourceRequired(ctx, "select the plugin-sdk repository before launching", workspaceSDKProbes(w), editAddSDKCommand(w))
	}
	sdkBytes, err := os.ReadFile(filepath.Join(sdk, "go.mod"))
	if err != nil {
		return err
	}
	sdkModule, err := modfile.Parse("go.mod", sdkBytes, nil)
	if err != nil || sdkModule.Module == nil || sdkModule.Module.Mod.Path != devsdk.Module {
		return devcontract.Fail(3, "sdk_contract_mismatch", "selected SDK must declare module "+devsdk.Module+"; select a compatible SDK repository")
	}
	if _, err = verify(ctx, plan.SDK); err != nil {
		return err
	}
	for _, root := range plan.GoRoots {
		bytes, err := os.ReadFile(filepath.Join(root, "go.mod"))
		if err != nil {
			return err
		}
		module, parseErr := modfile.Parse("go.mod", bytes, nil)
		if parseErr != nil {
			return devcontract.Fail(3, "sdk_contract_mismatch", fmt.Sprintf("%s/go.mod is invalid; repair the selected source before building", filepath.Base(root)))
		}
		declaresSDK := false
		for _, requirement := range module.Require {
			if requirement.Mod.Path == devsdk.Module {
				declaresSDK = true
				break
			}
		}
		if !declaresSDK {
			return devcontract.Fail(3, "sdk_contract_mismatch", fmt.Sprintf("%s/go.mod does not declare %s; select compatible host and plugin branches", filepath.Base(root), devsdk.Module))
		}
		if err := validateSDKImports(ctx, root, sdk); err != nil {
			return err
		}
	}
	return validateRuntimeUIContracts(w, plan)
}

func validateRuntimeUIContracts(w Workspace, plan linkPlan) error {
	host, err := w.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	runtimePaths := map[string]bool{host: true}
	for _, consumer := range plan.Consumers {
		for _, target := range consumer.Targets {
			runtimePaths[target] = true
		}
	}
	for _, plugin := range w.Manifest.Plugins {
		root, err := w.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			return err
		}
		frontend := filepath.Join(root, "ui")
		if _, err := os.Stat(filepath.Join(frontend, "package.json")); os.IsNotExist(err) {
			frontend = root
		} else if err != nil {
			return err
		}
		runtimePaths[frontend] = true
	}
	for _, consumer := range plan.Consumers {
		if !runtimePaths[consumer.Path] {
			continue
		}
		pkg, err := readLinkPackage(consumer.Path)
		if err != nil {
			return err
		}
		for _, section := range []string{"dependencies", "peerDependencies", "devDependencies"} {
			dependencies, _ := pkg[section].(map[string]any)
			for dependency := range dependencies {
				if dependency == "@omniviewdev/ui" || strings.HasPrefix(dependency, "@mui/") || strings.HasPrefix(dependency, "@emotion/") {
					path, _ := filepath.Rel(w.Root, consumer.Path)
					return devcontract.Fail(3, "ui_contract_mismatch", fmt.Sprintf("%s declares unsupported shared UI dependency %s; migrate to @omniviewdev/base-ui and select compatible plugin branches", path, dependency))
				}
			}
		}
	}
	return nil
}

var diagnosticSecret = regexp.MustCompile(`(?i)(bearer\s+)[^\s]+|((?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s,;]+|([a-z][a-z0-9+.-]*://)[^/@\s]+:[^/@\s]+@`)

func safeCompilerDiagnostic(text, root string) string {
	text = diagnosticSecret.ReplaceAllString(text, "${1}${2}${3}[REDACTED]")
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		key = strings.ToLower(key)
		if ok && len(value) >= 4 && (strings.Contains(key, "token") || strings.Contains(key, "secret") || strings.Contains(key, "password") || strings.Contains(key, "api_key")) {
			text = strings.ReplaceAll(text, value, "[REDACTED]")
		}
	}
	text = strings.ReplaceAll(text, root, "$WORKSPACE")
	if home, err := os.UserHomeDir(); err == nil {
		text = strings.ReplaceAll(text, home, "$HOME")
	}
	if len(text) > 8192 {
		text = text[len(text)-8192:]
	}
	return strings.TrimSpace(text)
}

// workspaceOwnershipError preserves typed ownership data without treating
// arbitrary compiler output as structured or trusted diagnostic fields.
func workspaceOwnershipError(err error, w Workspace) *devcontract.Error {
	var original *devoutputs.Conflict
	if !errors.As(err, &original) {
		return workspaceError(err)
	}
	conflict := *original
	executable, err := os.Executable()
	if err != nil {
		conflict.NextCommands = nil
		payload := workspaceError(&conflict)
		payload.Details["recoveryUnavailable"] = "cannot identify the invoking executable for recovery guidance"
		return payload
	}
	conflict.NextCommands = [][]string{
		{executable, "workspace", "ownership", "--workspace", w.ManifestPath, "--json"},
		{executable, "workspace", "down", "--workspace", w.ManifestPath},
	}
	repairAvailable := true
	if j, e := loadLinkJournal(w); e == nil {
		conflict.LifecyclePhase = j.Phase
		if (j.Phase == "linked" || j.Phase == "unlinking" || j.Phase == "applying") && (conflict.Producer == "modules" || conflict.Producer == "vite-cache" || conflict.Producer == "vite-loader-cache" || conflict.Producer == "typescript-cache") {
			// This is an available destructive action, never automatic consent.
			conflict.NextCommands = append(conflict.NextCommands, []string{executable, "workspace", "reset-modules", "--workspace", w.ManifestPath})
			if j.Phase != "unlinking" {
				if inspection, inspectErr := InspectOwnership(context.Background(), w); inspectErr == nil {
					for _, entry := range inspection.Entries {
						if entry.Conflict != nil {
							commands, repairErr := producerPreservationCommands(executable, w, entry.Conflict)
							if repairErr != nil {
								conflict.Guidance += " " + repairErr.Error()
								repairAvailable = false
							}
							conflict.NextCommands = append(conflict.NextCommands, commands...)
						}
					}
				}
			}
			if j.Phase == "unlinking" {
				// Reset only deletes dependencies during teardown; finish the
				// interrupted unlink before attempting another launch.
				conflict.NextCommands = append(conflict.NextCommands, []string{executable, "workspace", "unlink", "--workspace", w.ManifestPath})
			} else if launch, loadErr := LoadLaunchOptions(w); repairAvailable && loadErr == nil && launch.Validate() == nil {
				// A retained refresh must finish first. Without one, Recover
				// would create a stopped refresh and lose the initial up intent.
				conflict.NextCommands = append(conflict.NextCommands, ownershipLaunchRecoveryCommand(executable, w))
			}
		}
	}
	switch conflict.Producer {
	case devoutputs.Bindings, devoutputs.Distribution, devoutputs.Shims, devoutputs.YAMLWorker:
		commands, repairErr := producerPreservationCommands(executable, w, &conflict)
		if repairErr != nil {
			conflict.Guidance += " " + repairErr.Error()
			return workspaceError(&conflict)
		}
		conflict.NextCommands = append(conflict.NextCommands, commands...)
		if launch, loadErr := LoadLaunchOptions(w); loadErr == nil && launch.Validate() == nil {
			conflict.NextCommands = append(conflict.NextCommands, ownershipLaunchRecoveryCommand(executable, w))
		}
		conflict.Guidance += " Run nextCommands in order. New preservation directories must be private and external; interrupted reconciliation must reuse its original exact preservation path."
	}
	payload := workspaceError(&conflict)
	return payload
}

// Each explicit command authorizes preservation of one exact producer boundary.
// Directory creation is exclusive; a collision cannot reuse a foreign location.
func producerPreservationCommands(executable string, w Workspace, conflict *devoutputs.Conflict) ([][]string, error) {
	switch conflict.Producer {
	case devoutputs.Bindings, devoutputs.Distribution, devoutputs.Shims, devoutputs.YAMLWorker:
		destination := conflict.PreservedAt
		var commands [][]string
		if destination == "" {
			base, err := producerPreservationBase(w, conflict.Target, preservationDirectoryIdentity)
			if err != nil {
				return nil, fmt.Errorf("recovery requires a private external preservation directory on the producer filesystem: %w", err)
			}
			preservation := filepath.Join(base, "omniview-preserved-"+uuid.NewString())
			commands = append(commands, []string{"/bin/mkdir", "-m", "700", preservation})
			destination = filepath.Join(preservation, "output")
		}
		return append(commands, []string{executable, "workspace", "reconcile-output", "--workspace", w.ManifestPath, "--consumer", conflict.Consumer, "--producer", string(conflict.Producer), "--preserve-at", destination}), nil
	}
	return nil, nil
}

func ownershipLaunchRecoveryCommand(executable string, w Workspace) []string {
	verb := "restart"
	base := filepath.Join(filepath.Dir(filepath.Dir(w.Root)), ".omniview-dev", "recovery", w.Manifest.WorkspaceID)
	if pending, err := readRecoveryRefresh(w, filepath.Join(base, "refresh.json")); pending || err != nil {
		verb = "recover"
	}
	return []string{executable, "workspace", verb, "--workspace", w.ManifestPath}
}

// Prefer a sibling of the collection, never an owned output or workspace.
// Refuse mount layouts without a known same-volume external parent.
func producerPreservationBase(w Workspace, target string, identity func(string) (generatedFileIdentity, error)) (string, error) {
	base := filepath.Dir(filepath.Dir(filepath.Dir(w.Root)))
	source, err := identity(filepath.Dir(target))
	if err != nil {
		return "", err
	}
	external, err := identity(base)
	if err != nil {
		return "", err
	}
	if source.Device != external.Device {
		return "", fmt.Errorf("collection parent and producer reside on different filesystems; choose an external path on device %s explicitly", source.Device)
	}
	return base, nil
}

func preservationDirectoryIdentity(path string) (generatedFileIdentity, error) {
	file, err := os.Open(path)
	if err != nil {
		return generatedFileIdentity{}, err
	}
	defer file.Close()
	return generatedDirectoryIdentity(file)
}

func supervisedBuildError(event BuildEvent, w Workspace) *devcontract.Error {
	var conflict *devoutputs.Conflict
	if errors.As(event.cause, &conflict) {
		return workspaceOwnershipError(event.cause, w)
	}
	return devcontract.Fail(buildFailureExitCode, "build_failed", safeCompilerDiagnostic(event.Error, w.Root))
}
