package devserver

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// ansiRegex matches ANSI escape sequences (colors, cursor movement, etc.).
var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

const (
	// viteReadyTimeout is how long we wait for Vite to print its "Local:" URL.
	viteReadyTimeout = 30 * time.Second

	// viteStopGracePeriod is how long we wait after SIGTERM before sending SIGKILL.
	viteStopGracePeriod = 5 * time.Second
)

// viteProcess manages a single Vite dev server child process.
type viteProcess struct {
	ctx       context.Context
	logger    *zap.SugaredLogger
	pluginID  string
	devPath   string
	port      int
	buildOpts BuildOpts

	appendLog func(LogEntry)
	setStatus func(DevProcessStatus)

	mu   sync.Mutex
	cmd  *exec.Cmd
	pgid int             // cached process group ID, set at start
	done chan struct{}   // closed when the process exits
}

// newViteProcess creates a viteProcess. Call Start() to spawn.
func newViteProcess(
	ctx context.Context,
	logger *zap.SugaredLogger,
	pluginID string,
	devPath string,
	port int,
	buildOpts BuildOpts,
	appendLog func(LogEntry),
	setStatus func(DevProcessStatus),
) *viteProcess {
	return &viteProcess{
		ctx:       ctx,
		logger:    logger.Named("vite"),
		pluginID:  pluginID,
		devPath:   devPath,
		port:      port,
		buildOpts: buildOpts,
		appendLog: appendLog,
		setStatus: setStatus,
		done:      make(chan struct{}),
	}
}

// Start spawns `pnpm run dev --port <port> --strictPort` in the plugin's ui/ directory.
// It returns once the command is spawned (not when Vite is ready).
// Ready detection happens asynchronously; the status will transition to "ready"
// when Vite's "Local:" output line is detected.
func (vp *viteProcess) Start() error {
	vp.mu.Lock()
	defer vp.mu.Unlock()

	vp.setStatus(DevProcessStatusStarting)

	uiDir := filepath.Join(vp.devPath, "ui")
	if _, err := os.Stat(uiDir); os.IsNotExist(err) {
		return apperror.New(apperror.TypeValidation, 422, "UI directory not found", fmt.Sprintf("Plugin UI directory does not exist: %s", uiDir))
	}

	// Resolve pnpm path.
	pnpmPath := vp.buildOpts.PnpmPath
	if pnpmPath == "" {
		return apperror.ConfigMissing("developer.pnpmpath", "pnpm path is not configured. Please set developer.pnpmpath in settings.")
	}

	// Install dependencies if node_modules is missing.
	nodeModules := filepath.Join(uiDir, "node_modules")
	if _, err := os.Stat(nodeModules); os.IsNotExist(err) {
		vp.appendLog(LogEntry{
			Source:  "vite",
			Level:   "info",
			Message: "node_modules not found — running pnpm install",
		})

		installCmd := exec.CommandContext(vp.ctx, pnpmPath, "install")
		installCmd.Dir = uiDir

		// Set up environment with proper PATH.
		installEnv := os.Environ()
		installDirs := []string{}
		if vp.buildOpts.PnpmPath != "" {
			installDirs = append(installDirs, filepath.Dir(vp.buildOpts.PnpmPath))
		}
		if vp.buildOpts.NodePath != "" {
			installDirs = append(installDirs, filepath.Dir(vp.buildOpts.NodePath))
		}
		installCmd.Env = prependToPath(installEnv, installDirs)

		output, err := installCmd.CombinedOutput()
		if err != nil {
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: fmt.Sprintf("pnpm install failed: %v\n%s", err, string(output)),
			})
			return apperror.Wrap(err, apperror.TypePluginBuildFailed, 500, "Failed to install UI dependencies")
		}

		vp.appendLog(LogEntry{
			Source:  "vite",
			Level:   "info",
			Message: "pnpm install completed successfully",
		})
	}

	// Build the command: pnpm run dev --port <port> --strictPort --host 127.0.0.1
	// NOTE: Do NOT use "--" separator. pnpm passes it through literally to the
	// script, and Vite's CLI parser (cac) interprets "--" as end-of-options,
	// causing --port/--host/--strictPort to be ignored. pnpm forwards
	// unrecognized flags to the script automatically.
	args := []string{
		"run", "dev",
		"--port", fmt.Sprintf("%d", vp.port),
		"--strictPort",
		"--host", "127.0.0.1",
	}

	cmd := exec.CommandContext(vp.ctx, pnpmPath, args...)
	cmd.Dir = uiDir

	// Set up environment with proper PATH including node and pnpm directories.
	env := os.Environ()
	extraDirs := []string{}
	if vp.buildOpts.PnpmPath != "" {
		extraDirs = append(extraDirs, filepath.Dir(vp.buildOpts.PnpmPath))
	}
	if vp.buildOpts.NodePath != "" {
		extraDirs = append(extraDirs, filepath.Dir(vp.buildOpts.NodePath))
	}
	env = prependToPath(env, extraDirs)
	cmd.Env = env

	// Use a process group so we can kill all child processes.
	cmd.SysProcAttr = newProcessGroupAttr()

	// Capture stdout and stderr.
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return apperror.Internal(err, "Failed to create stdout pipe")
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return apperror.Internal(err, "Failed to create stderr pipe")
	}

	if err := cmd.Start(); err != nil {
		return apperror.Wrap(err, apperror.TypePluginBuildFailed, 500, "Failed to start Vite dev server")
	}

	vp.cmd = cmd

	// Cache the process group ID immediately so it survives process death.
	vp.pgid = getProcessGroupID(cmd.Process.Pid)
	if vp.pgid == 0 {
		vp.pgid = cmd.Process.Pid // fallback
	}

	// Override the default context-cancel behavior (which only kills the lead PID)
	// to kill the entire process group. Go 1.20+ calls cmd.Cancel instead of
	// cmd.Process.Kill() when the context is cancelled.
	cmd.Cancel = func() error {
		return killProcessGroup(vp.pgid)
	}

	vp.logger.Infow("vite process spawned", "pid", cmd.Process.Pid, "pgid", vp.pgid, "port", vp.port)

	vp.appendLog(LogEntry{
		Source:  "vite",
		Level:   "info",
		Message: fmt.Sprintf("Vite dev server starting on port %d (pid %d)", vp.port, cmd.Process.Pid),
	})

	// Channel to signal when the "ready" line is detected.
	readyCh := make(chan struct{}, 1)

	// Pipe stdout, scanning for the ready signal.
	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		for scanner.Scan() {
			line := ansiRegex.ReplaceAllString(scanner.Text(), "")
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "info",
				Message: line,
			})

			// Vite prints something like:
			//   ➜  Local:   http://127.0.0.1:15173/
			// We detect readiness by finding "Local:" in the output.
			if strings.Contains(line, "Local:") && strings.Contains(line, fmt.Sprintf("%d", vp.port)) {
				select {
				case readyCh <- struct{}{}:
				default:
				}
			}
		}
		if err := scanner.Err(); err != nil {
			vp.logger.Warnw("vite stdout scanner error", "error", err)
		}
	}()

	// Pipe stderr.
	go func() {
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			line := ansiRegex.ReplaceAllString(scanner.Text(), "")
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: line,
			})
		}
	}()

	// Wait for the process to exit in a goroutine.
	go func() {
		err := cmd.Wait()
		if err != nil {
			vp.logger.Warnw("vite process exited with error", "error", err)
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: fmt.Sprintf("Vite process exited: %v", err),
			})
		} else {
			vp.logger.Info("vite process exited cleanly")
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "info",
				Message: "Vite process exited",
			})
		}
		close(vp.done)
	}()

	// Wait for the "ready" signal or timeout.
	go func() {
		select {
		case <-readyCh:
			vp.setStatus(DevProcessStatusReady)
			vp.logger.Infow("vite dev server is ready", "port", vp.port)
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "info",
				Message: fmt.Sprintf("Vite dev server ready at http://127.0.0.1:%d", vp.port),
			})
		case <-time.After(viteReadyTimeout):
			vp.setStatus(DevProcessStatusError)
			vp.logger.Errorw("vite dev server did not become ready in time", "timeout", viteReadyTimeout)
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: fmt.Sprintf("Vite did not become ready within %s", viteReadyTimeout),
			})
		case <-vp.done:
			// Process exited before ready.
			vp.setStatus(DevProcessStatusError)
		case <-vp.ctx.Done():
			// Context cancelled.
			return
		}
	}()

	return nil
}

