package devworkspace

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Launch the selected installed Vite bin directly through Node. Owning a pnpm
// wrapper PID would not identify the process actually binding the Vite socket.
func resolveViteCommand(host string) (string, string, error) {
	directory, err := devcontract.CanonicalPath(filepath.Join(host, "node_modules", "vite"))
	if err != nil {
		return "", "", err
	}
	raw, err := os.ReadFile(filepath.Join(directory, "package.json"))
	if err != nil {
		return "", "", err
	}
	var pkg struct {
		Name string          `json:"name"`
		Bin  json.RawMessage `json:"bin"`
	}
	if err = json.Unmarshal(raw, &pkg); err != nil {
		return "", "", err
	}
	if pkg.Name != "vite" {
		return "", "", fmt.Errorf("selected installed Vite package identity differs")
	}
	var bin string
	if json.Unmarshal(pkg.Bin, &bin) != nil {
		var bins map[string]string
		if err = json.Unmarshal(pkg.Bin, &bins); err != nil {
			return "", "", err
		}
		bin = bins["vite"]
	}
	if bin == "" || filepath.IsAbs(bin) {
		return "", "", fmt.Errorf("selected Vite package has no relative vite executable")
	}
	script, err := devcontract.CanonicalPath(filepath.Join(directory, bin))
	if err != nil {
		return "", "", err
	}
	relative, err := filepath.Rel(directory, script)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("Vite executable escapes its installed package")
	}
	info, err := os.Stat(script)
	if err != nil {
		return "", "", err
	}
	if !info.Mode().IsRegular() {
		return "", "", fmt.Errorf("selected Vite executable is not a regular file")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return "", "", err
	}
	node, err = devcontract.CanonicalPath(node)
	if err != nil {
		return "", "", err
	}
	return node, script, nil
}
