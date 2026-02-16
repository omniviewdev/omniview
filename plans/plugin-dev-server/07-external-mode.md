# 07 -- External/Self-Managed Plugin Mode

## Phase 6: External Plugin Mode via ReattachConfig

**Goal**: Allow plugin developers to run their own plugin binary and Vite dev server externally (outside of the IDE), with the IDE automatically detecting and connecting to the running processes via a `.devinfo` file protocol.

**Prerequisites**: Phase 2 (DevServer Manager) must be complete for the IDE-side connection logic.

---

## 1. go-plugin ReattachConfig

### 1.1 What is ReattachConfig?

`go-plugin` normally launches the plugin binary as a child process and captures its stdout to read the handshake line. `ReattachConfig` is an alternative mode that connects to an already-running plugin process, skipping the launch and handshake entirely.

This is critical for external mode: the developer starts the plugin binary themselves (via `go run`, `air`, or a debugger), and the IDE attaches to the running process.

### 1.2 ReattachConfig Struct

From the `go-plugin` source (`github.com/hashicorp/go-plugin`):

```go
// ReattachConfig is used to configure a client to reattach to an
// already-running plugin process. You can retrieve this information by
// calling ReattachConfig() on Client.
type ReattachConfig struct {
    Protocol        Protocol
    ProtocolVersion int
    Addr            net.Addr
    Pid             int
    ReattachFunc    ReattachFunc

    // Test is set to true if this is being used in a test environment.
    // When true, the host will NOT kill the plugin process when disconnecting.
    Test            bool
}
```

| Field | Type | Description |
|-------|------|-------------|
| `Protocol` | `Protocol` (string) | Either `ProtocolNetRPC` or `ProtocolGRPC`. Omniview uses `ProtocolGRPC`. |
| `ProtocolVersion` | `int` | The application-level protocol version. Omniview uses `1`. |
| `Addr` | `net.Addr` | The network address the plugin is listening on. Typically `net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: <port>}`. |
| `Pid` | `int` | The OS process ID of the running plugin. Used for health checking. |
| `ReattachFunc` | `func` | Optional custom reattach function. Not used by Omniview. |
| `Test` | `bool` | **Critical**: When `true`, the host will NOT kill the plugin process when the client disconnects. This MUST be `true` for external mode so the developer's plugin process survives IDE restarts. |

### 1.3 How Handshake is Skipped

In normal mode, `go-plugin` creates a child process and reads the handshake line from its stdout:

```
CORE-PROTOCOL-VERSION|APP-PROTOCOL-VERSION|NETWORK-TYPE|NETWORK-ADDR|PROTOCOL
```

For example:
```
1|1|tcp|127.0.0.1:42367|grpc
```

When `ReattachConfig` is provided in `ClientConfig`, the client skips process creation entirely:
1. No `Cmd` is executed
2. No stdout is read
3. The client uses the `Addr` from `ReattachConfig` to establish a gRPC connection directly
4. `Protocol` and `ProtocolVersion` from `ReattachConfig` replace what would have been parsed from the handshake
5. `MagicCookieKey`/`MagicCookieValue` verification is also skipped

### 1.4 Test=true Behavior

When `ReattachConfig.Test = true`:
- The host process does NOT send `SIGKILL` to the plugin when `Client.Kill()` is called
- The host does NOT call `os.Process.Kill()` on the plugin PID
- `Client.Kill()` becomes a graceful disconnect: close the gRPC connection, clean up resources
- The plugin process continues running independently

This is essential for external mode:
- Developer starts plugin with `go run ./pkg` or via a debugger
- IDE connects via ReattachConfig
- IDE disconnects (shutdown, restart, user action) -- plugin keeps running
- IDE reconnects on next startup by re-reading `.devinfo`

### 1.5 Using ReattachConfig in Omniview

Current normal-mode plugin loading (`manager.go` line 487):

```go
pluginClient := plugin.NewClient(&plugin.ClientConfig{
    HandshakeConfig: metadata.GenerateHandshakeConfig(),
    Plugins: map[string]plugin.Plugin{
        "resource":  &rp.ResourcePlugin{},
        "exec":      &ep.Plugin{},
        "networker": &np.Plugin{},
        "log":       &lp.Plugin{},
        "settings":  &sp.SettingsPlugin{},
    },
    GRPCDialOptions: sdk.GRPCDialOptions(),
    Cmd:              exec.Command(filepath.Join(location, "bin", "plugin")),
    AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
    Logger:           hclog.New(&hclog.LoggerOptions{...}),
})
```

External-mode loading (using ReattachConfig instead of Cmd):

