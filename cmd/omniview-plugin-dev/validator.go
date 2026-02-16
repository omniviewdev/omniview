package main

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// PluginMetaCLI is a minimal version of the plugin metadata for the CLI tool.
type PluginMetaCLI struct {
	ID           string   `yaml:"id"`
	Name         string   `yaml:"name"`
	Version      string   `yaml:"version"`
	Capabilities []string `yaml:"capabilities"`
	HasBackend   bool     `yaml:"-"`
	HasUI        bool     `yaml:"-"`
}

// ValidatePlugin checks the plugin directory structure and returns metadata.
func ValidatePlugin(dir string) (*PluginMetaCLI, error) {
	metaPath := filepath.Join(dir, "plugin.yaml")
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, fmt.Errorf("plugin.yaml not found: %w", err)
	}

	var meta PluginMetaCLI
	if err := yaml.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("invalid plugin.yaml: %w", err)
	}

	if meta.ID == "" {
		return nil, fmt.Errorf("plugin.yaml: 'id' field is required")
	}
	if meta.Version == "" {
		return nil, fmt.Errorf("plugin.yaml: 'version' field is required")
	}
	if meta.Name == "" {
		meta.Name = meta.ID
	}

	backendCaps := []string{"resource", "exec", "networker", "settings", "log"}
	for _, cap := range meta.Capabilities {
		for _, bc := range backendCaps {
			if cap == bc {
				meta.HasBackend = true
				break
			}
		}
		if cap == "ui" {
			meta.HasUI = true
		}
	}

	if meta.HasBackend {
		mainGo := filepath.Join(dir, "pkg", "main.go")
		if _, err := os.Stat(mainGo); os.IsNotExist(err) {
			return nil, fmt.Errorf("backend plugin requires pkg/main.go, not found")
		}
	}

	if meta.HasUI {
		viteConfig := filepath.Join(dir, "ui", "vite.config.ts")
		if _, err := os.Stat(viteConfig); os.IsNotExist(err) {
			return nil, fmt.Errorf("UI plugin requires ui/vite.config.ts, not found")
		}

		packageJson := filepath.Join(dir, "ui", "package.json")
		if _, err := os.Stat(packageJson); os.IsNotExist(err) {
			return nil, fmt.Errorf("UI plugin requires ui/package.json, not found")
		}
	}

	if !meta.HasBackend && !meta.HasUI {
		return nil, fmt.Errorf("plugin has no capabilities (need at least 'ui' or a backend capability)")
	}

	return &meta, nil
}
