package devworkspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
	"golang.org/x/mod/modfile"
)

// Preflight reads the selected graph before installers, bindings or compilers run.
func compatibilityPreflight(ctx context.Context, w Workspace, options LaunchOptions) error {
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
	if _, err = devsource.VerifyWithOptions(ctx, plan.SDK, options.ReviewedSDKRevision, devsource.VerifyOptions{AllowIsolationCoreChanges: options.AllowIsolationSourceChanges}); err != nil {
		return devcontract.Fail(4, "sdk_source_untrusted", err.Error())
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
