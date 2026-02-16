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
	"sync"
	"syscall"
	"time"
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

	// Find pnpm.
	pnpmPath, err := exec.LookPath("pnpm")
	if err != nil {
		return nil, fmt.Errorf("pnpm not found in PATH: %w", err)
	}

	args := []string{"exec", "vite", "--port", strconv.Itoa(preferredPort)}

	cmd := exec.CommandContext(ctx, pnpmPath, args...)
	cmd.Dir = uiDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("PORT=%d", preferredPort),
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
		return nil, fmt.Errorf("failed to start vite: %w", err)
	}

	vp := &ViteProcess{cmd: cmd}

	// Parse stdout for the port.
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

	// Wait for port detection.
	select {
	case port := <-portCh:
		if port == 0 {
			_ = cmd.Process.Kill()
			return nil, fmt.Errorf("failed to detect Vite port from output")
		}
		vp.Port = port
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return nil, ctx.Err()
	}

	return vp, nil
}

// Stop kills the Vite process.
func (vp *ViteProcess) Stop() {
	vp.mu.Lock()
	defer vp.mu.Unlock()

	if vp.cmd == nil || vp.cmd.Process == nil {
		return
	}

	_ = vp.cmd.Process.Signal(syscall.SIGTERM)
	done := make(chan error, 1)
	go func() { done <- vp.cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = vp.cmd.Process.Kill()
	}
}
