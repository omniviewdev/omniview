package devserver

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// ansiRegex matches ANSI escape sequences (colors, cursor movement, etc.).
var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

var viteHTTPClient = &http.Client{Timeout: time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

const (
	// viteReadyTimeout is how long we wait for Vite to print its "Local:" URL.
	viteReadyTimeout = 30 * time.Second

	// viteStopGracePeriod is how long we wait after SIGTERM before sending SIGKILL.
	viteStopGracePeriod = 5 * time.Second

	// viteKillWaitPeriod is how long we wait for the process to exit after SIGKILL.
	viteKillWaitPeriod = 3 * time.Second
)

// viteProcess manages a single Vite dev server child process.
type viteProcess struct {
	ctx       context.Context
	logger    logging.Logger
	pluginID  string
	devPath   string
	port      int
	buildOpts BuildOpts

	appendLog func(LogEntry)
	setStatus func(DevProcessStatus)

	mu                     sync.Mutex
	cmd                    *exec.Cmd
	pgid                   int           // cached process group ID, set at start
	done                   chan struct{} // closed when the process exits
	readyDone              chan struct{}
	readyErr               error
	signalMu               sync.Mutex
	reaping                bool
	treeKilled             bool
	cleanupErr             error
	remote                 *devsession.RemoteProcess
	remoteStartUnconfirmed bool
	remoteLogsDone         <-chan struct{}
	doneOnce               sync.Once
	observationError       chan error
	observationErr         error
	outputWriter           *devoutputs.Writer
}

// newViteProcess creates a viteProcess. Call Start() to spawn.
func newViteProcess(
	ctx context.Context,
	logger logging.Logger,
	pluginID string,
	devPath string,
	port int,
	buildOpts BuildOpts,
	appendLog func(LogEntry),
	setStatus func(DevProcessStatus),
) *viteProcess {
	return &viteProcess{
		ctx:              ctx,
		logger:           logger.Named("vite"),
		pluginID:         pluginID,
		devPath:          devPath,
		port:             port,
		buildOpts:        buildOpts,
		appendLog:        appendLog,
		setStatus:        setStatus,
		mu:               sync.Mutex{},
		cmd:              nil,
		pgid:             0,
		done:             make(chan struct{}),
		readyDone:        make(chan struct{}),
		observationError: make(chan error, 1),
	}
}

// Start spawns `pnpm run dev --port <port> --strictPort` in the plugin's ui/ directory.
// It returns once the command is spawned (not when Vite is ready).
// Ready detection happens asynchronously; the status will transition to "ready"
// when Vite's "Local:" output line is detected.
func (vp *viteProcess) Start() error {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	if err := vp.ctx.Err(); err != nil {
		return err
	}

	vp.setStatus(DevProcessStatusStarting)

	uiDir := filepath.Join(vp.devPath, "ui")
	if _, err := os.Stat(uiDir); os.IsNotExist(err) {
		return apperror.New(
			apperror.TypeValidation,
			http.StatusUnprocessableEntity,
			"UI directory not found",
			"Plugin UI directory does not exist: "+uiDir,
		)
	}
	var compositionRoot string
	if vp.buildOpts.Workspace != nil {
		composition, err := devcompose.Installed(*vp.buildOpts.Workspace, uiDir)
		if err != nil {
			return fmt.Errorf("managed UI requires a complete installed feature composition; stop and reconfigure the workspace: %w", err)
		}
		compositionRoot = composition.Root
	}
	if vp.buildOpts.ProcessSupervisor != nil {
		return vp.startRemote(uiDir)
	}

	pnpmPath, err := resolveTool(vp.buildOpts.PnpmPath, "pnpm")
	if err != nil {
		return err
	}
	if _, err = resolveTool(vp.buildOpts.NodePath, "node"); err != nil {
		return err
	}

	// Standalone development retains its ordinary install behavior. Managed
	// plugins consume the supervisor's completed aggregate transaction only.
	if vp.buildOpts.Workspace == nil {
		if err := vp.installDepsIfMissing(uiDir, pnpmPath); err != nil {
			return err
		}
	}

	// Build the command: pnpm run dev --port <port> --strictPort --host 127.0.0.1
	// NOTE: Do NOT use "--" separator. pnpm passes it through literally to the
	// script, and Vite's CLI parser (cac) interprets "--" as end-of-options,
	// causing --port/--host/--strictPort to be ignored. pnpm forwards
	// unrecognized flags to the script automatically.
	args := []string{
		"run", "dev",
		"--port", strconv.Itoa(vp.port),
		"--strictPort",
		"--host", "127.0.0.1",
	}
	if len(vp.buildOpts.PnpmArgs) > 0 {
		combined := make([]string, len(vp.buildOpts.PnpmArgs)+len(args))
		copy(combined, vp.buildOpts.PnpmArgs)
		copy(combined[len(vp.buildOpts.PnpmArgs):], args)
		args = combined
	}

	if err := vp.ctx.Err(); err != nil {
		return err
	}
	// The supervisor is the sole reaper; exec's context watcher must not kill
	// and reap only the pnpm leader before descendant cleanup completes.
	cmd := exec.Command(pnpmPath, args...)
	cmd.Dir = uiDir

	// Set up environment with proper PATH including node and pnpm directories.
	env := append([]string(nil), vp.buildOpts.Environment...)
	if env == nil {
		env = os.Environ()
	}
	env = goBuildEnv(env)
	if compositionRoot != "" {
		env = compositionEnvironment(env, compositionRoot)
		if vp.buildOpts.ExplicitNodePath != "" {
			selectedNode, err := resolveTool(vp.buildOpts.ExplicitNodePath, "node")
			if err != nil {
				return err
			}
			env = append(env, "OMNIVIEW_PNPM_NODE_PATH="+selectedNode)
		}
	}
	env = append(env, "OMNIVIEW_VITE_PORT="+strconv.Itoa(vp.port))
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
	if vp.buildOpts.Workspace != nil {
		vp.outputWriter, err = devoutputs.BeginVite(vp.ctx, *vp.buildOpts.Workspace, uiDir)
		if err != nil {
			return err
		}
		cmd.Env = append(cmd.Env, vp.outputWriter.Environment...)
	}

	if err = cmd.Start(); err != nil {
		return apperror.Wrap(
			errors.Join(err, vp.finishViteOutputs(true)), apperror.TypePluginBuildFailed, http.StatusInternalServerError, "Failed to start Vite dev server",
		)
	}

	vp.cmd = cmd
	vp.pgid = cmd.Process.Pid // newProcessGroupAttr makes this owned child's group
	go func() {
		select {
		case <-vp.ctx.Done():
			if err := vp.signalOwnedTree(true); err != nil {
				vp.logger.Errorw(context.Background(), "cancel owned Vite tree", "error", err)
			}
		case <-vp.done:
		}
	}()
	if vp.buildOpts.ViteStarted != nil {
		var identity devcontract.ProcessIdentity
		if vp.buildOpts.ViteOwner.WorkspaceID != "" {
			identity, err = devsession.CaptureProcess(cmd.Process.Pid, vp.buildOpts.ViteOwner)
		}
		if err == nil {
			err = vp.buildOpts.ViteStarted(identity)
		}
		if err != nil {
			stopErr := vp.signalOwnedTree(true)
			vp.signalMu.Lock()
			vp.reaping = true
			vp.signalMu.Unlock()
			_ = cmd.Wait()
			outputErr := vp.finishViteOutputs(false)
			close(vp.done)
			return errors.Join(fmt.Errorf("capture managed Vite ownership: %w", err), stopErr, outputErr)
		}
	}

	vp.logger.Infow(context.Background(), "vite process spawned", "pid", cmd.Process.Pid, "pgid", vp.pgid, "port", vp.port)

	vp.appendLog(newLogEntry(
		logSourceVite, logLevelInfo,
		fmt.Sprintf("Vite dev server starting on port %d (pid %d)", vp.port, cmd.Process.Pid),
	))

	// Channel to signal when the "ready" line is detected.
	readyCh := make(chan struct{}, 1)

	// Pipe stdout, scanning for the ready signal.
	go vp.pipeStdout(stdoutPipe, readyCh)

	// Pipe stderr.
	go vp.pipeStderr(stderrPipe)

	// Wait for the process to exit in a goroutine.
	go vp.waitForExit(cmd)

	// Wait for the "ready" signal or timeout.
	go vp.awaitReady(readyCh)

	return nil
}

// installDepsIfMissing runs `pnpm install` in uiDir when node_modules is missing.
func (vp *viteProcess) installDepsIfMissing(uiDir, pnpmPath string) error {
	nodeModules := filepath.Join(uiDir, "node_modules")
	if _, statErr := os.Stat(nodeModules); !os.IsNotExist(statErr) {
		return nil
	}
	vp.appendLog(newLogEntry(logSourceVite, logLevelInfo, "node_modules not found — running pnpm install"))

	taskArgs := []string{"install"}
	installArgs := make([]string, len(vp.buildOpts.PnpmArgs)+len(taskArgs))
	copy(installArgs, vp.buildOpts.PnpmArgs)
	copy(installArgs[len(vp.buildOpts.PnpmArgs):], taskArgs)
	installCmd := exec.CommandContext(vp.ctx, pnpmPath, installArgs...)
	installCmd.Dir = uiDir

	// Set up environment with proper PATH.
	installEnv := append([]string(nil), vp.buildOpts.Environment...)
	if installEnv == nil {
		installEnv = os.Environ()
	}
	installEnv = goBuildEnv(installEnv)
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
		vp.appendLog(newLogEntry(
			logSourceVite, logLevelError, fmt.Sprintf("pnpm install failed: %v\n%s", err, string(output)),
		))
		return apperror.Wrap(
			err, apperror.TypePluginBuildFailed, http.StatusInternalServerError, "Failed to install UI dependencies",
		)
	}

	vp.appendLog(newLogEntry(logSourceVite, logLevelInfo, "pnpm install completed successfully"))
	return nil
}