// PGID returns the cached process group ID of the Vite process, or 0 if not started.
func (vp *viteProcess) PGID() int {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	return vp.pgid
}

// Stop sends SIGTERM to the Vite process group, waits up to viteStopGracePeriod,
// then sends SIGKILL if it's still running. Uses the cached PGID so it works
// even if the lead process has already exited.
func (vp *viteProcess) Stop() {
	vp.mu.Lock()
	cmd := vp.cmd
	pgid := vp.pgid
	vp.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return
	}

	vp.logger.Info("stopping vite process")

	// Send SIGTERM (or equivalent) to the process group.
	if pgid > 0 {
		_ = termProcessGroup(pgid)
	} else {
		_ = termProcess(cmd.Process)
	}

	// Wait for exit or timeout.
	select {
	case <-vp.done:
		vp.logger.Info("vite process stopped after SIGTERM")
		return
	case <-time.After(viteStopGracePeriod):
		vp.logger.Warn("vite process did not stop after SIGTERM; sending SIGKILL")
		if pgid > 0 {
			_ = killProcessGroup(pgid)
		} else {
			_ = cmd.Process.Kill()
		}
	}

	// Wait for final exit after SIGKILL.
	select {
	case <-vp.done:
		vp.logger.Info("vite process stopped after SIGKILL")
	case <-time.After(3 * time.Second):
		vp.logger.Error("vite process did not exit after SIGKILL; giving up")
	}
}

// prependToPath adds directories to the front of the PATH environment variable.
func prependToPath(env []string, dirs []string) []string {
	if len(dirs) == 0 {
		return env
	}
	prefix := strings.Join(dirs, string(os.PathListSeparator))

	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			current := strings.TrimPrefix(e, "PATH=")
			env[i] = "PATH=" + prefix + string(os.PathListSeparator) + current
			return env
		}
	}
	// PATH not found; add it.
	return append(env, "PATH="+prefix)
}
