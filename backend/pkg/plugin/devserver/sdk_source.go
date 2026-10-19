package devserver

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
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
// Managed workspace verification also binds that module to the canonical SDK
// checkout selected by the explicitly validated workspace/profile.
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
	for _, entry := range cmd.Env {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	allowCoreChanges := values["OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES"] == "1"
	manifest, root := values[devcontract.WorkspaceEnvironment], values["OMNIVIEW_STATE_DIR"]
	workspaceID := values["OMNIVIEW_WORKSPACE_ID"]
	if manifest != "" || workspaceID != "" || allowCoreChanges {
		if manifest == "" || root == "" || workspaceID == "" {
			return result, fmt.Errorf("managed SDK verification requires an explicit validated workspace profile")
		}
		workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: manifest, StateRoot: root})
		if err != nil {
			return result, err
		}
		if workspace.Manifest.WorkspaceID != workspaceID {
			return result, fmt.Errorf("SDK verification workspace identity mismatch")
		}
		if workspace.Manifest.Links.SDKRepositoryID == nil {
			return result, fmt.Errorf("managed workspace must explicitly select an SDK source repository")
		}
		selected, err := workspace.RepositoryPath(*workspace.Manifest.Links.SDKRepositoryID)
		if err != nil {
			return result, err
		}
		selected, err = devcontract.CanonicalPath(selected)
		if err != nil {
			return result, err
		}
		if directory != selected {
			return result, fmt.Errorf("effective SDK source differs from selected workspace source")
		}
	}
	return devsource.VerifyWithOptions(ctx, directory, expectedRevision, devsource.VerifyOptions{AllowIsolationCoreChanges: allowCoreChanges})
}
