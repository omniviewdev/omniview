package devserver

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
	"os/exec"
	"path/filepath"
	"strings"
)

const sdkModulePath = "github.com/omniviewdev/plugin-sdk"

func validSDKRevision(revision string) bool {
	if len(revision) != 40 || revision == strings.Repeat("0", 40) || strings.ToLower(revision) != revision {
		return false
	}
	_, err := hex.DecodeString(revision)
	return err == nil
}

// VerifySelectedSDK validates the actual module selected by Go with GOWORK=off,
// including replacements. expectedRevision is a trusted reviewed fixed-source
// commit supplied by the host build graph, not metadata from the plugin repo.
// The shared source verifier protects the reviewed containment core and records
// ordinary dirty SDK feature changes in the exact build source digest.
func VerifySelectedSDK(ctx context.Context, goPath, source, expectedRevision string, environment []string) (devsource.Identity, error) {
	var result devsource.Identity
	if !validSDKRevision(expectedRevision) {
		return result, fmt.Errorf("trusted exact fixed SDK revision is required")
	}
	tool, err := resolveTool(goPath, "go")
	if err != nil {
		return result, err
	}
	cmd := exec.CommandContext(ctx, tool, "list", "-m", "-json", sdkModulePath)
	cmd.Dir = source
	cmd.Env = goBuildEnv(environment)
	output, err := cmd.Output()
	if err != nil {
		return result, fmt.Errorf("resolve selected SDK module: %w", err)
	}
	var module struct {
		Path    string
		Dir     string
		Replace *struct {
			Path string
			Dir  string
		}
	}
	if err = json.Unmarshal(output, &module); err != nil {
		return result, err
	}
	if module.Path != sdkModulePath {
		return result, fmt.Errorf("selected module is not plugin SDK")
	}
	directory := module.Dir
	if module.Replace != nil {
		directory = module.Replace.Dir
	}
	if directory == "" {
		return result, fmt.Errorf("selected SDK module source directory unavailable")
	}
	directory, err = filepath.EvalSymlinks(directory)
	if err != nil {
		return result, err
	}
	values := map[string]string{}
	for _, entry := range environment {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	allowCoreChanges := values["OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES"] == "1"
	if allowCoreChanges {
		manifest, root := values[devcontract.WorkspaceEnvironment], values["OMNIVIEW_STATE_DIR"]
		if manifest == "" || root == "" {
			return result, fmt.Errorf("isolation source changes require an explicit validated workspace profile")
		}
		workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: manifest, StateRoot: root})
		if err != nil {
			return result, err
		}
		if workspace.Manifest.WorkspaceID != values["OMNIVIEW_WORKSPACE_ID"] {
			return result, fmt.Errorf("isolation source changes workspace identity mismatch")
		}
	}
	return devsource.VerifyWithOptions(ctx, directory, expectedRevision, devsource.VerifyOptions{AllowIsolationCoreChanges: allowCoreChanges})
}
