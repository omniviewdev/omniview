package plugin

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// ValidateForPhase checks that a plugin meets the requirements for the given phase.
func ValidateForPhase(phase lifecycle.PluginPhase, meta config.PluginMeta, location string) error {
	switch phase {
	case lifecycle.PhaseValidating, lifecycle.PhaseStarting:
		return validateForStart(meta, location)
	default:
		return nil
	}
}

// validateForStart checks that a plugin is ready to start.
func validateForStart(meta config.PluginMeta, location string) error {
	if meta.HasBackendCapabilities() {
		if err := validateHasBinary(location); err != nil {
			return err
		}
	}
	if meta.HasUICapabilities() {
		if err := validateHasUiPackage(location); err != nil {
			return err
		}
	}
	return nil
}

// validateHasBinary checks that the plugin binary exists and is executable.
func validateHasBinary(path string) error {
	plugin, err := os.Stat(filepath.Join(path, "bin", "plugin"))
	if os.IsNotExist(err) {
		return fmt.Errorf("resource plugin binary not found: %s", path)
	}
	if err != nil {
		return fmt.Errorf("error checking plugin binary: %w", err)
	}
	if plugin.Mode()&0111 == 0 {
		return fmt.Errorf("resource plugin binary is not executable: %s", path)
	}
	return nil
}

// validateHasUiPackage checks if the plugin has compiled UI assets.
func validateHasUiPackage(path string) error {
	_, err := os.Stat(filepath.Join(path, "assets"))
	if os.IsNotExist(err) {
		return fmt.Errorf("expected compiled ui at path but none found: %s", path)
	}
	return nil
}