```go
pluginClient := plugin.NewClient(&plugin.ClientConfig{
    HandshakeConfig: metadata.GenerateHandshakeConfig(),
    Plugins: map[string]plugin.Plugin{
        "resource":  &rp.ResourcePlugin{},
        "exec":      &ep.Plugin{},
        "networker": &np.Plugin{},
        "log":       &lp.Plugin{},
        "settings":  &sp.SettingsPlugin{},
    },
    GRPCDialOptions:  sdk.GRPCDialOptions(),
    AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
    Logger:           hclog.New(&hclog.LoggerOptions{...}),
    // No Cmd field -- we are reattaching to an existing process
    Reattach: &plugin.ReattachConfig{
        Protocol:        plugin.ProtocolGRPC,
        ProtocolVersion: 1,
        Addr:            &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 42367},
        Pid:             12345,
        Test:            true,
    },
})
```

Key differences:
- `Cmd` is **absent** (not nil; the field is omitted entirely)
- `Reattach` is **present** with connection information from `.devinfo`
- `Test: true` prevents the IDE from killing the developer's plugin process

---

## 2. `.devinfo` File Protocol

### 2.1 Location

```
~/.omniview/plugins/<plugin-id>/.devinfo
```

Examples:
- `~/.omniview/plugins/kubernetes/.devinfo`
- `~/.omniview/plugins/my-custom-plugin/.devinfo`

The file sits in the same directory as the plugin's installed artifacts (`plugin.yaml`, `bin/`, `assets/`).

### 2.2 JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["pid", "protocol", "protocolVersion", "addr"],
  "properties": {
    "pid": {
      "type": "integer",
      "description": "OS process ID of the running plugin binary"
    },
    "protocol": {
      "type": "string",
      "enum": ["grpc", "netrpc"],
      "description": "Wire protocol. Omniview plugins always use 'grpc'"
    },
    "protocolVersion": {
      "type": "integer",
      "description": "Application-level protocol version. Currently 1"
    },
    "addr": {
      "type": "string",
      "description": "Network address in host:port format, e.g. '127.0.0.1:42367'"
    },
    "vitePort": {
      "type": "integer",
      "description": "Port number of the Vite dev server for this plugin's UI, if running"
    },
    "pluginId": {
      "type": "string",
      "description": "The plugin ID, for validation purposes"
    },
    "version": {
      "type": "string",
      "description": "The plugin version string"
    },
    "startedAt": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when the plugin process started"
    }
  }
}
```

### 2.3 Example `.devinfo` File

```json
{
  "pid": 48291,
  "protocol": "grpc",
  "protocolVersion": 1,
  "addr": "127.0.0.1:42367",
  "vitePort": 15173,
  "pluginId": "kubernetes",
  "version": "0.5.0",
  "startedAt": "2026-02-16T10:30:00Z"
}
```

### 2.4 Lifecycle

| Event | Action |
|-------|--------|
| Plugin process starts | Plugin SDK writes `.devinfo` file |
| Plugin process restarts (e.g., `air` rebuild) | `.devinfo` is deleted then re-created with new PID/addr |
| Plugin process stops | `.devinfo` is deleted via `CleanupDevInfo()` (or OS cleanup) |
| IDE detects `.devinfo` creation | Parse, validate PID, connect via ReattachConfig |
| IDE detects `.devinfo` update | Disconnect from old process, re-connect to new |
| IDE detects `.devinfo` deletion | Disconnect, mark plugin as disconnected |
| IDE startup | Scan for existing `.devinfo` files, connect to any running plugins |

### 2.5 Atomicity

The `.devinfo` file must be written atomically to prevent the IDE from reading a partial file:

1. Write to a temporary file: `~/.omniview/plugins/<id>/.devinfo.tmp`
2. Rename to final path: `~/.omniview/plugins/<id>/.devinfo`

`os.Rename()` is atomic on all major filesystems (ext4, APFS, NTFS).

---

## 3. Plugin SDK Changes

### 3.1 New File: `pkg/plugin-sdk/pkg/sdk/devinfo.go`

```go
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

	// Ensure the directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin directory: %w", err)
	}

	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal devinfo: %w", err)
	}

	// Atomic write: write to .tmp, then rename
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write devinfo temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath) // Clean up on failure
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

	// Also clean up any leftover temp file
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

