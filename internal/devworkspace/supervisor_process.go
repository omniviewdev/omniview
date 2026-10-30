package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

var errOwnedCommandUncertain = errors.New("owned command descendant disposal is unproven")

// ownedChild retains the actual Cmd and platform lifetime handle. Unix leaders
// are not reaped until their whole owned process group is signalled; PID/PGID
// reuse therefore cannot turn host-crash cleanup into killing an unrelated tree.
type ownedChild struct {
	command     *exec.Cmd
	identity    devcontract.ProcessIdentity
	done        chan struct{}
	mu          supervisorMutex
	err         error
	finalizeErr error
	disposalErr error
	waitErr     error
	startErr    error
	finalize    func() error
	retryDone   chan struct{}
	uncaptured  bool
	// Set only after the owned tree is proven empty and the actual leader reaped.
	disposed    bool
	stopping    bool
	stopTree    func(bool) error
	signalMu    sync.Mutex
	signal      *ownedSignal
	monitorOnce sync.Once
}

// A canceled caller leaves one retained attempt, not an unowned signal worker
// per retry. The actual platform callback still owns proof against reaping.
type ownedSignal struct {
	done  chan struct{}
	force bool
	err   error
}

func (c *ownedChild) signalTree(ctx context.Context, force bool) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		c.signalMu.Lock()
		if err := ctx.Err(); err != nil {
			c.signalMu.Unlock()
			return err
		}
		attempt := c.signal
		if attempt == nil {
			attempt = &ownedSignal{done: make(chan struct{}), force: force}
			c.signal = attempt
			go func() {
				attempt.err = c.stopTree(force)
				c.signalMu.Lock()
				c.signal = nil
				close(attempt.done)
				c.signalMu.Unlock()
			}()
		}
		c.signalMu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-attempt.done:
			if force && !attempt.force {
				// A concurrent graceful attempt cannot satisfy a force request.
				continue
			}
			return attempt.err
		}
	}
}

func startOwnedChild(ctx context.Context, directory string, env []string, output io.Writer, owner devsession.ProcessOwner, finalize func() error, program string, args ...string) (*ownedChild, error) {
	command := exec.Command(program, args...)
	command.Dir = directory
	command.Env = env
	command.Stdout = output
	command.Stderr = output
	return startOwnedChildCommand(ctx, command, owner, finalize, true)
}

// The caller configures streams/cwd/env, but only this retained lifecycle may
// start, cancel, observe and dispose the command. Published services require a
// live kernel identity; finite commands retain their Cmd through disposal and
// never publish or adopt a process identity.
func startOwnedChildCommand(ctx context.Context, command *exec.Cmd, owner devsession.ProcessOwner, finalize func() error, identityRequired bool) (*ownedChild, error) {
	failed := func(err error) (*ownedChild, error) {
		if finalize != nil {
			err = errors.Join(err, finalize())
		}
		return nil, err
	}
	if command == nil {
		return failed(devcontract.Fail(2, "invalid_command", "owned command is missing"))
	}
	if command.Process != nil {
		return nil, errors.Join(errOwnedCommandUncertain, devcontract.Fail(4, "process_conflict", "cannot adopt an already started command"))
	}
	if command.Cancel != nil {
		return failed(devcontract.Fail(2, "invalid_command", "owned command cannot have a separate context cancellation owner"))
	}
	if err := ctx.Err(); err != nil {
		return failed(err)
	}
	if !identityRequired {
		if err := owner.Validate(); err != nil {
			return failed(err)
		}
	}
	switch runtime.GOOS {
	case "darwin", "linux", "windows":
	default:
		return failed(devsession.ErrUnsupportedIdentity)
	}
	prepareOwnedCommand(command)
	if err := command.Start(); err != nil {
		return failed(err)
	}
	child := &ownedChild{command: command, done: make(chan struct{}), finalize: finalize}
	var err error
	if identityRequired {
		pid := command.Process.Pid
		child.identity, err = captureExecutedProcess(ctx, launchedExecutable(command), supervisorExecutable(), execCaptureTimeout, func() (devcontract.ProcessIdentity, error) {
			return devsession.CaptureProcess(pid, owner)
		})
	}
	if err == nil {
		err = attachOwnedCommand(child)
	}
	if err != nil {
		cleanupErr := discardUncapturedCommand(child)
		if !child.disposed {
			child.startErr = err
			child.uncaptured = true
			child.disposalErr = errors.Join(errOwnedCommandUncertain, err, cleanupErr)
			child.err = child.disposalErr
			close(child.done)
			return child, child.err
		}
		return failed(errors.Join(err, cleanupErr))
	}
	go func() {
		child.complete()
		close(child.done)
	}()
	go func() {
		select {
		case <-ctx.Done():
			_ = child.stop(context.Background())
		case <-child.done:
		}
	}()
	return child, nil
}

