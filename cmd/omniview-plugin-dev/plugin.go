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

	// Read the handshake line from stdout.
	// Format: CORE-PROTOCOL-VERSION|APP-PROTOCOL-VERSION|NETWORK-TYPE|NETWORK-ADDR|PROTOCOL
	handshakeCh := make(chan string, 1)

	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		handshakeSent := false
		for scanner.Scan() {
			line := scanner.Text()

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

	// Wait for handshake.
	select {
	case handshake := <-handshakeCh:
		if handshake == "" {
			_ = cmd.Process.Kill()
			return nil, fmt.Errorf("plugin exited without handshake")
		}
		parts := strings.Split(strings.TrimSpace(handshake), "|")
		if len(parts) >= 4 {
			pp.Addr = parts[3]
		}
		log.System("Handshake: %s", strings.TrimSpace(handshake))

	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("timeout waiting for plugin handshake (30s)")

	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return nil, ctx.Err()
	}

	// Monitor the process in the background.
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

	_ = pp.cmd.Process.Signal(syscall.SIGTERM)

	done := make(chan error, 1)
	go func() {
		done <- pp.cmd.Wait()
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = pp.cmd.Process.Kill()
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
	return parts[0] == "1"
}