// ReadDevInfoFromPath reads a .devinfo file from an explicit path.
func ReadDevInfoFromPath(path string) (*DevInfo, error) {
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
```

### 3.2 Integration with Plugin `Serve()` Function

Modify `pkg/plugin-sdk/pkg/sdk/plugin.go` to optionally write `.devinfo` when `OMNIVIEW_DEV=1` is set.

#### Current `Serve()` (lines 156-166):

```go
func (p *Plugin) Serve() {
    plugin.Serve(&plugin.ServeConfig{
        HandshakeConfig: p.meta.GenerateHandshakeConfig(),
        Plugins:         p.pluginMap,
        GRPCServer:      GRPCServerFactory,
        Logger: hclog.New(&hclog.LoggerOptions{
            Name:  "plugin",
            Level: hclog.Debug,
        }),
    })
}
```

#### New `Serve()`:

```go
func (p *Plugin) Serve() {
    isDev := os.Getenv("OMNIVIEW_DEV") == "1"

    // If in dev mode, set up a listener so we can capture the address
    // for the .devinfo file, and register cleanup on process exit.
    if isDev {
        // Register cleanup handler for graceful shutdown
        go func() {
            sigCh := make(chan os.Signal, 1)
            signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
            <-sigCh
            CleanupDevInfo(p.meta.ID)
            os.Exit(0)
        }()

        // Use ServeConfig with a Test flag so we get the listener info
        // go-plugin's Serve() writes the handshake to stdout
        // We capture it by using a pipe
        origStdout := os.Stdout
        r, w, err := os.Pipe()
        if err != nil {
            p.Logger.Errorw("failed to create pipe for dev info capture", "error", err)
            // Fall back to normal serve
            p.serveNormal()
            return
        }

        os.Stdout = w

        // Start serving in a goroutine
        done := make(chan struct{})
        go func() {
            plugin.Serve(&plugin.ServeConfig{
                HandshakeConfig: p.meta.GenerateHandshakeConfig(),
                Plugins:         p.pluginMap,
                GRPCServer:      GRPCServerFactory,
                Logger: hclog.New(&hclog.LoggerOptions{
                    Name:  "plugin",
                    Level: hclog.Debug,
                }),
            })
            close(done)
        }()

        // Read the handshake line from the pipe
        buf := make([]byte, 4096)
        n, readErr := r.Read(buf)

        // Restore stdout immediately
        os.Stdout = origStdout

        if readErr != nil {
            p.Logger.Errorw("failed to read handshake line", "error", readErr)
        } else {
            handshakeLine := string(buf[:n])
            // Write it to real stdout so go-plugin host can read it
            fmt.Print(handshakeLine)

            // Parse vite port from env (set by CLI tool or manually)
            vitePort := 0
            if vp := os.Getenv("OMNIVIEW_VITE_PORT"); vp != "" {
                vitePort, _ = strconv.Atoi(vp)
            }

            if err := WriteDevInfo(p.meta.ID, p.meta.Version, handshakeLine, vitePort); err != nil {
                p.Logger.Errorw("failed to write devinfo", "error", err)
            } else {
                p.Logger.Infow("wrote .devinfo file",
                    "pluginID", p.meta.ID,
                    "handshake", strings.TrimSpace(handshakeLine),
                )
            }
        }

        // Wait for serve to complete
        <-done
        CleanupDevInfo(p.meta.ID)
        return
    }

    // Normal (non-dev) serve
    p.serveNormal()
}

func (p *Plugin) serveNormal() {
    plugin.Serve(&plugin.ServeConfig{
        HandshakeConfig: p.meta.GenerateHandshakeConfig(),
        Plugins:         p.pluginMap,
        GRPCServer:      GRPCServerFactory,
        Logger: hclog.New(&hclog.LoggerOptions{
            Name:  "plugin",
            Level: hclog.Debug,
        }),
    })
}
```

**Note on the pipe approach**: go-plugin's `Serve()` writes the handshake line to stdout. We intercept it with a pipe, capture the line (which contains the listen address), write it back to the real stdout (so go-plugin's host reads it normally), and then use the address to write `.devinfo`. This is necessary because go-plugin does not expose the listener address through any other API.

**Alternative simpler approach**: Instead of the pipe, the plugin SDK can use `plugin.ServeConfig.Test` mode and create its own listener. This gives direct access to the `net.Listener.Addr()`. See the CLI wrapper tool (Phase 9) for this approach.

### 3.3 Required Imports Addition

```go
import (
    "os/signal"
    "strconv"
    "syscall"
)
```

### 3.4 Triggering via Environment Variable

The `.devinfo` writing is triggered by `OMNIVIEW_DEV=1`:

```bash
# Developer runs plugin manually with dev mode
OMNIVIEW_DEV=1 go run ./pkg

# Or with a Vite port specified
OMNIVIEW_DEV=1 OMNIVIEW_VITE_PORT=15173 go run ./pkg
```

When `OMNIVIEW_DEV` is not set or not `"1"`, the `Serve()` function behaves exactly as before -- no pipe, no `.devinfo`, no cleanup handler.

---

## 4. DevServerManager External Mode: `external.go`

### 4.1 File: `backend/pkg/plugin/devserver/external.go`

This file handles:
- Watching `~/.omniview/plugins/` for `.devinfo` file creation/updates/deletion
- Parsing and validating `.devinfo` files
- Connecting to external plugins via `ReattachConfig`
- PID health checking
- Graceful disconnect on PID death or file deletion

```go
package devserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/hashicorp/go-hclog"
	"github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	ep "github.com/omniviewdev/plugin-sdk/pkg/exec"
	lp "github.com/omniviewdev/plugin-sdk/pkg/logs"
	np "github.com/omniviewdev/plugin-sdk/pkg/networker"
	rp "github.com/omniviewdev/plugin-sdk/pkg/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sp "github.com/omniviewdev/plugin-sdk/pkg/settings"
)