// Bounds how long a started child may still report the supervisor's image.
const execCaptureTimeout = 5 * time.Second

var supervisorExecutable = sync.OnceValue(func() string {
	path, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return path
})

func launchedExecutable(command *exec.Cmd) string {
	path := command.Path
	if !filepath.IsAbs(path) && command.Dir != "" {
		path = filepath.Join(command.Dir, path)
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return path
}

// Start can return while the forked child still runs the supervisor's image, so
// an immediate capture may record the supervisor's executable for the child PID.
// That identity never matches the child's own report once exec completes.
// Recapture until the child stops reporting the supervisor's executable.
func captureExecutedProcess(ctx context.Context, launched, self string, timeout time.Duration, capture func() (devcontract.ProcessIdentity, error)) (devcontract.ProcessIdentity, error) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		identity, err := capture()
		if err != nil || self == "" || launched == self || identity.Executable != self {
			return identity, err
		}
		select {
		case <-ctx.Done():
			return devcontract.ProcessIdentity{}, ctx.Err()
		case <-deadline.C:
			return devcontract.ProcessIdentity{}, fmt.Errorf("%w: started child did not exec %s", devsession.ErrOwnership, launched)
		case <-time.After(5 * time.Millisecond):
		}
	}
}

// complete is called by one observer at a time. A disposal error is not an
// ordinary exit, even if it wraps an ExitError or the leader has been reaped.
func (c *ownedChild) complete() {
	c.mu.Lock()
	waitErr, disposalErr := c.waitErr, c.disposalErr
	reaped := c.command.ProcessState != nil
	c.mu.Unlock()
	if !reaped {
		if c.uncaptured {
			c.mu.Lock()
			waitErr = discardUncapturedCommand(c)
			c.mu.Unlock()
		} else {
			waitErr = waitOwnedCommand(c)
		}
	}
	c.mu.Lock()
	disposed := c.disposed
	c.mu.Unlock()
	if disposed {
		disposalErr = nil
	} else {
		disposalErr = errors.Join(errOwnedCommandUncertain, waitErr)
	}
	var finalizeErr error
	if disposalErr == nil && c.finalize != nil {
		finalizeErr = c.finalize()
	}
	c.mu.Lock()
	c.waitErr = waitErr
	c.disposalErr = disposalErr
	c.finalizeErr = finalizeErr
	c.err = errors.Join(waitErr, disposalErr, finalizeErr)
	c.mu.Unlock()
}

func (c *ownedChild) retryStop(ctx context.Context) error {
	if err := c.mu.LockContext(ctx); err != nil {
		return err
	}
	if c.disposed && c.disposalErr == nil && c.finalizeErr == nil {
		c.mu.Unlock()
		return nil
	}
	// A reaped leader cannot authorize another group signal. Keep the failed
	// ownership record rather than pretending that an unprovable disposal ended.
	if !c.disposed && c.command.ProcessState != nil {
		err := errors.Join(errOwnedCommandUncertain, c.err)
		c.mu.Unlock()
		return err
	}
	done := c.retryDone
	if done == nil {
		done = make(chan struct{})
		c.retryDone = done
		retryDisposal := c.disposalErr != nil && !c.uncaptured
		go func() {
			var stopErr error
			if retryDisposal {
				stopErr = c.signalTree(context.Background(), true)
			}
			if stopErr == nil {
				c.complete()
			} else {
				c.mu.Lock()
				c.disposalErr = errors.Join(c.disposalErr, stopErr)
				c.err = errors.Join(c.waitErr, c.disposalErr, c.finalizeErr)
				c.mu.Unlock()
			}
			c.mu.Lock()
			c.retryDone = nil
			close(done)
			c.mu.Unlock()
		}()
	}
	c.mu.Unlock()
	select {
	case <-done:
		return c.terminalStopError(ctx)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *ownedChild) stop(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := c.mu.LockContext(ctx); err != nil {
		return err
	}
	c.stopping = true
	c.mu.Unlock()
	select {
	case <-c.done:
		return c.retryStop(ctx)
	default:
	}
	// stopTree owns synchronization against reaping, including exit cleanup.
	if err := c.signalTree(ctx, false); err != nil {
		return err
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-c.done:
		return c.terminalStopError(ctx)
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
	}
	if err := c.signalTree(ctx, true); err != nil {
		return err
	}
	select {
	case <-c.done:
		return c.terminalStopError(ctx)
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (c *ownedChild) terminalStopError(ctx context.Context) error {
	if err := c.mu.LockContext(ctx); err != nil {
		return err
	}
	defer c.mu.Unlock()
	if !c.disposed {
		return errors.Join(errOwnedCommandUncertain, c.err)
	}
	if c.disposalErr != nil || c.finalizeErr != nil {
		return c.err
	}
	return nil
}
func (c *ownedChild) failure() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err != nil {
		return c.err
	}
	return fmt.Errorf("owned child exited")
}
