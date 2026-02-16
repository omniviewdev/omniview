# 09 -- CLI Wrapper Tool: `omniview-plugin-dev`

## Standalone Go Binary for Plugin Development

**Goal**: A single binary that handles the entire plugin development lifecycle -- validation, Vite dev server, Go file watching, building, plugin binary management, `.devinfo` writing -- so developers can run one command and have everything work.

```bash
omniview-plugin-dev --dir ./plugins/my-plugin
```

---

## 1. What It Does

The CLI tool manages the complete development loop:

1. **Validates** the plugin directory structure (`plugin.yaml`, `pkg/main.go`, `ui/vite.config.ts`)
2. **Starts Vite** dev server for the UI (captures the actual port from stdout)
3. **Builds** the Go plugin binary
4. **Starts** the plugin binary, captures the go-plugin handshake
5. **Writes `.devinfo`** so the IDE auto-connects
6. **Watches** Go files for changes (fsnotify)
7. **Rebuilds** on Go changes: stop plugin, rebuild, restart, update `.devinfo`
8. **Multiplexes** all output (Vite, Go compiler, plugin) with color-coded prefixes
9. **Cleans up** on exit: kills Vite, kills plugin, removes `.devinfo`

The IDE does NOT need to be running. The CLI tool is self-contained. When the IDE is running, it detects the `.devinfo` file and auto-connects.

---

## 2. Architecture

```
main.go
  │
  ├── Parse flags (--dir, --vite-port, --no-vite, --verbose)
  │
  ├── validator.go    → Validate plugin structure
  │
  ├── Start Vite subprocess (vite.go)
  │     └── Capture actual port from stdout
  │
  ├── Build Go binary (builder.go)
  │
  ├── Start plugin binary (plugin.go)
  │     ├── Capture handshake from stdout
  │     └── Write .devinfo (devinfo.go)
  │
  ├── Start Go file watcher (watcher.go)
  │     └── On change:
  │           ├── Stop plugin binary
  │           ├── Rebuild (builder.go)
  │           ├── Restart plugin binary
  │           └── Update .devinfo
  │
  └── Wait for SIGINT/SIGTERM
        ├── Kill Vite process
        ├── Kill plugin process
        └── Remove .devinfo
```

All subprocess output is routed through `logger.go` for color-coded multiplexed display.

---

## 3. Complete Go Code

### 3.1 `main.go`

```go
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

	// Resolve plugin directory to absolute path
	absDir, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving path: %v\n", err)
		os.Exit(1)
	}

	log := NewLogger(*verbose)

	log.System("omniview-plugin-dev %s", Version)
	log.System("Plugin directory: %s", absDir)

	// Step 1: Validate
	log.System("Validating plugin structure...")
	pluginMeta, err := ValidatePlugin(absDir)
	if err != nil {
		log.Error("Validation failed: %v", err)
		os.Exit(1)
	}
	log.System("Plugin: %s v%s (%s)", pluginMeta.Name, pluginMeta.Version, pluginMeta.ID)

	// Setup context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Signal handling
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Step 2: Start Vite (if plugin has UI)
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

	// Step 3: Build Go binary
	log.System("Building plugin binary...")
	builder := NewBuilder(absDir, pluginMeta, log)
	if err := builder.Build(); err != nil {
		log.Error("Initial build failed: %v", err)
		cleanup(viteProc, nil, pluginMeta.ID, log)
		os.Exit(1)
	}
	log.System("Build succeeded")

	// Step 4: Start plugin process
	log.System("Starting plugin process...")
	pluginProc, err := StartPlugin(ctx, absDir, pluginMeta, actualVitePort, log)
	if err != nil {
		log.Error("Failed to start plugin: %v", err)
		cleanup(viteProc, nil, pluginMeta.ID, log)
		os.Exit(1)
	}
	log.System("Plugin running (PID %d, addr %s)", pluginProc.PID, pluginProc.Addr)

	// Step 5: Write .devinfo
	if err := WriteDevInfoCLI(pluginMeta.ID, pluginMeta.Version, pluginProc, actualVitePort); err != nil {
		log.Error("Failed to write .devinfo: %v", err)
		// Non-fatal -- plugin still works, just no IDE auto-connect
	} else {
		log.System("Wrote .devinfo (IDE will auto-connect)")
	}

	// Step 6: Start Go file watcher
	log.System("Starting file watcher on pkg/...")
	watcher, err := NewWatcher(ctx, absDir, log, func() {
		log.System("Go files changed, rebuilding...")

		// Stop current plugin
		pluginProc.Stop()

		// Rebuild
		if err := builder.Build(); err != nil {
			log.Error("Build failed: %v", err)
			log.System("Waiting for next change...")
			return
		}
		log.System("Build succeeded, restarting plugin...")

		// Restart
		newProc, err := StartPlugin(ctx, absDir, pluginMeta, actualVitePort, log)
		if err != nil {
			log.Error("Failed to restart plugin: %v", err)
			log.System("Waiting for next change...")
			return
		}

		pluginProc = newProc
		log.System("Plugin restarted (PID %d, addr %s)", pluginProc.PID, pluginProc.Addr)

		// Update .devinfo
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

	// Wait for signal
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
```