// DevInfo matches the JSON structure written by the plugin SDK.
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

// ExternalConnection tracks a connection to an externally-managed plugin.
type ExternalConnection struct {
	DevInfo      *DevInfo
	PluginClient *plugin.Client
	Connected    bool
	LastChecked  time.Time
	cancelHealth context.CancelFunc
}

// ExternalWatcher watches for .devinfo files and manages connections
// to externally-run plugin processes.
type ExternalWatcher struct {
	ctx         context.Context
	logger      *zap.SugaredLogger
	watcher     *fsnotify.Watcher
	connections map[string]*ExternalConnection // pluginID -> connection
	mu          sync.RWMutex
	pluginDir   string

	// onConnect is called when a new external plugin is connected.
	// The Manager uses this to integrate with the plugin system.
	onConnect func(pluginID string, info *DevInfo, client *plugin.Client) error

	// onDisconnect is called when an external plugin disconnects.
	onDisconnect func(pluginID string) error
}

// NewExternalWatcher creates a new watcher for .devinfo files.
func NewExternalWatcher(
	logger *zap.SugaredLogger,
	onConnect func(pluginID string, info *DevInfo, client *plugin.Client) error,
	onDisconnect func(pluginID string) error,
) (*ExternalWatcher, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	pluginDir := filepath.Join(homeDir, ".omniview", "plugins")

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	return &ExternalWatcher{
		logger:       logger.Named("ExternalWatcher"),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		onConnect:    onConnect,
		onDisconnect: onDisconnect,
	}, nil
}

// Start begins watching for .devinfo files. Must be called after the Wails
// context is available.
func (ew *ExternalWatcher) Start(ctx context.Context) error {
	ew.ctx = ctx

	// Ensure the plugin directory exists
	if err := os.MkdirAll(ew.pluginDir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin directory: %w", err)
	}

	// Watch each plugin subdirectory for .devinfo files
	entries, err := os.ReadDir(ew.pluginDir)
	if err != nil {
		return fmt.Errorf("failed to read plugin directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			pluginPath := filepath.Join(ew.pluginDir, entry.Name())
			if err := ew.watcher.Add(pluginPath); err != nil {
				ew.logger.Warnw("failed to watch plugin directory",
					"path", pluginPath,
					"error", err,
				)
			}
		}
	}

	// Also watch the parent directory for new plugin directories
	if err := ew.watcher.Add(ew.pluginDir); err != nil {
		return fmt.Errorf("failed to watch plugin base directory: %w", err)
	}

	// Scan for existing .devinfo files (reconnect after IDE restart)
	ew.scanExistingDevInfoFiles()

	// Start the event loop
	go ew.run()

	return nil
}

// Stop shuts down the external watcher and disconnects all external plugins.
func (ew *ExternalWatcher) Stop() {
	ew.mu.Lock()
	defer ew.mu.Unlock()

	for pluginID, conn := range ew.connections {
		ew.disconnectLocked(pluginID, conn)
	}

	ew.watcher.Close()
}

// IsExternallyManaged returns true if the plugin has an active external connection.
func (ew *ExternalWatcher) IsExternallyManaged(pluginID string) bool {
	ew.mu.RLock()
	defer ew.mu.RUnlock()
	conn, ok := ew.connections[pluginID]
	return ok && conn.Connected
}

// GetExternalInfo returns the DevInfo for an externally-managed plugin.
func (ew *ExternalWatcher) GetExternalInfo(pluginID string) *DevInfo {
	ew.mu.RLock()
	defer ew.mu.RUnlock()
	if conn, ok := ew.connections[pluginID]; ok {
		return conn.DevInfo
	}
	return nil
}

