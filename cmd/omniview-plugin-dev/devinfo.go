package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// stateDirOverride can be injected at build time via:
//
//	-X main.stateDirOverride=<value>
var stateDirOverride string //nolint:gochecknoglobals // injected via ldflags

// DevInfoCLI represents the .devinfo file structure.
type DevInfoCLI struct {
	PID             int       `json:"pid"`
	Protocol        string    `json:"protocol"`
	ProtocolVersion int       `json:"protocolVersion"`
	Addr            string    `json:"addr"`
	VitePort        int       `json:"vitePort,omitempty"`
	PluginID        string    `json:"pluginId"`
	Version         string    `json:"version"`
	StartedAt       time.Time `json:"startedAt"`
}

// resolveStateDir determines the application state directory.
// Priority: OMNIVIEW_STATE_DIR env var > stateDirOverride (ldflags) > ~/.omniview.
// Both the env var and the ldflags override support tilde (~/) expansion.
// This mirrors appstate.ResolveRoot() from the main module.
func resolveStateDir() (string, error) {
	if dir := os.Getenv("OMNIVIEW_STATE_DIR"); dir != "" {
		expanded, err := expandTilde(dir)
		if err != nil {
			return "", fmt.Errorf("OMNIVIEW_STATE_DIR: %w", err)
		}
		if !filepath.IsAbs(expanded) {
			return "", fmt.Errorf("OMNIVIEW_STATE_DIR must be absolute, got %q", dir)
		}
		return filepath.Clean(expanded), nil
	}
	if stateDirOverride != "" {
		override, err := expandTilde(stateDirOverride)
		if err != nil {
			return "", fmt.Errorf("stateDirOverride: %w", err)
		}
		if !filepath.IsAbs(override) {
			return "", fmt.Errorf("stateDirOverride must be absolute, got %q", stateDirOverride)
		}
		return filepath.Clean(override), nil
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, ".omniview"), nil
}

// expandTilde replaces a leading ~/ (or bare ~) with the user's home directory.
// Returns the path unchanged if no tilde prefix is present.
// Returns an error if the home directory cannot be resolved.
func expandTilde(path string) (string, error) {
	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("expand ~: %w", err)
		}
		return home, nil
	}
	if len(path) > 1 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("expand ~: %w", err)
		}
		return filepath.Join(home, path[2:]), nil
	}
	return path, nil
}

// WriteDevInfoCLI writes a .devinfo file for the running plugin.
func WriteDevInfoCLI(pluginID, version string, proc *PluginProcess, vitePort int) error {
	stateDir, err := resolveStateDir()
	if err != nil {
		return err
	}

	dir := filepath.Join(stateDir, "plugins", pluginID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	info := DevInfoCLI{
		PID:             proc.PID,
		Protocol:        "grpc",
		ProtocolVersion: 1,
		Addr:            proc.Addr,
		VitePort:        vitePort,
		PluginID:        pluginID,
		Version:         version,
		StartedAt:       time.Now().UTC(),
	}

	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}

	// Atomic write via temp file + rename.
	path := filepath.Join(dir, ".devinfo")
	tmpPath := path + ".tmp"

	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write .devinfo temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename .devinfo: %w", err)
	}

	return nil
}

// CleanupDevInfoCLI removes the .devinfo file.
func CleanupDevInfoCLI(pluginID string, log *Logger) {
	stateDir, err := resolveStateDir()
	if err != nil {
		return
	}

	path := filepath.Join(stateDir, "plugins", pluginID, ".devinfo")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Error("Failed to clean up .devinfo: %v", err)
	}

	os.Remove(path + ".tmp")
}
