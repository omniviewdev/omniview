package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// Builder compiles the Go plugin binary.
type Builder struct {
	pluginDir string
	meta      *PluginMetaCLI
	log       *Logger
}

func NewBuilder(pluginDir string, meta *PluginMetaCLI, log *Logger) *Builder {
	return &Builder{
		pluginDir: pluginDir,
		meta:      meta,
		log:       log,
	}
}

// Build compiles the plugin binary. Returns nil on success.
func (b *Builder) Build() error {
	start := time.Now()

	outDir := filepath.Join(b.pluginDir, "build", "bin")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	outPath := filepath.Join(outDir, "plugin")

	goPath, err := exec.LookPath("go")
	if err != nil {
		return fmt.Errorf("'go' not found in PATH: %w", err)
	}

	var stdout, stderr bytes.Buffer
	cmd := exec.Command(goPath, "build", "-o", outPath, "./pkg")
	cmd.Dir = b.pluginDir
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if stderr.Len() > 0 {
			for _, line := range bytes.Split(stderr.Bytes(), []byte("\n")) {
				if len(line) > 0 {
					b.log.Go(string(line))
				}
			}
		}
		return fmt.Errorf("build failed: %w", err)
	}

	elapsed := time.Since(start)
	b.log.System("Built in %dms", elapsed.Milliseconds())

	return nil
}

// BinaryPath returns the path to the built plugin binary.
func (b *Builder) BinaryPath() string {
	return filepath.Join(b.pluginDir, "build", "bin", "plugin")
}

// TransferToInstall copies the built artifacts to ~/.omniview/plugins/<id>/.
func (b *Builder) TransferToInstall() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	installDir := filepath.Join(homeDir, ".omniview", "plugins", b.meta.ID)
	binDir := filepath.Join(installDir, "bin")

	if err := os.MkdirAll(binDir, 0755); err != nil {
		return err
	}

	src := b.BinaryPath()
	dst := filepath.Join(binDir, "plugin")

	srcData, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("failed to read built binary: %w", err)
	}

	if err := os.WriteFile(dst, srcData, 0755); err != nil {
		return fmt.Errorf("failed to write binary to install dir: %w", err)
	}

	metaSrc := filepath.Join(b.pluginDir, "plugin.yaml")
	metaDst := filepath.Join(installDir, "plugin.yaml")

	metaData, err := os.ReadFile(metaSrc)
	if err != nil {
		return fmt.Errorf("failed to read plugin.yaml: %w", err)
	}

	if err := os.WriteFile(metaDst, metaData, 0644); err != nil {
		return fmt.Errorf("failed to write plugin.yaml to install dir: %w", err)
	}

	return nil
}