// scanExistingDevInfoFiles checks all plugin directories for existing .devinfo files
// and attempts to connect to them. This handles the case where the IDE restarts
// while external plugins are still running.
func (ew *ExternalWatcher) scanExistingDevInfoFiles() {
	entries, err := os.ReadDir(ew.pluginDir)
	if err != nil {
		ew.logger.Warnw("failed to scan for existing devinfo files", "error", err)
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		devInfoPath := filepath.Join(ew.pluginDir, entry.Name(), ".devinfo")
		if _, err := os.Stat(devInfoPath); err == nil {
			ew.logger.Infow("found existing .devinfo file", "path", devInfoPath)
			ew.handleDevInfoCreated(devInfoPath)
		}
	}
}

// run is the main event loop for the external watcher.
func (ew *ExternalWatcher) run() {
	for {
		select {
		case <-ew.ctx.Done():
			return

		case event, ok := <-ew.watcher.Events:
			if !ok {
				return
			}

			// Only care about .devinfo files
			if filepath.Base(event.Name) != ".devinfo" {
				// If a new directory was created in the plugins dir, start watching it
				if event.Has(fsnotify.Create) {
					info, err := os.Stat(event.Name)
					if err == nil && info.IsDir() && filepath.Dir(event.Name) == ew.pluginDir {
						ew.watcher.Add(event.Name)
					}
				}
				continue
			}

			switch {
			case event.Has(fsnotify.Create), event.Has(fsnotify.Write):
				ew.handleDevInfoCreated(event.Name)
			case event.Has(fsnotify.Remove):
				ew.handleDevInfoRemoved(event.Name)
			}

		case err, ok := <-ew.watcher.Errors:
			if !ok {
				return
			}
			ew.logger.Warnw("external watcher error", "error", err)
		}
	}
}

// handleDevInfoCreated processes a new or updated .devinfo file.
func (ew *ExternalWatcher) handleDevInfoCreated(path string) {
	ew.logger.Infow("detected .devinfo file", "path", path)

	// Small delay to ensure atomic rename is complete
	time.Sleep(50 * time.Millisecond)

	info, err := readDevInfoFile(path)
	if err != nil {
		ew.logger.Warnw("failed to read .devinfo file", "path", path, "error", err)
		return
	}

	// Validate the plugin ID matches the directory name
	dirName := filepath.Base(filepath.Dir(path))
	if info.PluginID != "" && info.PluginID != dirName {
		ew.logger.Warnw("plugin ID mismatch in .devinfo",
			"expected", dirName,
			"got", info.PluginID,
		)
		return
	}

	pluginID := dirName
	if info.PluginID != "" {
		pluginID = info.PluginID
	}

	// Validate PID is alive
	if !isPIDAlive(info.PID) {
		ew.logger.Warnw("plugin PID is not alive, ignoring .devinfo",
			"pluginID", pluginID,
			"pid", info.PID,
		)
		// Clean up stale .devinfo
		os.Remove(path)
		return
	}

	ew.mu.Lock()
	defer ew.mu.Unlock()

	// If we already have a connection for this plugin, disconnect first
	if existing, ok := ew.connections[pluginID]; ok {
		ew.disconnectLocked(pluginID, existing)
	}

	// Connect to the plugin via ReattachConfig
	if err := ew.connectToPlugin(pluginID, info); err != nil {
		ew.logger.Errorw("failed to connect to external plugin",
			"pluginID", pluginID,
			"error", err,
		)

		// Emit error status
		if ew.ctx != nil {
			runtime.EventsEmit(ew.ctx, "plugin/devserver/status", map[string]any{
				"pluginId":      pluginID,
				"mode":          "external",
				"grpcConnected": false,
				"error":         err.Error(),
			})
		}
		return
	}

	ew.logger.Infow("connected to external plugin",
		"pluginID", pluginID,
		"pid", info.PID,
		"addr", info.Addr,
		"vitePort", info.VitePort,
	)
}

// handleDevInfoRemoved processes a deleted .devinfo file.
func (ew *ExternalWatcher) handleDevInfoRemoved(path string) {
	dirName := filepath.Base(filepath.Dir(path))

	ew.mu.Lock()
	defer ew.mu.Unlock()

	if conn, ok := ew.connections[dirName]; ok {
		ew.logger.Infow("external plugin disconnected (devinfo removed)",
			"pluginID", dirName,
		)
		ew.disconnectLocked(dirName, conn)
	}
}