// pipeStdout forwards Vite's stdout to the log and signals readyCh once the
// "Local:" URL line is seen.
func (vp *viteProcess) pipeStdout(stdoutPipe io.Reader, readyCh chan<- struct{}) {
	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		line := ansiRegex.ReplaceAllString(scanner.Text(), "")
		vp.appendLog(newLogEntry(logSourceVite, logLevelInfo, line))

		// Vite prints something like:
		//   ➜  Local:   http://127.0.0.1:15173/
		// We detect readiness by finding "Local:" in the output.
		if strings.Contains(line, "Local:") && strings.Contains(line, fmt.Sprintf("http://127.0.0.1:%d/", vp.port)) {
			select {
			case readyCh <- struct{}{}:
			default:
			}
		}
	}
	if err := scanner.Err(); err != nil {
		vp.logger.Warnw(context.Background(), "vite stdout scanner error", "error", err)
	}
}

// pipeStderr forwards Vite's stderr to the log.
func (vp *viteProcess) pipeStderr(stderrPipe io.Reader) {
	scanner := bufio.NewScanner(stderrPipe)
	for scanner.Scan() {
		line := ansiRegex.ReplaceAllString(scanner.Text(), "")
		vp.appendLog(newLogEntry(logSourceVite, logLevelError, line))
	}
}