### 3.2 `validator.go`

```go
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
	// Check plugin.yaml exists
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

	// Determine capabilities
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

	// Validate backend structure
	if meta.HasBackend {
		mainGo := filepath.Join(dir, "pkg", "main.go")
		if _, err := os.Stat(mainGo); os.IsNotExist(err) {
			return nil, fmt.Errorf("backend plugin requires pkg/main.go, not found")
		}
	}

	// Validate UI structure
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
```

### 3.3 `vite.go`

```go
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// ViteProcess manages a Vite dev server subprocess.
type ViteProcess struct {
	Port int
	cmd  *exec.Cmd
	mu   sync.Mutex
}

// StartVite starts a Vite dev server in the plugin's ui/ directory.
// It parses stdout to detect the actual port Vite is listening on.
func StartVite(ctx context.Context, pluginDir string, preferredPort int, log *Logger) (*ViteProcess, error) {
	uiDir := filepath.Join(pluginDir, "ui")

	// Find pnpm or npm
	pnpmPath, err := exec.LookPath("pnpm")
	if err != nil {
		// Fall back to npx
		pnpmPath, err = exec.LookPath("npx")
		if err != nil {
			return nil, fmt.Errorf("neither pnpm nor npx found in PATH")
		}
	}

	var args []string
	if strings.HasSuffix(pnpmPath, "pnpm") {
		args = []string{"exec", "vite", "--port", strconv.Itoa(preferredPort)}
	} else {
		args = []string{"vite", "--port", strconv.Itoa(preferredPort)}
	}

	cmd := exec.CommandContext(ctx, pnpmPath, args...)
	cmd.Dir = uiDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("PORT=%d", preferredPort),
	)

	// Capture stdout to detect the port
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start vite: %w", err)
	}

	vp := &ViteProcess{
		cmd: cmd,
	}

	// Parse stdout for the port
	portCh := make(chan int, 1)
	portRegex := regexp.MustCompile(`Local:\s+https?://[\w.]+:(\d+)`)

	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		portSent := false
		for scanner.Scan() {
			line := scanner.Text()
			log.Vite(line)

			if !portSent {
				if matches := portRegex.FindStringSubmatch(line); len(matches) > 1 {
					if port, err := strconv.Atoi(matches[1]); err == nil {
						portCh <- port
						portSent = true
					}
				}
			}
		}
		// If we never found the port, send 0
		if !portSent {
			portCh <- 0
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			log.Vite(scanner.Text())
		}
	}()

	// Wait for port detection (with timeout via context)
	select {
	case port := <-portCh:
		if port == 0 {
			cmd.Process.Kill()
			return nil, fmt.Errorf("failed to detect Vite port from output")
		}
		vp.Port = port
	case <-ctx.Done():
		cmd.Process.Kill()
		return nil, ctx.Err()
	}

	return vp, nil
}