// connectToPlugin establishes a gRPC connection to an external plugin.
// Must be called with ew.mu held.
func (ew *ExternalWatcher) connectToPlugin(pluginID string, info *DevInfo) error {
	// Parse the address
	host, portStr, err := net.SplitHostPort(info.Addr)
	if err != nil {
		return fmt.Errorf("invalid address in .devinfo: %w", err)
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		return fmt.Errorf("invalid port in .devinfo: %w", err)
	}

	// Determine the protocol
	var proto plugin.Protocol
	switch strings.ToLower(info.Protocol) {
	case "grpc":
		proto = plugin.ProtocolGRPC
	default:
		return fmt.Errorf("unsupported protocol: %s", info.Protocol)
	}

	// Create go-plugin client with ReattachConfig
	pluginClient := plugin.NewClient(&plugin.ClientConfig{
		HandshakeConfig: plugin.HandshakeConfig{
			ProtocolVersion:  uint(info.ProtocolVersion),
			MagicCookieKey:   "OMNIVIEW",
			MagicCookieValue: fmt.Sprintf("%s-%s", pluginID, info.Version),
		},
		Plugins: map[string]plugin.Plugin{
			"resource":  &rp.ResourcePlugin{},
			"exec":      &ep.Plugin{},
			"networker": &np.Plugin{},
			"log":       &lp.Plugin{},
			"settings":  &sp.SettingsPlugin{},
		},
		GRPCDialOptions:  sdk.GRPCDialOptions(),
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:   pluginID + "-external",
			Output: os.Stdout,
			Level:  hclog.Debug,
		}),
		Reattach: &plugin.ReattachConfig{
			Protocol:        proto,
			ProtocolVersion: info.ProtocolVersion,
			Addr: &net.TCPAddr{
				IP:   net.ParseIP(host),
				Port: port,
			},
			Pid:  info.PID,
			Test: true, // Do NOT kill the external process on disconnect
		},
	})

	// Test the connection
	rpcClient, err := pluginClient.Client()
	if err != nil {
		pluginClient.Kill()
		return fmt.Errorf("failed to establish gRPC connection: %w", err)
	}

	// Verify the connection works with a ping
	if err := rpcClient.Ping(); err != nil {
		rpcClient.Close()
		pluginClient.Kill()
		return fmt.Errorf("gRPC ping failed: %w", err)
	}

	// Store the connection
	healthCtx, healthCancel := context.WithCancel(ew.ctx)
	conn := &ExternalConnection{
		DevInfo:      info,
		PluginClient: pluginClient,
		Connected:    true,
		LastChecked:  time.Now(),
		cancelHealth: healthCancel,
	}
	ew.connections[pluginID] = conn

	// Notify the manager that a new external plugin is connected
	if ew.onConnect != nil {
		if err := ew.onConnect(pluginID, info, pluginClient); err != nil {
			ew.logger.Errorw("onConnect callback failed",
				"pluginID", pluginID,
				"error", err,
			)
			// Still keep the connection -- the plugin is reachable
		}
	}

	// Emit status event
	if ew.ctx != nil {
		runtime.EventsEmit(ew.ctx, "plugin/devserver/status", map[string]any{
			"pluginId":      pluginID,
			"mode":          "external",
			"grpcConnected": true,
			"vitePort":      info.VitePort,
			"pid":           info.PID,
		})
	}

	// Start health check loop
	go ew.healthCheckLoop(healthCtx, pluginID, info.PID)

	return nil
}

// disconnectLocked disconnects from an external plugin.
// Must be called with ew.mu held.
func (ew *ExternalWatcher) disconnectLocked(pluginID string, conn *ExternalConnection) {
	if conn.cancelHealth != nil {
		conn.cancelHealth()
	}

	if conn.PluginClient != nil {
		conn.PluginClient.Kill() // With Test=true, this just closes the connection
	}

	conn.Connected = false
	delete(ew.connections, pluginID)

	// Notify the manager
	if ew.onDisconnect != nil {
		if err := ew.onDisconnect(pluginID); err != nil {
			ew.logger.Warnw("onDisconnect callback failed",
				"pluginID", pluginID,
				"error", err,
			)
		}
	}

	// Emit status event
	if ew.ctx != nil {
		runtime.EventsEmit(ew.ctx, "plugin/devserver/status", map[string]any{
			"pluginId":      pluginID,
			"mode":          "external",
			"grpcConnected": false,
		})
	}
}

