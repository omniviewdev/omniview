package devserver

import (
	"fmt"
	"net"
	"sync"
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
}

// NewPortAllocator creates a new PortAllocator.
func NewPortAllocator() *PortAllocator {
	return &PortAllocator{
		assigned: make(map[int]string),
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

	return 0, fmt.Errorf("no free port available in range %d-%d", PortRangeStart, PortRangeEnd)
}

// Release frees a previously allocated port.
func (pa *PortAllocator) Release(port int) {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	delete(pa.assigned, port)
}

// ReleaseByPlugin frees the port allocated to the given plugin ID, if any.
// Returns the port that was released, or 0 if no port was allocated.
func (pa *PortAllocator) ReleaseByPlugin(pluginID string) int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	for port, id := range pa.assigned {
		if id == pluginID {
			delete(pa.assigned, port)
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