// Stop kills the Vite process.
func (vp *ViteProcess) Stop() {
	vp.mu.Lock()
	defer vp.mu.Unlock()

	if vp.cmd != nil && vp.cmd.Process != nil {
		vp.cmd.Process.Signal(syscall.SIGTERM)
		// Give it a moment to shut down gracefully
		done := make(chan error, 1)
		go func() { done <- vp.cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			vp.cmd.Process.Kill()
		}
	}
}
```

Add the missing imports at the top of vite.go:

```go
import (
	"syscall"
	"time"
)
```

### 3.4 `watcher.go`

```go
package main

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const WatcherDebounce = 500 * time.Millisecond

// Watcher watches Go source files and triggers rebuilds.
type Watcher struct {
	watcher *fsnotify.Watcher
	cancel  context.CancelFunc
}

// NewWatcher creates a file watcher on the plugin's pkg/ directory.
// The onChange callback is called (debounced) when .go files change.
func NewWatcher(ctx context.Context, pluginDir string, log *Logger, onChange func()) (*Watcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	pkgDir := filepath.Join(pluginDir, "pkg")

	// Walk and add all subdirectories
	err = filepath.Walk(pkgDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip vendor, testdata, hidden dirs
			name := info.Name()
			if name == "vendor" || name == "testdata" || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return fsWatcher.Add(path)
		}
		return nil
	})
	if err != nil {
		fsWatcher.Close()
		return nil, err
	}

	watchCtx, watchCancel := context.WithCancel(ctx)

	w := &Watcher{
		watcher: fsWatcher,
		cancel:  watchCancel,
	}

	go w.run(watchCtx, log, onChange)

	return w, nil
}

func (w *Watcher) run(ctx context.Context, log *Logger, onChange func()) {
	var (
		mu     sync.Mutex
		timers = make(map[string]*time.Timer)
	)

	handleEvent := func(name string) {
		mu.Lock()
		delete(timers, name)
		mu.Unlock()

		onChange()
	}

	for {
		select {
		case <-ctx.Done():
			w.watcher.Close()
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}

			// Only care about Go files, create/write events
			if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) {
				continue
			}
			if filepath.Ext(event.Name) != ".go" {
				continue
			}

			mu.Lock()
			t, ok := timers[event.Name]
			mu.Unlock()

			if !ok {
				t = time.AfterFunc(math.MaxInt64, func() { handleEvent(event.Name) })
				t.Stop()
				mu.Lock()
				timers[event.Name] = t
				mu.Unlock()
			}

			t.Reset(WatcherDebounce)

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Error("Watcher error: %v", err)
		}
	}
}

func (w *Watcher) Stop() {
	w.cancel()
}
```

### 3.5 `builder.go`

```go
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
		// Log the error output
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
// This is optional -- the IDE can also use the build directory directly
// when in external mode.
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

	// Copy binary
	src := b.BinaryPath()
	dst := filepath.Join(binDir, "plugin")

	srcData, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("failed to read built binary: %w", err)
	}

	if err := os.WriteFile(dst, srcData, 0755); err != nil {
		return fmt.Errorf("failed to write binary to install dir: %w", err)
	}

	// Copy plugin.yaml
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
```

### 3.6 `plugin.go`

```go
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// PluginProcess manages a running plugin binary.
type PluginProcess struct {
	PID  int
	Addr string
	cmd  *exec.Cmd
	mu   sync.Mutex
}