// waitForExit waits for the Vite process to exit, logs the outcome and closes vp.done.
func (vp *viteProcess) waitForExit(cmd *exec.Cmd) {
	// Observe exit without reaping, then kill any descendants while the owned
	// leader's unreaped identity still pins its group against numeric reuse.
	observationErr := awaitOwnedExit(cmd.Process.Pid)
	vp.signalMu.Lock()
	if !vp.treeKilled {
		if canSignalUnreapedGroup {
			err := normalizeOwnedGroupError(killProcessGroup(vp.pgid))
			if err != nil {
				err = fmt.Errorf("dispose owned Vite group before reaping: %w", err)
			}
			vp.cleanupErr = errors.Join(vp.cleanupErr, err)
			if err == nil {
				vp.treeKilled = true
			}
		} else {
			// A terminated Windows leader is not authority for numeric taskkill.
			vp.cleanupErr = errors.Join(vp.cleanupErr, fmt.Errorf("owned Vite leader exited before tree cleanup could be confirmed"))
		}
	}
	vp.cleanupErr = errors.Join(vp.cleanupErr, observationErr)
	vp.reaping = true
	vp.signalMu.Unlock()
	err := cmd.Wait()
	_ = vp.finishViteOutputs(false)
	if err != nil {
		vp.logger.Warnw(context.Background(), "vite process exited with error", "error", err)
		vp.appendLog(newLogEntry(logSourceVite, logLevelError, fmt.Sprintf("Vite process exited: %v", err)))
	} else {
		vp.logger.Infow(context.Background(), "vite process exited cleanly")
		vp.appendLog(newLogEntry(logSourceVite, logLevelInfo, "Vite process exited"))
	}
	vp.setStatus(DevProcessStatusError)
	close(vp.done)
}