// healthCheckLoop periodically checks if the external plugin PID is still alive.
func (ew *ExternalWatcher) healthCheckLoop(ctx context.Context, pluginID string, pid int) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !isPIDAlive(pid) {
				ew.logger.Infow("external plugin PID died",
					"pluginID", pluginID,
					"pid", pid,
				)

				ew.mu.Lock()
				if conn, ok := ew.connections[pluginID]; ok {
					ew.disconnectLocked(pluginID, conn)
				}
				ew.mu.Unlock()

				// Clean up the .devinfo file since the process is dead
				devInfoPath := filepath.Join(ew.pluginDir, pluginID, ".devinfo")
				os.Remove(devInfoPath)
				return
			}

			ew.mu.Lock()
			if conn, ok := ew.connections[pluginID]; ok {
				conn.LastChecked = time.Now()
			}
			ew.mu.Unlock()
		}
	}
}

// readDevInfoFile reads and parses a .devinfo JSON file.
func readDevInfoFile(path string) (*DevInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var info DevInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, fmt.Errorf("invalid JSON in .devinfo: %w", err)
	}

	// Basic validation
	if info.PID <= 0 {
		return nil, fmt.Errorf("invalid PID: %d", info.PID)
	}
	if info.Addr == "" {
		return nil, fmt.Errorf("missing addr field")
	}
	if info.Protocol == "" {
		info.Protocol = "grpc" // default
	}
	if info.ProtocolVersion == 0 {
		info.ProtocolVersion = 1 // default
	}

	return &info, nil
}

// isPIDAlive checks if a process with the given PID is still running.
func isPIDAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	// On Unix, sending signal 0 checks if the process exists without
	// actually sending a signal.
	err = process.Signal(syscall.Signal(0))
	return err == nil
}
```

---

## 5. Air Integration

[Air](https://github.com/air-verse/air) is a popular Go live-reload tool. When a developer uses Air to develop a plugin, the workflow is:

1. Air watches `.go` files in the plugin directory
2. On change, Air rebuilds the binary and restarts the process
3. The new process writes a new `.devinfo` (new PID, new addr)
4. The IDE's ExternalWatcher detects the `.devinfo` update
5. The IDE disconnects from the old process and connects to the new one

### 5.1 Air Configuration Template

Place this at the plugin root: `<plugin-root>/.air.toml`

```toml
# Air configuration for Omniview plugin development
# See: https://github.com/air-verse/air

root = "."
tmp_dir = "build/tmp"

[build]
  # Build the plugin binary
  cmd = "go build -o build/bin/plugin ./pkg"

  # Run the plugin with dev mode enabled
  bin = "build/bin/plugin"

  # Set environment variables for .devinfo writing
  full_bin = "OMNIVIEW_DEV=1 OMNIVIEW_VITE_PORT=15173 ./build/tmp/main"

  # Watch these directories
  include_dir = ["pkg"]
  include_ext = ["go", "tpl", "tmpl"]

  # Ignore these
  exclude_dir = ["build", "ui", "node_modules", "vendor"]
  exclude_regex = ["_test\\.go$"]

  # Debounce delay
  delay = 500

  # Stop the old process before starting the new one
  stop_on_error = false

  # Send SIGTERM (not SIGKILL) so cleanup handlers run
  kill_delay = "500ms"
  send_interrupt = true

  # Log output
  log = "build/tmp/air.log"

[log]
  time = true
  main_only = false

[color]
  main = "cyan"
  watcher = "magenta"
  build = "yellow"
  runner = "green"

[misc]
  clean_on_exit = true
```

### 5.2 How Air + .devinfo Works Together

```
Developer starts: air

Air Flow:
  1. Build: go build -o build/tmp/main ./pkg
  2. Run: OMNIVIEW_DEV=1 ./build/tmp/main
  3. Plugin starts, writes .devinfo with PID=12345, addr=127.0.0.1:42367
  4. IDE detects .devinfo, connects via ReattachConfig

Developer edits a .go file:
  5. Air detects change
  6. Air sends SIGTERM to PID 12345
  7. Plugin's signal handler calls CleanupDevInfo() → .devinfo deleted
  8. IDE detects .devinfo deletion → disconnects
  9. Air rebuilds: go build -o build/tmp/main ./pkg
  10. Air starts new process: OMNIVIEW_DEV=1 ./build/tmp/main
  11. New plugin starts with PID=12346, addr=127.0.0.1:42390
  12. Plugin writes new .devinfo
  13. IDE detects .devinfo creation → connects to new process