// StartPlugin starts the plugin binary and captures the go-plugin handshake.
func StartPlugin(
	ctx context.Context,
	pluginDir string,
	meta *PluginMetaCLI,
	vitePort int,
	log *Logger,
) (*PluginProcess, error) {
	binaryPath := filepath.Join(pluginDir, "build", "bin", "plugin")

	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("plugin binary not found: %s", binaryPath)
	}

	cmd := exec.CommandContext(ctx, binaryPath)
	cmd.Dir = pluginDir
	cmd.Env = append(os.Environ(),
		"OMNIVIEW_DEV=1",
		fmt.Sprintf("OMNIVIEW_VITE_PORT=%d", vitePort),
	)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start plugin: %w", err)
	}

	pp := &PluginProcess{
		PID: cmd.Process.Pid,
		cmd: cmd,
	}

	// Read the handshake line from stdout
	// Format: CORE-PROTOCOL-VERSION|APP-PROTOCOL-VERSION|NETWORK-TYPE|NETWORK-ADDR|PROTOCOL
	handshakeCh := make(chan string, 1)

	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		handshakeSent := false
		for scanner.Scan() {
			line := scanner.Text()

			// The handshake line is the first line that matches the pattern
			if !handshakeSent && isHandshakeLine(line) {
				handshakeCh <- line
				handshakeSent = true
			} else {
				log.Plugin(line)
			}
		}
		if !handshakeSent {
			handshakeCh <- ""
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			log.Plugin(scanner.Text())
		}
	}()

	// Wait for handshake
	select {
	case handshake := <-handshakeCh:
		if handshake == "" {
			cmd.Process.Kill()
			return nil, fmt.Errorf("plugin exited without handshake")
		}
		parts := strings.Split(strings.TrimSpace(handshake), "|")
		if len(parts) >= 4 {
			pp.Addr = parts[3]
		}
		log.System("Handshake: %s", strings.TrimSpace(handshake))

	case <-time.After(30 * time.Second):
		cmd.Process.Kill()
		return nil, fmt.Errorf("timeout waiting for plugin handshake (30s)")

	case <-ctx.Done():
		cmd.Process.Kill()
		return nil, ctx.Err()
	}

	// Monitor the process in the background
	go func() {
		err := cmd.Wait()
		if err != nil && ctx.Err() == nil {
			log.Error("Plugin process exited: %v", err)
		}
	}()

	return pp, nil
}

// Stop terminates the plugin process gracefully.
func (pp *PluginProcess) Stop() {
	pp.mu.Lock()
	defer pp.mu.Unlock()

	if pp.cmd == nil || pp.cmd.Process == nil {
		return
	}

	// Send SIGTERM first
	pp.cmd.Process.Signal(syscall.SIGTERM)

	// Wait up to 5 seconds for graceful shutdown
	done := make(chan error, 1)
	go func() {
		done <- pp.cmd.Wait()
	}()

	select {
	case <-done:
		// Process exited gracefully
	case <-time.After(5 * time.Second):
		// Force kill
		pp.cmd.Process.Kill()
		<-done
	}

	pp.cmd = nil
}

// isHandshakeLine checks if a line matches the go-plugin handshake format.
func isHandshakeLine(line string) bool {
	parts := strings.Split(strings.TrimSpace(line), "|")
	if len(parts) != 5 {
		return false
	}
	// First part should be "1" (core protocol version)
	return parts[0] == "1"
}
```

### 3.7 `devinfo.go`

```go
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

	// Atomic write
	path := filepath.Join(dir, ".devinfo")
	tmpPath := path + ".tmp"

	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
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

	// Also clean up temp file
	os.Remove(path + ".tmp")
}
```

### 3.8 `logger.go`

```go
package main

import (
	"fmt"
	"os"
	"time"
)

// ANSI color codes
const (
	colorReset  = "\033[0m"
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorBlue   = "\033[34m"
	colorPurple = "\033[35m"
	colorCyan   = "\033[36m"
	colorGray   = "\033[90m"
	colorBold   = "\033[1m"
)

// Logger provides color-coded multiplexed output for all subprocesses.
type Logger struct {
	verbose bool
}

func NewLogger(verbose bool) *Logger {
	return &Logger{verbose: verbose}
}

func (l *Logger) timestamp() string {
	return time.Now().Format("15:04:05")
}

func (l *Logger) System(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "%s%s %s[system]%s %s\n",
		colorGray, l.timestamp(), colorBold+colorCyan, colorReset, msg)
}

