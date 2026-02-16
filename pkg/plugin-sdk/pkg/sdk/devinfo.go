package sdk

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// DevInfo represents the contents of a .devinfo file that advertises
// a running plugin process to the IDE.
type DevInfo struct {
	PID             int       `json:"pid"`
	Protocol        string    `json:"protocol"`
	ProtocolVersion int       `json:"protocolVersion"`
	Addr            string    `json:"addr"`
	VitePort        int       `json:"vitePort,omitempty"`
	PluginID        string    `json:"pluginId"`
	Version         string    `json:"version"`
	StartedAt       time.Time `json:"startedAt"`
}

// devInfoPath returns the path to the .devinfo file for the given plugin ID.
func devInfoPath(pluginID string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".omniview", "plugins", pluginID, ".devinfo"), nil
}

// WriteDevInfo writes a .devinfo file for the running plugin process.
// It parses the go-plugin handshake line from stdout to extract the
// network address, then writes the file atomically.
//
// The handshake line format is:
//
//	CORE-PROTOCOL-VERSION|APP-PROTOCOL-VERSION|NETWORK-TYPE|NETWORK-ADDR|PROTOCOL
//
// Example: 1|1|tcp|127.0.0.1:42367|grpc
func WriteDevInfo(pluginID, version, handshakeLine string, vitePort int) error {
	parts := strings.Split(strings.TrimSpace(handshakeLine), "|")
	if len(parts) != 5 {
		return fmt.Errorf("invalid handshake line (expected 5 parts, got %d): %q", len(parts), handshakeLine)
	}

	protocolVersion, err := strconv.Atoi(parts[1])
	if err != nil {
		return fmt.Errorf("invalid protocol version in handshake: %w", err)
	}

	addr := parts[3]     // e.g., "127.0.0.1:42367"
	protocol := parts[4] // e.g., "grpc"

	info := DevInfo{
		PID:             os.Getpid(),
		Protocol:        protocol,
		ProtocolVersion: protocolVersion,
		Addr:            addr,
		VitePort:        vitePort,
		PluginID:        pluginID,
		Version:         version,
		StartedAt:       time.Now().UTC(),
	}

	return writeDevInfoFile(pluginID, &info)
}

// WriteDevInfoFromAddr writes a .devinfo file using a pre-known address
// (for cases where the handshake line is not directly available).
func WriteDevInfoFromAddr(pluginID, version string, addr net.Addr, vitePort int) error {
	info := DevInfo{
		PID:             os.Getpid(),
		Protocol:        "grpc",
		ProtocolVersion: 1,
		Addr:            addr.String(),
		VitePort:        vitePort,
		PluginID:        pluginID,
		Version:         version,
		StartedAt:       time.Now().UTC(),
	}

	return writeDevInfoFile(pluginID, &info)
}

// writeDevInfoFile performs the atomic write of the .devinfo file.
func writeDevInfoFile(pluginID string, info *DevInfo) error {
	path, err := devInfoPath(pluginID)
	if err != nil {
		return err
	}

	// Ensure the directory exists.
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin directory: %w", err)
	}

	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal devinfo: %w", err)
	}

	// Atomic write: write to .tmp, then rename.
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write devinfo temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath) // Clean up on failure.
		return fmt.Errorf("failed to rename devinfo file: %w", err)
	}

	return nil
}

// CleanupDevInfo removes the .devinfo file for the given plugin ID.
// This should be called when the plugin process is shutting down.
func CleanupDevInfo(pluginID string) error {
	path, err := devInfoPath(pluginID)
	if err != nil {
		return err
	}

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove devinfo file: %w", err)
	}

	// Also clean up any leftover temp file.
	os.Remove(path + ".tmp")
	return nil
}

// ReadDevInfo reads and parses a .devinfo file.
func ReadDevInfo(pluginID string) (*DevInfo, error) {
	path, err := devInfoPath(pluginID)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read devinfo file: %w", err)
	}

	var info DevInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, fmt.Errorf("failed to parse devinfo file: %w", err)
	}

	return &info, nil
}