// awaitReady sets the status once Vite is ready, times out, exits or the context is cancelled.
func (vp *viteProcess) awaitReady(advertised <-chan struct{}) {
	deadline := time.NewTimer(viteReadyTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	hasAdvertisement := false
	finish := func(err error) {
		if err == nil && vp.buildOpts.Workspace != nil {
			_, err = devcompose.Installed(*vp.buildOpts.Workspace, filepath.Join(vp.devPath, "ui"))
			if err != nil {
				err = fmt.Errorf("managed composition changed before Vite readiness; stop and reconfigure the workspace: %w", err)
			}
		}
		vp.mu.Lock()
		if err == nil {
			err = vp.observationErr
		}
		vp.readyErr = err
		if err != nil {
			vp.setStatus(DevProcessStatusError)
		} else {
			vp.setStatus(DevProcessStatusReady)
		}
		vp.mu.Unlock()
		close(vp.readyDone)
	}
	for {
		select {
		case <-advertised:
			hasAdvertisement = true
			advertised = nil
		case err := <-vp.observationError:
			finish(err)
			return
		case <-vp.ctx.Done():
			finish(vp.ctx.Err())
			return
		case <-vp.done:
			finish(fmt.Errorf("Vite exited before HTTP readiness"))
			return
		case <-deadline.C:
			finish(fmt.Errorf("Vite HTTP endpoint unavailable after %s", viteReadyTimeout))
			return
		case <-ticker.C:
			if !hasAdvertisement {
				continue
			}
			ctx, cancel := context.WithTimeout(vp.ctx, time.Second)
			err := probeVite(ctx, fmt.Sprintf("http://127.0.0.1:%d", vp.port))
			cancel()
			if err == nil {
				select {
				case <-vp.done:
					finish(fmt.Errorf("Vite exited during HTTP readiness"))
				default:
					finish(nil)
				}
				return
			}
		}
	}
}

// PGID returns the cached process group ID of the Vite process, or 0 if not started.
func (vp *viteProcess) PGID() int {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	return vp.pgid
}

// Stop signals only the live child owned by this Cmd, never a persisted or
// already-exited numeric process group.
func (vp *viteProcess) Stop() error {
	vp.mu.Lock()
	cmd := vp.cmd
	remote := vp.remote
	unconfirmed := vp.remoteStartUnconfirmed
	vp.mu.Unlock()
	if remote != nil {
		return vp.stopRemote(remote)
	}
	if unconfirmed {
		return fmt.Errorf("managed process start is unconfirmed; retained supervisor ownership must be resolved before releasing its lease")
	}
	if cmd == nil || cmd.Process == nil {
		return vp.stopResult()
	}
	select {
	case <-vp.done:
		return vp.stopResult()
	default:
	}
	if err := vp.signalOwnedTree(false); err != nil {
		if forceErr := vp.signalOwnedTree(true); forceErr != nil {
			return errors.Join(err, forceErr)
		}
	}
	select {
	case <-vp.done:
		return vp.stopResult()
	case <-time.After(viteStopGracePeriod):
		if err := vp.signalOwnedTree(true); err != nil {
			return err
		}
	}
	select {
	case <-vp.done:
		return vp.stopResult()
	case <-time.After(viteKillWaitPeriod):
		return fmt.Errorf("owned Vite process did not exit after termination")
	}
}

// signalOwnedTree holds the sole-reaper gate across the signal. No code may
// signal a cached group once this supervisor begins Cmd.Wait.
func (vp *viteProcess) signalOwnedTree(force bool) error {
	vp.signalMu.Lock()
	defer vp.signalMu.Unlock()
	if vp.reaping || vp.treeKilled {
		return vp.cleanupErr
	}
	if vp.cmd == nil || vp.cmd.Process == nil || vp.pgid <= 0 {
		return fmt.Errorf("owned Vite process group unavailable")
	}
	var err error
	if force {
		err = killProcessGroup(vp.pgid)
	} else {
		err = termProcessGroup(vp.pgid)
	}
	err = normalizeOwnedGroupError(err)
	if err != nil {
		err = fmt.Errorf("signal owned Vite group (force=%t): %w", force, err)
	}
	if err == nil && (force || termStopsOwnedTree) {
		vp.treeKilled = true
		vp.cleanupErr = nil
	}
	if err != nil && force {
		vp.cleanupErr = err
	}
	return err
}

func (vp *viteProcess) stopResult() error {
	vp.signalMu.Lock()
	defer vp.signalMu.Unlock()
	return vp.cleanupErr
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

func (vp *viteProcess) PID() int {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	if vp.remote != nil {
		return vp.remote.Identity().PID
	}
	if vp.cmd == nil || vp.cmd.Process == nil {
		return 0
	}
	return vp.cmd.Process.Pid
}

func (vp *viteProcess) WaitReady() error {
	select {
	case <-vp.ctx.Done():
		return vp.ctx.Err()
	case <-vp.readyDone:
	}
	vp.mu.Lock()
	defer vp.mu.Unlock()
	return vp.readyErr
}

func probeVite(ctx context.Context, endpoint string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/@vite/client", nil)
	if err != nil {
		return err
	}
	response, err := viteHTTPClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Content-Type"), "javascript") {
		return fmt.Errorf("Vite client endpoint returned %s (%s)", response.Status, response.Header.Get("Content-Type"))
	}
	count, err := io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("Vite client endpoint returned empty JavaScript")
	}
	return nil
}