func (l *Logger) Vite(line string) {
	fmt.Fprintf(os.Stderr, "%s%s %s[vite]%s   %s\n",
		colorGray, l.timestamp(), colorPurple, colorReset, line)
}

func (l *Logger) Go(line string) {
	fmt.Fprintf(os.Stderr, "%s%s %s[go]%s     %s\n",
		colorGray, l.timestamp(), colorGreen, colorReset, line)
}

func (l *Logger) Plugin(line string) {
	fmt.Fprintf(os.Stderr, "%s%s %s[plugin]%s %s\n",
		colorGray, l.timestamp(), colorBlue, colorReset, line)
}

func (l *Logger) Error(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "%s%s %s[error]%s  %s%s%s\n",
		colorGray, l.timestamp(), colorRed, colorReset, colorRed, msg, colorReset)
}

func (l *Logger) Debug(format string, args ...any) {
	if !l.verbose {
		return
	}
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "%s%s %s[debug]%s  %s\n",
		colorGray, l.timestamp(), colorGray, colorReset, msg)
}
```

---

## 4. Distribution

### go install

```bash
go install github.com/omniviewdev/omniview/cmd/omniview-plugin-dev@latest
```

The tool lives in the Omniview monorepo at `cmd/omniview-plugin-dev/`. Its `go.mod` only depends on `fsnotify` and `gopkg.in/yaml.v3` -- no heavy dependencies.

### Homebrew

```ruby
class OmniviewPluginDev < Formula
  desc "Development tool for Omniview plugins"
  homepage "https://github.com/omniviewdev/omniview"
  url "https://github.com/omniviewdev/omniview/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "..."
  license "Apache-2.0"

  depends_on "go" => :build

  def install
    system "go", "build", *std_go_args(
      ldflags: "-s -w -X main.Version=#{version}",
      output: bin/"omniview-plugin-dev",
    ), "./cmd/omniview-plugin-dev"
  end

  test do
    assert_match "omniview-plugin-dev", shell_output("#{bin}/omniview-plugin-dev --version")
  end
end
```

### npm Wrapper

For developers who prefer npm:

```json
{
  "name": "@omniviewdev/plugin-dev",
  "version": "0.1.0",
  "bin": {
    "omniview-plugin-dev": "./bin/run.js"
  },
  "scripts": {
    "postinstall": "node scripts/download-binary.js"
  }
}
```

The npm package downloads the platform-specific Go binary on install.

---

## 5. How It Interacts with the IDE

The CLI tool and the IDE communicate exclusively through the `.devinfo` file protocol:

```
CLI Tool                                IDE (Omniview)
   │                                       │
   ├── Starts plugin binary               │
   ├── Captures handshake                  │
   ├── Writes .devinfo ───────────────────▶ ExternalWatcher detects file
   │                                       ├── Parses .devinfo
   │                                       ├── Validates PID
   │                                       ├── Connects via ReattachConfig
   │                                       └── Emits plugin/devserver/status
   │                                       │
   │ (developer edits Go file)             │
   │                                       │
   ├── Watcher triggers rebuild            │
   ├── Stops plugin (SIGTERM)              │
   │   └── .devinfo deleted ──────────────▶ ExternalWatcher detects removal
   │                                       └── Disconnects gRPC
   ├── Rebuilds binary                     │
   ├── Starts new plugin process           │
   ├── Writes new .devinfo ──────────────▶ ExternalWatcher detects file
   │                                       ├── Connects to new process
   │                                       └── Emits status update
   │                                       │
   │ (developer presses Ctrl+C)            │
   │                                       │
   ├── Kills Vite                          │
   ├── Kills plugin (SIGTERM)              │
   └── Removes .devinfo ─────────────────▶ ExternalWatcher detects removal
                                           └── Disconnects, marks stopped
