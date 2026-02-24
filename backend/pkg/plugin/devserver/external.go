package devserver

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// ExternalConnection tracks a connection to an externally-managed plugin.
type ExternalConnection struct {
	DevInfo     *DevInfoFile
	Connected   bool
	LastChecked time.Time

	cancelHealth context.CancelFunc
}

// ExternalWatcher watches for .devinfo files in ~/.omniview/plugins/ and
// manages connections to externally-run plugin processes.
type ExternalWatcher struct {
	ctx         context.Context
	logger      *zap.SugaredLogger
	watcher     *fsnotify.Watcher
	connections map[string]*ExternalConnection // pluginID -> connection
	mu          sync.RWMutex
	pluginDir   string
	done        chan struct{} // closed when the run() goroutine exits

	// onConnect is called when a new external plugin is detected.
	onConnect func(pluginID string, info *DevInfoFile)

	// onDisconnect is called when an external plugin disconnects.
	onDisconnect func(pluginID string)
}

// NewExternalWatcher creates a new watcher for .devinfo files.
func NewExternalWatcher(
	logger *zap.SugaredLogger,
	onConnect func(pluginID string, info *DevInfoFile),
	onDisconnect func(pluginID string),
) (*ExternalWatcher, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, apperror.Internal(err, "Failed to get home directory")
	}

	pluginDir := filepath.Join(homeDir, ".omniview", "plugins")

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, apperror.Internal(err, "Failed to create file watcher")
	}

	return &ExternalWatcher{
		logger:       logger.Named("ExternalWatcher"),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    onConnect,
		onDisconnect: onDisconnect,
	}, nil
}

// Start begins watching for .devinfo files. Must be called after the Wails
// context is available.
func (ew *ExternalWatcher) Start(ctx context.Context) error {
	ew.ctx = ctx

	// Ensure the plugin directory exists.
	if err := os.MkdirAll(ew.pluginDir, 0755); err != nil {
		return apperror.Internal(err, "Failed to create plugin directory")
	}

	// Watch each plugin subdirectory for .devinfo files.
	entries, err := os.ReadDir(ew.pluginDir)
	if err != nil {
		return apperror.Internal(err, "Failed to read plugin directory")
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

	// Also watch the parent directory for new plugin directories.
	if err := ew.watcher.Add(ew.pluginDir); err != nil {
		return apperror.Internal(err, "Failed to watch plugin directory")
	}

	// Scan for existing .devinfo files (reconnect after IDE restart).
	ew.scanExistingDevInfoFiles()

	// Start the event loop.
	go ew.run()

	ew.logger.Info("external watcher started")
	return nil
}

// Stop shuts down the external watcher and disconnects all external plugins.
// It blocks until the run() goroutine has fully exited.
func (ew *ExternalWatcher) Stop() {
	ew.mu.Lock()
	for pluginID, conn := range ew.connections {
		ew.disconnectLocked(pluginID, conn)
	}
	ew.mu.Unlock()

	ew.watcher.Close()

	// Wait for run() to exit.
	if ew.done != nil {
		select {
		case <-ew.done:
		case <-time.After(5 * time.Second):
			ew.logger.Warn("external watcher event loop did not exit in time")
		}
	}

	ew.logger.Info("external watcher stopped")
}

// IsExternallyManaged returns true if the plugin has an active external connection.
func (ew *ExternalWatcher) IsExternallyManaged(pluginID string) bool {
	ew.mu.RLock()
	defer ew.mu.RUnlock()
	conn, ok := ew.connections[pluginID]
	return ok && conn.Connected
}

// GetExternalInfo returns the DevInfo for an externally-managed plugin, or nil.
func (ew *ExternalWatcher) GetExternalInfo(pluginID string) *DevInfoFile {
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
	defer close(ew.done)

	for {
		select {
		case <-ew.ctx.Done():
			return

		case event, ok := <-ew.watcher.Events:
			if !ok {
				return
			}

			// If a new directory was created in the plugins dir, start watching it.
			if filepath.Base(event.Name) != ".devinfo" {
				if event.Has(fsnotify.Create) {
					info, err := os.Stat(event.Name)
					if err == nil && info.IsDir() && filepath.Dir(event.Name) == ew.pluginDir {
						if err := ew.watcher.Add(event.Name); err != nil {
							ew.logger.Warnw("failed to watch new plugin directory",
								"path", event.Name,
								"error", err,
							)
						}
					}
				}
				continue
			}

			switch {
			case event.Has(fsnotify.Create), event.Has(fsnotify.Write):
				ew.handleDevInfoCreated(event.Name)
			case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
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

	// Small delay to ensure atomic rename is complete.
	time.Sleep(50 * time.Millisecond)

	info, err := readDevInfoFile(path)
	if err != nil {
		ew.logger.Warnw("failed to read .devinfo file", "path", path, "error", err)
		return
	}

	// Validate the plugin ID matches the directory name.
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

	// Validate PID is alive.
	if !isPIDAlive(info.PID) {
		ew.logger.Warnw("plugin PID is not alive, ignoring .devinfo",
			"pluginID", pluginID,
			"pid", info.PID,
		)
		// Clean up stale .devinfo.
		os.Remove(path)
		return
	}

	ew.mu.Lock()
	defer ew.mu.Unlock()

	// If we already have a connection for this plugin, disconnect first.
	if existing, ok := ew.connections[pluginID]; ok {
		ew.disconnectLocked(pluginID, existing)
	}

	// Store the connection and start health checking.
	healthCtx, healthCancel := context.WithCancel(ew.ctx)
	conn := &ExternalConnection{
		DevInfo:      info,
		Connected:    true,
		LastChecked:  time.Now(),
		cancelHealth: healthCancel,
	}
	ew.connections[pluginID] = conn

	ew.logger.Infow("external plugin connected",
		"pluginID", pluginID,
		"pid", info.PID,
		"addr", info.Addr,
		"vitePort", info.VitePort,
	)

	// Notify the manager.
	if ew.onConnect != nil {
		ew.onConnect(pluginID, info)
	}

	// Start health check loop.
	go ew.healthCheckLoop(healthCtx, pluginID, info.PID)
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

// disconnectLocked disconnects from an external plugin.
// Must be called with ew.mu held.
func (ew *ExternalWatcher) disconnectLocked(pluginID string, conn *ExternalConnection) {
	if conn.cancelHealth != nil {
		conn.cancelHealth()
	}

	conn.Connected = false
	delete(ew.connections, pluginID)

	// Notify the manager.
	if ew.onDisconnect != nil {
		ew.onDisconnect(pluginID)
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

				// Clean up the .devinfo file since the process is dead.
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
func readDevInfoFile(path string) (*DevInfoFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var info DevInfoFile
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, apperror.Wrap(err, apperror.TypeValidation, 422, "Invalid dev info")
	}

	// Basic validation.
	if info.PID <= 0 {
		return nil, apperror.New(apperror.TypeValidation, 422, "Invalid PID", fmt.Sprintf("Invalid PID: %d", info.PID))
	}
	if info.Addr == "" {
		return nil, apperror.New(apperror.TypeValidation, 422, "Invalid dev info", "Missing addr field in dev info.")
	}
	if info.Protocol == "" {
		info.Protocol = "grpc" // default
	}
	if info.ProtocolVersion == 0 {
		info.ProtocolVersion = 1 // default
	}

	return &info, nil
}

