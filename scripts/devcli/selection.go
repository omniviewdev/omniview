package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

const hostModulePath = "github.com/omniviewdev/omniview"
const sdkModulePath = "github.com/omniviewdev/plugin-sdk"

type inputOptions struct {
	root      string
	modfile   string
	sdkSource string
}
type selectedInputs struct {
	root                       string
	sourceModfile              string
	sdkSource                  string
	module, sum                []byte
	sumExists                  bool
	rootModule, rootSum        []byte
	rootSumExists              bool
	sdkModule, sdkSum          []byte
	sdkSumExists               bool
	workspaceRoot, profileRoot string
	repositories               []string
}

type moduleVersion struct{ Path, Version string }
type moduleReplacement struct{ Old, New moduleVersion }
type moduleDescription struct {
	Module  *moduleVersion
	Require []moduleVersion
	Replace []*moduleReplacement
}

func canonicalDirectory(path string) (string, error) {
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(canonical)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("source must be an existing real directory: %s", path)
	}
	return canonical, nil
}

func readSource(path string, optional bool) ([]byte, bool, error) {
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return nil, false, err
	}
	before, err := os.Lstat(canonical)
	if os.IsNotExist(err) && optional {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if !before.Mode().IsRegular() {
		return nil, false, fmt.Errorf("module input is not a regular file: %s", path)
	}
	file, err := os.Open(canonical)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, false, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, false, fmt.Errorf("module input changed while opening: %s", path)
	}
	raw, err := io.ReadAll(file)
	return raw, true, err
}

// Use the installed Go parser in read-only mode: bootstrapping this native-free
// helper must not add a parser dependency or rewrite the source go.mod/go.sum.
func parseModule(path string, raw []byte, expected string) (*moduleDescription, error) {
	command := exec.Command("go", "mod", "edit", "-json", path)
	command.Dir = filepath.Dir(path)
	command.Env = goEnvironment(os.Getenv("GOCACHE"), os.Getenv("GOTMPDIR"))
	var diagnostics bytes.Buffer
	command.Stderr = &diagnostics
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("parse module %s: %w: %s", path, err, strings.TrimSpace(diagnostics.String()))
	}
	after, _, err := readSource(path, false)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(after, raw) {
		return nil, fmt.Errorf("module input changed while parsing: %s", path)
	}
	var parsed moduleDescription
	if err := json.Unmarshal(output, &parsed); err != nil {
		return nil, err
	}
	if parsed.Module == nil || parsed.Module.Path != expected {
		return nil, fmt.Errorf("%s must declare module %s", path, expected)
	}
	return &parsed, nil
}

// optionalWorkspace ignores only a genuinely absent context. Invalid, dangling,
// ambiguous or explicit targets retain the authoritative resolver's refusal.
func optionalWorkspace(root string) (*devcontract.ResolvedWorkspace, error) {
	environment := os.Getenv(devcontract.WorkspaceEnvironment)
	state := os.Getenv("OMNIVIEW_STATE_DIR")
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{CWD: root, EnvironmentManifest: environment, StateRoot: state})
	if err == nil {
		return &resolved, nil
	}
	var failure *devcontract.Error
	if environment != "" || state != "" || !errors.As(err, &failure) || failure.Code != "missing_workspace" {
		return nil, err
	}
	for directory := root; ; directory = filepath.Dir(directory) {
		if _, inspectErr := os.Lstat(filepath.Join(directory, "workspace.json")); inspectErr == nil {
			return nil, err
		} else if !os.IsNotExist(inspectErr) {
			return nil, inspectErr
		}
		if filepath.Dir(directory) == directory {
			break
		}
	}
	return nil, nil
}

func effectiveSDK(parsed *moduleDescription, root string) (string, bool, error) {
	version := ""
	for _, requirement := range parsed.Require {
		if requirement.Path == sdkModulePath {
			version = requirement.Version
			break
		}
	}
	var general, specific *moduleReplacement
	for _, replacement := range parsed.Replace {
		if replacement.Old.Path != sdkModulePath {
			continue
		}
		if replacement.Old.Version == "" {
			if general != nil {
				return "", false, fmt.Errorf("multiple unversioned SDK replacements")
			}
			general = replacement
		} else if replacement.Old.Version == version {
			if specific != nil {
				return "", false, fmt.Errorf("multiple effective versioned SDK replacements")
			}
			specific = replacement
		}
	}
	replacement := specific
	if replacement == nil {
		replacement = general
	}
	if replacement == nil {
		return "", false, nil
	}
	if replacement.New.Version != "" {
		return "", true, nil
	}
	directory := replacement.New.Path
	if !filepath.IsAbs(directory) {
		directory = filepath.Join(root, directory)
	}
	canonical, err := canonicalDirectory(directory)
	return canonical, false, err
}