func resolveTool(configured, name string) (string, error) {
	if configured == "" {
		configured = name
	}
	path, err := exec.LookPath(configured)
	if err != nil {
		return "", fmt.Errorf("resolve %s tool %q: %w", name, configured, err)
	}
	return path, nil
}

// finishViteOutputs is called only by the sole actual Cmd reaper, or after
// Start failed without creating a process. Failed descendant cleanup must leave
// the writer open rather than claiming a stable output snapshot.
func (vp *viteProcess) finishViteOutputs(noProcess bool) error {
	if vp.outputWriter == nil {
		return nil
	}
	vp.signalMu.Lock()
	canFinish := noProcess || (vp.treeKilled && vp.reaping && vp.cmd != nil && vp.cmd.ProcessState != nil)
	vp.signalMu.Unlock()
	var err error
	if canFinish {
		err = vp.outputWriter.Finish(context.WithoutCancel(vp.ctx))
	} else {
		err = fmt.Errorf("owned Vite output writer retained because descendant exit is unconfirmed")
	}
	if err != nil {
		err = fmt.Errorf("finish owned Vite outputs: %w", err)
		vp.signalMu.Lock()
		vp.cleanupErr = errors.Join(vp.cleanupErr, err)
		vp.signalMu.Unlock()
	}
	return err
}
