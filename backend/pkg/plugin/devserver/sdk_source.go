package devserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// goDiagnosticLimit bounds the Go command stderr carried in a runner error.
const goDiagnosticLimit = 4096

var credentialURL = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@\s]+@`)

// VerifySelectedSDK identifies the SDK module selected by Go, including
// replacements, and binds managed workspaces to their selected checkout. A
// published workspace selection verifies only under the zero policy's refusal:
// production builds inject devsdk.ReleasePolicy through BuildOpts.
func VerifySelectedSDK(ctx context.Context, goPath, source string, environment []string) (devsdk.Identity, error) {
	return verifySelectedSDK(ctx, devsdk.NewVerifier(devsdk.Policy{}), goPath, source, environment)
}

// verifySelectedSDK resolves the SDK a plugin repository builds against and
// identifies it with verify, the verifier built under the caller's injected
// policy. A managed workspace with a published selection builds against the
// SDK its own go.mod publishes; every other selection binds the effective
// replacement to the selected checkout.
func verifySelectedSDK(ctx context.Context, verify devsdk.Verifier, goPath, source string, environment []string) (devsdk.Identity, error) {
	var result devsdk.Identity
	tool, err := resolveTool(goPath, "go")
	if err != nil {
		return result, err
	}
	env := goBuildEnv(environment)
	values := map[string]string{}
	for _, entry := range env {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	selection, managed, err := workspaceSDKSelection(values)
	if err != nil {
		return result, err
	}
	if managed && selection.Mode() == devsdk.ModePublished {
		return verifyPublishedSDK(ctx, verify, tool, source, environment)
	}
	cmd := exec.CommandContext(ctx, tool, "list", "-m", "-json", devsdk.Module)
	cmd.Dir = source
	cmd.Env = env
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
	if managed {
		selected, _ := selection.Directory()
		selected, err = devcontract.CanonicalPath(selected)
		if err != nil {
			return result, err
		}
		if directory != selected {
			return result, errors.New("effective SDK source differs from selected workspace source")
		}
	}
	checkout, err := devsdk.SourceSelection(directory)
	if err != nil {
		return result, err
	}
	return verify(ctx, devsdk.Request{Selection: checkout})
}

// verifyPublishedSDK identifies the SDK published by the plugin repository's
// own go.mod and go.sum. The Go commands run under this package's runner.
func verifyPublishedSDK(ctx context.Context, verify devsdk.Verifier, goPath, source string, environment []string) (devsdk.Identity, error) {
	root, err := devcontract.CanonicalPath(source)
	if err != nil {
		return devsdk.Identity{}, err
	}
	return verify(ctx, devsdk.Request{
		Selection: devsdk.PublishedSelection(),
		Consumer:  devsdk.Consumer{Name: filepath.Base(root), Directory: root},
		Run:       goRunner(goPath, environment),
	})
}

// goRunner runs go under this package's ownership for the SDK verifier.
func goRunner(goPath string, environment []string) devsdk.Runner {
	return func(ctx context.Context, directory string, extra []string, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, goPath, args...)
		cmd.Dir = directory
		cmd.Env = append(goBuildEnv(environment), extra...)
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr
		if err := cmd.Run(); err != nil {
			diagnostic := stderr.Bytes()
			if len(diagnostic) > goDiagnosticLimit {
				diagnostic = diagnostic[len(diagnostic)-goDiagnosticLimit:]
			}
			text := credentialURL.ReplaceAllString(strings.TrimSpace(string(diagnostic)), "${1}***@")
			return nil, fmt.Errorf("go %s: %w: %s", strings.Join(args[:min(len(args), 2)], " "), err, text)
		}
		return stdout.Bytes(), nil
	}
}

// workspaceSDKSelection resolves the SDK selection of the managed workspace the
// environment names. An unmanaged environment reports managed == false.
func workspaceSDKSelection(values map[string]string) (devsdk.Selection, bool, error) {
	manifest, root := values[devcontract.WorkspaceEnvironment], values["OMNIVIEW_STATE_DIR"]
	workspaceID := values["OMNIVIEW_WORKSPACE_ID"]
	if manifest == "" && workspaceID == "" {
		return devsdk.Selection{}, false, nil
	}
	if manifest == "" || root == "" || workspaceID == "" {
		return devsdk.Selection{}, false, errors.New("managed SDK verification requires an explicit validated workspace profile")
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{
		CWD: "", Explicit: "", EnvironmentManifest: manifest, StateRoot: root, Home: "",
	})
	if err != nil {
		return devsdk.Selection{}, false, err
	}
	if workspace.Manifest.WorkspaceID != workspaceID {
		return devsdk.Selection{}, false, errors.New("SDK verification workspace identity mismatch")
	}
	selection, err := devsdk.SelectionOf(workspace)
	if err != nil {
		return devsdk.Selection{}, false, err
	}
	return selection, true, nil
}
