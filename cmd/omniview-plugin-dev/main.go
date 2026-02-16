package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

var (
	Version = "dev"
)

func main() {
	dir := flag.String("dir", ".", "Path to the plugin directory")
	vitePort := flag.Int("vite-port", 15173, "Preferred Vite dev server port")
	noVite := flag.Bool("no-vite", false, "Skip starting Vite dev server (Go-only plugin)")
	verbose := flag.Bool("verbose", false, "Enable verbose logging")
	version := flag.Bool("version", false, "Print version and exit")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "omniview-plugin-dev %s\n\n", Version)
		fmt.Fprintf(os.Stderr, "Usage: omniview-plugin-dev [flags]\n\n")
		fmt.Fprintf(os.Stderr, "Manages the complete plugin development lifecycle:\n")
		fmt.Fprintf(os.Stderr, "  - Validates plugin structure\n")
		fmt.Fprintf(os.Stderr, "  - Starts Vite dev server for UI HMR\n")
		fmt.Fprintf(os.Stderr, "  - Builds and runs Go plugin binary\n")
		fmt.Fprintf(os.Stderr, "  - Watches Go files and auto-rebuilds\n")
		fmt.Fprintf(os.Stderr, "  - Writes .devinfo for IDE auto-connect\n\n")
		fmt.Fprintf(os.Stderr, "Flags:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if *version {
		fmt.Printf("omniview-plugin-dev %s\n", Version)
		os.Exit(0)
	}

	// Resolve plugin directory to absolute path.
	absDir, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving path: %v\n", err)
		os.Exit(1)
	}

	log := NewLogger(*verbose)

	log.System("omniview-plugin-dev %s", Version)
	log.System("Plugin directory: %s", absDir)

	// Step 1: Validate.
	log.System("Validating plugin structure...")
	pluginMeta, err := ValidatePlugin(absDir)
	if err != nil {
		log.Error("Validation failed: %v", err)
		os.Exit(1)
	}
	log.System("Plugin: %s v%s (%s)", pluginMeta.Name, pluginMeta.Version, pluginMeta.ID)

	// Setup context with cancellation.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Signal handling.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Step 2: Start Vite (if plugin has UI).
	var viteProc *ViteProcess
	actualVitePort := 0

	if !*noVite && pluginMeta.HasUI {
		log.System("Starting Vite dev server...")
		viteProc, err = StartVite(ctx, absDir, *vitePort, log)
		if err != nil {
			log.Error("Failed to start Vite: %v", err)
			os.Exit(1)
		}
		actualVitePort = viteProc.Port
		log.System("Vite running on http://127.0.0.1:%d", actualVitePort)
	}

	// Step 3: Build Go binary.
	log.System("Building plugin binary...")
	builder := NewBuilder(absDir, pluginMeta, log)
	if err := builder.Build(); err != nil {
		log.Error("Initial build failed: %v", err)
		cleanup(viteProc, nil, pluginMeta.ID, log)
		os.Exit(1)
	}
	log.System("Build succeeded")

	// Step 4: Start plugin process.
	log.System("Starting plugin process...")
	pluginProc, err := StartPlugin(ctx, absDir, pluginMeta, actualVitePort, log)
	if err != nil {
		log.Error("Failed to start plugin: %v", err)
		cleanup(viteProc, nil, pluginMeta.ID, log)
		os.Exit(1)
	}
	log.System("Plugin running (PID %d, addr %s)", pluginProc.PID, pluginProc.Addr)

	// Step 5: Write .devinfo.
	if err := WriteDevInfoCLI(pluginMeta.ID, pluginMeta.Version, pluginProc, actualVitePort); err != nil {
		log.Error("Failed to write .devinfo: %v", err)
	} else {
		log.System("Wrote .devinfo (IDE will auto-connect)")
	}

	// Step 6: Start Go file watcher.
	log.System("Starting file watcher on pkg/...")
	watcher, err := NewWatcher(ctx, absDir, log, func() {
		log.System("Go files changed, rebuilding...")

		// Stop current plugin.
		pluginProc.Stop()

		// Rebuild.
		if err := builder.Build(); err != nil {
			log.Error("Build failed: %v", err)
			log.System("Waiting for next change...")
			return
		}
		log.System("Build succeeded, restarting plugin...")

		// Restart.
		newProc, err := StartPlugin(ctx, absDir, pluginMeta, actualVitePort, log)
		if err != nil {
			log.Error("Failed to restart plugin: %v", err)
			log.System("Waiting for next change...")
			return
		}

		pluginProc = newProc
		log.System("Plugin restarted (PID %d, addr %s)", pluginProc.PID, pluginProc.Addr)

		// Update .devinfo.
		if err := WriteDevInfoCLI(pluginMeta.ID, pluginMeta.Version, pluginProc, actualVitePort); err != nil {
			log.Error("Failed to update .devinfo: %v", err)
		}
	})
	if err != nil {
		log.Error("Failed to start watcher: %v", err)
		cleanup(viteProc, pluginProc, pluginMeta.ID, log)
		os.Exit(1)
	}
	_ = watcher

	log.System("Ready! Watching for changes...")
	log.System("Press Ctrl+C to stop")

	// Wait for signal.
	<-sigCh
	log.System("Shutting down...")
	cancel()
	cleanup(viteProc, pluginProc, pluginMeta.ID, log)
	log.System("Goodbye!")
}

func cleanup(vite *ViteProcess, plugin *PluginProcess, pluginID string, log *Logger) {
	if plugin != nil {
		plugin.Stop()
	}
	if vite != nil {
		vite.Stop()
	}
	CleanupDevInfoCLI(pluginID, log)
}