func selectInputs(options inputOptions) (selectedInputs, error) {
	var selected selectedInputs
	root, err := canonicalDirectory(options.root)
	if err != nil {
		return selected, err
	}
	selected.root = root
	sourceModule, _, err := readSource(filepath.Join(root, "go.mod"), false)
	if err != nil {
		return selected, err
	}
	if _, err = parseModule(filepath.Join(root, "go.mod"), sourceModule, hostModulePath); err != nil {
		return selected, err
	}
	selected.rootModule = sourceModule
	selected.rootSum, selected.rootSumExists, err = readSource(filepath.Join(root, "go.sum"), true)
	if err != nil {
		return selected, err
	}
	input := options.modfile
	if input == "" {
		input = filepath.Join(root, "go.mod")
	} else if !filepath.IsAbs(input) {
		input = filepath.Join(root, input)
	}
	input, err = devcontract.CanonicalPath(input)
	if err != nil {
		return selected, err
	}
	if !strings.HasSuffix(input, ".mod") {
		return selected, fmt.Errorf("effective host module input must end in .mod")
	}
	selected.sourceModfile = input
	selected.module, _, err = readSource(input, false)
	if err != nil {
		return selected, err
	}
	parsed, err := parseModule(input, selected.module, hostModulePath)
	if err != nil {
		return selected, err
	}
	selected.sum, selected.sumExists, err = readSource(strings.TrimSuffix(input, ".mod")+".sum", true)
	if err != nil {
		return selected, err
	}

	var enclosingSDK string
	workspace, err := optionalWorkspace(root)
	if err != nil {
		return selected, err
	}
	if workspace != nil {
		selected.workspaceRoot = workspace.Root
		selected.profileRoot = filepath.Dir(workspace.StateRoot)
		for _, repository := range workspace.Manifest.Repositories {
			directory, pathErr := devcontract.CanonicalPath(filepath.Join(workspace.Root, repository.Directory))
			if pathErr != nil {
				return selected, pathErr
			}
			selected.repositories = append(selected.repositories, directory)
		}
		if workspace.Manifest.Links.SDKRepositoryID != nil {
			directory, pathErr := workspace.RepositoryPath(*workspace.Manifest.Links.SDKRepositoryID)
			if pathErr != nil {
				return selected, pathErr
			}
			enclosingSDK, err = canonicalDirectory(directory)
			if err != nil {
				return selected, err
			}
		}
	}
	explicitSDK := options.sdkSource
	if explicitSDK != "" {
		if !filepath.IsAbs(explicitSDK) {
			return selected, fmt.Errorf("explicit SDK source must be absolute")
		}
		explicitSDK, err = canonicalDirectory(explicitSDK)
		if err != nil {
			return selected, err
		}
	}
	moduleSDK, remoteReplacement, err := effectiveSDK(parsed, root)
	if err != nil {
		return selected, err
	}
	for _, candidate := range []string{explicitSDK, enclosingSDK, moduleSDK} {
		if candidate == "" {
			continue
		}
		if selected.sdkSource != "" && selected.sdkSource != candidate {
			return selected, fmt.Errorf("explicit, enclosing and effective-module SDK selections disagree: %s != %s", selected.sdkSource, candidate)
		}
		selected.sdkSource = candidate
	}
	if remoteReplacement && selected.sdkSource != "" {
		return selected, fmt.Errorf("remote SDK replacement conflicts with selected local SDK source")
	}
	if selected.sdkSource != "" {
		selected.sdkModule, _, err = readSource(filepath.Join(selected.sdkSource, "go.mod"), false)
		if err != nil {
			return selected, err
		}
		if _, err = parseModule(filepath.Join(selected.sdkSource, "go.mod"), selected.sdkModule, sdkModulePath); err != nil {
			return selected, err
		}
		selected.sdkSum, selected.sdkSumExists, err = readSource(filepath.Join(selected.sdkSource, "go.sum"), true)
		if err != nil {
			return selected, err
		}
	}
	return selected, nil
}

func containsPath(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}
func overlaps(a, b string) bool { return containsPath(a, b) || containsPath(b, a) }

func validateCacheLocation(path string, selected selectedInputs, toolArtifact bool) (string, error) {
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	roots := append([]string{selected.root, selected.sdkSource}, selected.repositories...)
	if toolArtifact {
		roots = append(roots, selected.workspaceRoot, selected.profileRoot)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	roots = append(roots, filepath.Join(home, ".omniview"), filepath.Join(home, ".omniview-nightly"))
	for _, root := range roots {
		if root == "" {
			continue
		}
		protected, err := devcontract.CanonicalPath(root)
		if err != nil {
			return "", err
		}
		if overlaps(canonical, protected) {
			return "", fmt.Errorf("CLI cache overlaps source or protected profile: %s", canonical)
		}
	}
	return canonical, nil
}