```

The CLI tool does NOT:
- Communicate directly with the IDE process
- Use Wails events or bindings
- Require the IDE to be running
- Modify any IDE configuration

The CLI tool DOES:
- Write to `~/.omniview/plugins/<id>/` (same directory the IDE uses)
- Follow the `.devinfo` protocol exactly
- Clean up on exit (SIGINT, SIGTERM)

This decoupled design means:
1. Developers can use the CLI without the IDE (for CI/testing)
2. The IDE can connect to CLI-managed plugins seamlessly
3. Multiple developers can run the CLI independently
4. The CLI can be replaced with `air` or any other tool that writes `.devinfo`

---

## 6. Research: Improved Architecture Options

Based on research into modern process orchestration tools, Go hot-reload alternatives, and how other extensible platforms handle plugin development.

### 6.1 Better Process Orchestration: `oklog/run`

Instead of hand-rolling goroutine lifecycle management, use **[oklog/run](https://github.com/oklog/run)** (1.7k stars). It provides a `run.Group` where each "actor" is an `(execute, interrupt)` function pair. When `Run()` is called, all actors run concurrently; when the first exits, all interrupt functions are called.

This is a direct improvement over the hand-coded approach in section 3:

```go
import "github.com/oklog/run"

var g run.Group

// Actor 1: Vite dev server
g.Add(func() error { return runVite(ctx) }, func(error) { stopVite() })

// Actor 2: Go file watcher + rebuilder
g.Add(func() error { return runGoWatch(ctx) }, func(error) { stopWatcher() })

// Actor 3: Plugin binary lifecycle
g.Add(func() error { return runPluginBinary(ctx) }, func(error) { stopPlugin() })

// Actor 4: Signal handler (SIGINT/SIGTERM)
g.Add(run.SignalHandler(ctx, syscall.SIGINT, syscall.SIGTERM))

// Actor 5: State file writer
g.Add(func() error { return writeStateLoop(ctx, statusCh) }, func(error) { cleanupDevInfo() })

if err := g.Run(); err != nil {
    log.Error("Shutdown: %v", err)
}
```

Benefits over the current design:
- Guaranteed shutdown of all actors when any one fails
- No manual signal handling boilerplate
- Each actor defines its own cleanup in the interrupt function
- Battle-tested in production (from the oklog project)

### 6.2 Better Go Hot-Reload: `wgo`

Instead of building our own fsnotify watcher (section 3.4), consider **[wgo](https://github.com/bokwoon95/wgo)** (555 stars):

```bash
# No config file needed -- all CLI flags
wgo -file .go -xdir vendor -xdir testdata go build -o build/bin/plugin ./pkg
```

Benefits:
- Zero config (no `.air.toml` required)
- Can be invoked as a child process with specific flags
- Supports parallel commands via `::` separator
- Dead simple -- two files of implementation
- Actively maintained (last commit December 2024)

However, embedding our own watcher gives more control over the `.devinfo` update cycle (stop plugin → rebuild → restart → update devinfo). **Recommendation**: Keep the custom watcher for IDE-managed mode but document `wgo` as an alternative for external mode users who don't want `air`.

### 6.3 Insights from Other Platforms

| Platform | Key Pattern Relevant to Omniview |
|----------|--------------------------------|
| **Raycast** | PID file + app URL scheme for CLI ↔ host communication. Directly validates our `.devinfo` approach. |
| **VS Code** | Extension Host is a separate process with IPC. Our go-plugin gRPC model is analogous. |
| **Backstage** | Backend uses SWC on-the-fly transpilation + process restart (no bundling in dev). |
| **Moon** | "Persistent tasks run last" pattern -- build deps first, then start long-running dev servers. |

### 6.4 Recommended Approach

Ship **two development paths** (ranked by ease of setup):

1. **IDE-managed** (zero setup): Click "Start Dev Server" in the plugin card. IDE handles everything.

2. **CLI binary** (`omniview-plugin-dev`): Single `go install`-able binary. Uses oklog/run for orchestration. Communicates with IDE via `.devinfo` protocol. Works without IDE running.

Both paths converge on the same `.devinfo` protocol for IDE ↔ plugin communication, making them fully interchangeable. Since the CLI tool is a standalone Go binary with no special dependencies, it can be run inside any environment the developer prefers (local, remote, containerized) without us needing to provide specific container configurations.
