package devserver

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

const (
	PortRangeStart = 15173
	PortRangeEnd   = 15273
)

// PortAllocator manages port allocation for Vite dev servers.
// It tracks which ports are currently in use and finds free ones.
type PortAllocator struct {
	mu       sync.Mutex
	assigned map[int]string // port -> pluginID
	pids     map[int]int    // port -> process group ID (for cleanup)
}

// NewPortAllocator creates a new PortAllocator.
func NewPortAllocator() *PortAllocator {
	return &PortAllocator{
		assigned: make(map[int]string),
		pids:     make(map[int]int),
	}
}

// Allocate finds a free port in the range [PortRangeStart, PortRangeEnd) and
// reserves it for the given pluginID. Returns the port number or an error if
// no port is available.
func (pa *PortAllocator) Allocate(pluginID string) (int, error) {
	pa.mu.Lock()
	defer pa.mu.Unlock()

	for port := PortRangeStart; port < PortRangeEnd; port++ {
		if _, taken := pa.assigned[port]; taken {
			continue
		}

		if !isPortFree(port) {
			continue
		}

		pa.assigned[port] = pluginID
		return port, nil
	}

	return 0, apperror.New(apperror.TypeInternal, 500, "No free port available", fmt.Sprintf("No free port available in range %d-%d.", PortRangeStart, PortRangeEnd))
}

// RecordPID associates a process group ID with an allocated port so it can be
// killed during stale process cleanup on next startup.
func (pa *PortAllocator) RecordPID(port, pgid int) {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	pa.pids[port] = pgid
}

// Release frees a previously allocated port.
func (pa *PortAllocator) Release(port int) {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	delete(pa.assigned, port)
	delete(pa.pids, port)
}

// ReleaseByPlugin frees the port allocated to the given plugin ID, if any.
// Returns the port that was released, or 0 if no port was allocated.
func (pa *PortAllocator) ReleaseByPlugin(pluginID string) int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	for port, id := range pa.assigned {
		if id == pluginID {
			delete(pa.assigned, port)
			delete(pa.pids, port)
			return port
		}
	}
	return 0
}

// GetPort returns the port assigned to a plugin, or 0 if none.
func (pa *PortAllocator) GetPort(pluginID string) int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	for port, id := range pa.assigned {
		if id == pluginID {
			return port
		}
	}
	return 0
}

// pidFilePath returns the path to the PID tracking file.
func pidFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".omniview", "devserver_pids.json")
}

// SavePIDs persists the current port→PGID map to disk so stale processes
// can be cleaned up after an unclean shutdown.
func (pa *PortAllocator) SavePIDs() {
	pa.mu.Lock()
	data := make(map[string]int, len(pa.pids))
	for port, pgid := range pa.pids {
		data[fmt.Sprintf("%d", port)] = pgid
	}
	pa.mu.Unlock()

	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	_ = os.WriteFile(pidFilePath(), b, 0644)
}

// CleanupStaleProcesses kills zombie Vite dev server process groups left over
// from a previous unclean shutdown. It reads the PID file written by SavePIDs,
// kills each recorded process group, and removes the file.
func (pa *PortAllocator) CleanupStaleProcesses(logger *zap.SugaredLogger) {
	pidFile := pidFilePath()
	b, err := os.ReadFile(pidFile)
	if err != nil {
		// No PID file — nothing to clean up.
		return
	}
	_ = os.Remove(pidFile)

	var data map[string]int
	if err := json.Unmarshal(b, &data); err != nil {
		logger.Warnw("failed to parse devserver PID file", "error", err)
		return
	}

	killed := 0
	for portStr, pgid := range data {
		if pgid <= 0 {
			continue
		}

		// Kill the entire process group (negative PID = process group).
		if err := syscall.Kill(-pgid, syscall.SIGKILL); err != nil {
			// ESRCH = no such process — already dead, that's fine.
			if err != syscall.ESRCH {
				logger.Warnw("failed to kill stale dev server process group",
					"port", portStr,
					"pgid", pgid,
					"error", err,
				)
			}
			continue
		}

		logger.Infow("killed stale dev server process group",
			"port", portStr,
			"pgid", pgid,
		)
		killed++
	}

	if killed > 0 {
		logger.Infow("cleaned up stale dev server processes", "count", killed)
	}
}

// isPortFree checks if a TCP port is available by attempting to listen on it.
func isPortFree(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	ln.Close()
	return true
}
