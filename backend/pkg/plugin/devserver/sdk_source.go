package devserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// VerifySelectedSDK identifies the SDK module selected by Go, including
// replacements, and binds managed workspaces to their selected checkout. Only
// source checkouts verify: a published SDK is not accepted yet.
func VerifySelectedSDK(ctx context.Context, goPath, source string, environment []string) (devsdk.Identity, error) {
	return verifySelectedSDK(ctx, devsdk.NewVerifier(devsdk.Policy{}), goPath, source, environment)
}

// verifySelectedSDK resolves the effective SDK module and identifies it with
// verify, the verifier built under the caller's injected policy.
func verifySelectedSDK(ctx context.Context, verify devsdk.Verifier, goPath, source string, environment []string) (devsdk.Identity, error) {
	var result devsdk.Identity
	tool, err := resolveTool(goPath, "go")
	if err != nil {
		return result, err
	}
	cmd := exec.CommandContext(ctx, tool, "list", "-m", "-json", devsdk.Module)
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
	if module.Path != devsdk.Module {
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
	if err = verifyManagedSDKSelection(directory, values); err != nil {
		return result, err
	}
	selection, err := devsdk.SourceSelection(directory)
	if err != nil {
		return result, err
	}
	return verify(ctx, selection)
}

func verifyManagedSDKSelection(directory string, values map[string]string) error {
	manifest, root := values[devcontract.WorkspaceEnvironment], values["OMNIVIEW_STATE_DIR"]
	workspaceID := values["OMNIVIEW_WORKSPACE_ID"]
	if manifest == "" && workspaceID == "" {
		return nil
	}
	if manifest == "" || root == "" || workspaceID == "" {
		return errors.New("managed SDK verification requires an explicit validated workspace profile")
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{
		CWD: "", Explicit: "", EnvironmentManifest: manifest, StateRoot: root, Home: "",
	})
	if err != nil {
		return err
	}
	if workspace.Manifest.WorkspaceID != workspaceID {
		return errors.New("SDK verification workspace identity mismatch")
	}
	selection, err := devsdk.SelectionOf(workspace)
	if err != nil {
		return err
	}
	selected, ok := selection.Directory()
	if !ok {
		return errors.New("managed workspace must explicitly select an SDK source repository")
	}
	selected, err = devcontract.CanonicalPath(selected)
	if err != nil {
		return err
	}
	if directory != selected {
		return errors.New("effective SDK source differs from selected workspace source")
	}
	return nil
}
