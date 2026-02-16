package networker

import (
	"fmt"
	"net"
	"strconv"
)

// FindFreePort finds an available port by letting the OS pick a free port.
func FindFreeTCPPort() (int32, error) {
	lis, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		return 0, fmt.Errorf("error listening on a port: %w", err)
	}
	defer lis.Close()

	addr := lis.Addr().String()
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return 0, fmt.Errorf("error splitting host and port: %w", err)
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		return 0, fmt.Errorf("error converting port string to int: %w", err)
	}

	return int32(port), nil
}

// IsPortUnavailable checks if a port is unavailable (i.e., in use).
func IsPortUnavailable(port int32) bool {
	conn, err := net.Dial("tcp", fmt.Sprintf("localhost:%d", port))
	if err != nil {
		return false // The port is not in use, hence available.
	}
	conn.Close()
	return true // The port is in use, hence unavailable.
}
