package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsource"
	"golang.org/x/mod/modfile"
)

// Preflight reads the selected graph before installers, bindings or compilers run.
func compatibilityPreflight(ctx context.Context, w Workspace) error {
	plan, err := makeLinkPlan(w)
	if err != nil {
		return err
	}
	if plan.SDK == "" {
		return devcontract.Fail(2, "sdk_source_required", "select the plugin-sdk repository before launching")
	}
	sdkBytes, err := os.ReadFile(filepath.Join(plan.SDK, "go.mod"))
	if err != nil {
		return err
	}
	sdkModule, err := modfile.Parse("go.mod", sdkBytes, nil)
	if err != nil || sdkModule.Module == nil || sdkModule.Module.Mod.Path != linkedSDK {
		return devcontract.Fail(3, "sdk_contract_mismatch", "selected SDK must declare module "+linkedSDK+"; select a compatible SDK repository")
	}
	if _, err = devsource.Verify(ctx, plan.SDK); err != nil {
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
			if requirement.Mod.Path == linkedSDK {
				declaresSDK = true
				break
			}
		}
		if !declaresSDK {
			return devcontract.Fail(3, "sdk_contract_mismatch", fmt.Sprintf("%s/go.mod does not declare %s; select compatible host and plugin branches", filepath.Base(root), linkedSDK))
		}
		if err := validateSDKImports(ctx, root, plan.SDK); err != nil {
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
	if j, e := loadLinkJournal(w); e == nil {
		conflict.LifecyclePhase = j.Phase
		if (j.Phase == "linked" || j.Phase == "unlinking" || j.Phase == "applying") && (conflict.Producer == "modules" || conflict.Producer == "vite-cache" || conflict.Producer == "vite-loader-cache" || conflict.Producer == "typescript-cache") {
			// This is an available destructive action, never automatic consent.
			conflict.NextCommands = append(conflict.NextCommands, []string{executable, "workspace", "reset-modules", "--workspace", w.ManifestPath})
			if launch, loadErr := LoadLaunchOptions(w); loadErr == nil && launch.Validate() == nil {
				// A retained refresh must finish first. Without one, Recover
				// would create a stopped refresh and lose the initial up intent.
				base := filepath.Join(filepath.Dir(filepath.Dir(w.Root)), ".omniview-dev", "recovery", w.Manifest.WorkspaceID)
				if pending, readErr := readRecoveryRefresh(w, filepath.Join(base, "refresh.json")); pending || readErr != nil {
					conflict.NextCommands = append(conflict.NextCommands, []string{executable, "workspace", "recover", "--workspace", w.ManifestPath})
				} else {
					conflict.NextCommands = append(conflict.NextCommands, []string{executable, "workspace", "restart", "--workspace", w.ManifestPath})
				}
			}
		}
	}
	payload := workspaceError(&conflict)
	return payload
}

func supervisedBuildError(event BuildEvent, w Workspace) *devcontract.Error {
	var conflict *devoutputs.Conflict
	if errors.As(event.cause, &conflict) {
		return workspaceOwnershipError(event.cause, w)
	}
	return devcontract.Fail(buildFailureExitCode, "build_failed", safeCompilerDiagnostic(event.Error, w.Root))
}