```

The key requirement is `send_interrupt = true` in the Air config. This ensures Air sends `SIGTERM` (not `SIGKILL`), giving the plugin's cleanup handler time to delete `.devinfo` before Air starts the new process.

### 5.3 Running Air with Vite

For full-stack plugin development with Air + Vite:

**Terminal 1 (Go backend)**:
```bash
cd plugins/my-plugin
air
```

**Terminal 2 (Vite UI dev server)**:
```bash
cd plugins/my-plugin/ui
OMNIVIEW_VITE_PORT=15173 pnpm run dev
```

The IDE detects both:
- `.devinfo` file for gRPC connection
- Vite dev server for HMR (via the `vitePort` field in `.devinfo`)

---

## 6. Integration with DevServerManager

The `ExternalWatcher` is owned by the `DevServerManager` (from Phase 2). Here is how they connect:

### 6.1 Manager Integration

In `backend/pkg/plugin/devserver/manager.go`:

```go
type Manager struct {
    // ... existing fields from Phase 2 ...
    externalWatcher *ExternalWatcher
    pluginManager   PluginManagerRef  // ref to the main plugin manager
}

// PluginManagerRef is the interface the devserver package uses to
// reload plugins via the main plugin manager.
type PluginManagerRef interface {
    ReloadPlugin(id string) (types.Plugin, error)
    LoadPlugin(id string, opts *LoadPluginOptions) (types.Plugin, error)
    UnloadPlugin(id string) error
}

func (m *Manager) Initialize(ctx context.Context) error {
    m.ctx = ctx

    // ... existing initialization ...

    // Start the external watcher
    watcher, err := NewExternalWatcher(
        m.logger,
        m.handleExternalConnect,
        m.handleExternalDisconnect,
    )
    if err != nil {
        return fmt.Errorf("failed to create external watcher: %w", err)
    }

    m.externalWatcher = watcher
    return watcher.Start(ctx)
}

func (m *Manager) handleExternalConnect(pluginID string, info *DevInfo, client *plugin.Client) error {
    m.logger.Infow("external plugin connected",
        "pluginID", pluginID,
        "addr", info.Addr,
        "vitePort", info.VitePort,
    )

    // Create or update a DevServerInstance for this plugin in external mode
    m.mu.Lock()
    m.instances[pluginID] = &DevServerInstance{
        PluginID: pluginID,
        Mode:     ModeExternal,
        VitePort: info.VitePort,
        State: DevServerState{
            Mode:          "external",
            GRPCConnected: true,
            VitePort:      info.VitePort,
        },
    }
    m.mu.Unlock()

    return nil
}

func (m *Manager) handleExternalDisconnect(pluginID string) error {
    m.logger.Infow("external plugin disconnected", "pluginID", pluginID)

    m.mu.Lock()
    delete(m.instances, pluginID)
    m.mu.Unlock()

    return nil
}
```

### 6.2 IsManaged Update

The `IsManaged()` method now covers both IDE-managed and external modes:

```go
func (m *Manager) IsManaged(pluginID string) bool {
    m.mu.RLock()
    defer m.mu.RUnlock()

    // Check IDE-managed instances
    if _, ok := m.instances[pluginID]; ok {
        return true
    }

    // Check externally-managed instances
    if m.externalWatcher != nil && m.externalWatcher.IsExternallyManaged(pluginID) {
        return true
    }

    return false
}
```

---

## 7. Security Considerations

### 7.1 File Permissions

The `.devinfo` file is written with `0644` permissions (owner read/write, group/other read). This is acceptable because:
- The file only contains a PID and localhost address
- An attacker with filesystem access could already attach to the process
- No secrets or credentials are stored in `.devinfo`

### 7.2 PID Reuse

On busy systems, PIDs can be reused. The health check only verifies the PID is alive, not that it is still the same plugin process. Mitigations:
- The `startedAt` timestamp in `.devinfo` can be compared with the process start time
- The gRPC connection will fail if the new process is not a go-plugin server
- The handshake (MagicCookieValue) must match

### 7.3 Address Binding

Plugins should only bind to `127.0.0.1` (loopback), not `0.0.0.0`. go-plugin defaults to this behavior. The `.devinfo` address should always be a loopback address.

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| `.devinfo` contains invalid JSON | Log warning, ignore file |
| PID in `.devinfo` is dead | Remove `.devinfo`, log info |
| gRPC connection fails | Log error, emit error status, retry on next `.devinfo` update |
| PID dies after connection | Health check detects in <=5s, disconnect, clean up |
| `.devinfo` written with wrong pluginID | Log warning, ignore (directory name takes precedence) |
| Multiple `.devinfo` updates in rapid succession | Each update triggers disconnect+reconnect; 50ms debounce on read |
| Plugin crashes without cleanup | PID health check detects death, removes stale `.devinfo` |
