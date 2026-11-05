package devserver

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
)

const sdkModulePath = "github.com/omniviewdev/plugin-sdk"

// VerifySelectedSDK identifies the SDK module selected by Go, including
// replacements, and binds managed workspaces to their selected checkout.
func VerifySelectedSDK(ctx context.Context, goPath, source string, environment []string) (devsource.Identity, error) {
	var result devsource.Identity
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
	if err := verifyManagedSDKSelection(directory, values); err != nil {
		return result, err
	}
	return devsource.Verify(ctx, directory)
}

func verifyManagedSDKSelection(directory string, values map[string]string) error {
	manifest, root := values[devcontract.WorkspaceEnvironment], values["OMNIVIEW_STATE_DIR"]
	workspaceID := values["OMNIVIEW_WORKSPACE_ID"]
	if manifest == "" && workspaceID == "" {
		return nil
	}
	if manifest == "" || root == "" || workspaceID == "" {
		return fmt.Errorf("managed SDK verification requires an explicit validated workspace profile")
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: manifest, StateRoot: root})
	if err != nil {
		return err
	}
	if workspace.Manifest.WorkspaceID != workspaceID {
		return fmt.Errorf("SDK verification workspace identity mismatch")
	}
	if workspace.Manifest.Links.SDKRepositoryID == nil {
		return fmt.Errorf("managed workspace must explicitly select an SDK source repository")
	}
	selected, err := workspace.RepositoryPath(*workspace.Manifest.Links.SDKRepositoryID)
	if err != nil {
		return err
	}
	selected, err = devcontract.CanonicalPath(selected)
	if err != nil {
		return err
	}
	if directory != selected {
		return fmt.Errorf("effective SDK source differs from selected workspace source")
	}
	return nil
}
