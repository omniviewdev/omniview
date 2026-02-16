package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

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

// WriteDevInfoCLI writes a .devinfo file for the running plugin.
func WriteDevInfoCLI(pluginID, version string, proc *PluginProcess, vitePort int) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	dir := filepath.Join(homeDir, ".omniview", "plugins", pluginID)
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
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}

	path := filepath.Join(homeDir, ".omniview", "plugins", pluginID, ".devinfo")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Error("Failed to clean up .devinfo: %v", err)
	}

	os.Remove(path + ".tmp")
}
