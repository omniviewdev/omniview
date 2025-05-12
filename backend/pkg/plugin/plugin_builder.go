package plugin

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

type PluginBuilder struct{}

// FindGoBinary looks for the Go binary in a number of well-known paths in case it's not available
// in the PATH.
func FindGoBinary() (string, error) {
	// 1. Try using PATH
	if goPath, err := exec.LookPath("go"); err == nil {
		return goPath, nil
	}

	// 2. Search in common install directories by platform
	candidates := []string{}

	switch runtime.GOOS {
	case "linux":
		candidates = []string{
			"/usr/local/go/bin/go",
			"/usr/bin/go",
			"/snap/bin/go",
			filepath.Join(os.Getenv("HOME"), "go/bin/go"),
		}
	case "darwin":
		candidates = []string{
			"/usr/local/go/bin/go",
			"/opt/homebrew/bin/go", // Apple Silicon Homebrew
			"/usr/local/bin/go",    // Intel Homebrew
			filepath.Join(os.Getenv("HOME"), "go/bin/go"),
		}
	case "windows":
		programFiles := os.Getenv("ProgramFiles")
		programFilesX86 := os.Getenv("ProgramFiles(x86)")
		localAppData := os.Getenv("LocalAppData")
		candidates = []string{
			filepath.Join(programFiles, "Go", "bin", "go.exe"),
			filepath.Join(programFilesX86, "Go", "bin", "go.exe"),
			filepath.Join(localAppData, "Go", "bin", "go.exe"),
		}
	}

	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("go binary not found in PATH or common locations")
}

// FindPnpmBinary looks for the Pnpm binary in a number of well-known paths in case it's not available
// in the PATH.
func FindPnpmBinary() (string, error) {
	// 1. Try using PATH
	if pnpmPath, err := exec.LookPath("pnpm"); err == nil {
		return pnpmPath, nil
	}

	// 2. Look in common directories by platform
	candidates := []string{}

	switch runtime.GOOS {
	case "linux", "darwin":
		home := os.Getenv("HOME")
		candidates = []string{
			filepath.Join(home, ".local/share/pnpm/pnpm"),
			filepath.Join(home, ".nvm/versions/node", "*/bin/pnpm"),      // nvm
			filepath.Join(home, ".volta/tools/image/node", "*/bin/pnpm"), // volta
			filepath.Join(home, "Library/pnpm/pnpm"),                     // Mac
			"/usr/local/bin/pnpm",
			"/opt/homebrew/bin/pnpm", // M1 Mac
			"/usr/bin/pnpm",
		}
	case "windows":
		localAppData := os.Getenv("LocalAppData")
		appData := os.Getenv("AppData")
		candidates = []string{
			filepath.Join(appData, "npm", "pnpm.cmd"),
			filepath.Join(appData, "npm", "pnpm.exe"),
			filepath.Join(localAppData, "pnpm", "pnpm.exe"),
			filepath.Join(os.Getenv("UserProfile"), "AppData\\Roaming\\npm\\pnpm.cmd"),
		}
	}

	for _, path := range candidates {
		matches, err := filepath.Glob(path)
		if err == nil {
			for _, match := range matches {
				if _, statErr := os.Stat(match); statErr == nil {
					return match, nil
				}
			}
		} else if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("pnpm binary not found in PATH or common locations")
}

// FindNodeBinary tries to locate the Node.js binary across common install paths.
func FindNodeBinary() (string, error) {
	// Try system PATH first
	if nodePath, err := exec.LookPath("node"); err == nil {
		return nodePath, nil
	}

	var candidates []string
	home := os.Getenv("HOME")

	switch runtime.GOOS {
	case "linux", "darwin":
		candidates = []string{
			filepath.Join(home, ".nvm/versions/node", "*/bin/node"),
			filepath.Join(home, ".volta/bin/node"),
			"/usr/local/bin/node",
			"/opt/homebrew/bin/node", // Apple Silicon
			"/usr/bin/node",
		}
	case "windows":
		candidates = []string{
			filepath.Join(os.Getenv("ProgramFiles"), "nodejs", "node.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "nodejs", "node.exe"),
			filepath.Join(os.Getenv("AppData"), "npm", "node.exe"),
		}
	}

	for _, path := range candidates {
		// Support wildcards in nvm/volta paths
		matches, _ := filepath.Glob(path)
		for _, match := range matches {
			if stat, err := os.Stat(match); err == nil && !stat.IsDir() {
				return match, nil
			}
		}
	}

	return "", fmt.Errorf("node.js binary not found in PATH or common locations")
}

// PrepareCommandWithBinaries returns an exec.Cmd with extended PATH to include the directories of provided binary paths.
func PrepareCommandWithBinaries(
	command string,
	args []string,
	binaries ...string,
) (*exec.Cmd, error) {
	cmd := exec.Command(command, args...)

	env := os.Environ()
	var extraDirs []string

	for _, bin := range binaries {
		dir := filepath.Dir(bin)
		extraDirs = append(extraDirs, dir)
	}

	// Get current PATH
	var pathEnv string
	for _, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			pathEnv = strings.TrimPrefix(e, "PATH=")
			break
		}
	}

	combinedPath := strings.Join(append(extraDirs, pathEnv), string(os.PathListSeparator))
	// Replace or append updated PATH
	hasPath := false
	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			env[i] = "PATH=" + combinedPath
			hasPath = true
			break
		}
	}
	if !hasPath {
		env = append(env, "PATH="+combinedPath)
	}

	cmd.Env = env
	return cmd, nil
}

// HydrateBuildOpts adds the additional build options if they are not specified
func HydrateBuildOpts(opts *types.BuildOpts) error {
	if opts == nil {
		opts = &types.BuildOpts{}
	}

	if opts.GoPath == "" {
		goPath, err := FindGoBinary()
		if err != nil {
			return err
		}
		opts.GoPath = goPath
	}

	if opts.NodePath == "" {
		nodePath, err := FindNodeBinary()
		if err != nil {
			return err
		}
		opts.NodePath = nodePath
	}

	if opts.PnpmPath == "" {
		pnpmPath, err := FindPnpmBinary()
		if err != nil {
			return err
		}
		opts.PnpmPath = pnpmPath
	}

	return nil
}
