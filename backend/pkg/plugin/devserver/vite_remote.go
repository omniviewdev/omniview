package devserver

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// startRemote is called with vp.mu held. The outer supervisor owns the real
// Cmd/group; the host holds only its authenticated identity-bearing handle.
func (vp *viteProcess) startRemote(uiDir string) error {
	if vp.buildOpts.Workspace == nil {
		return fmt.Errorf("process supervisor requires a resolved workspace")
	}
	if vp.buildOpts.Generation == "" {
		return fmt.Errorf("managed frontend generation is required")
	}
	if err := vp.ctx.Err(); err != nil {
		return err
	}
	process, err := vp.startRemoteTask("dev", vp.port)
	if err != nil {
		return err
	}
	vp.remote = process
	if vp.buildOpts.ViteStarted != nil {
		if err = vp.buildOpts.ViteStarted(process.Identity()); err != nil {
			stopErr := vp.stopRemote(process)
			return errors.Join(fmt.Errorf("record retained Vite ownership: %w", err), stopErr)
		}
	}
	vp.appendLog(newLogEntry(logSourceVite, logLevelInfo, fmt.Sprintf("Retained Vite process starting on port %d (pid %d)", vp.port, process.Identity().PID)))
	ready := make(chan struct{}, 1)
	logsDone := make(chan struct{})
	vp.remoteLogsDone = logsDone
	go func() {
		defer close(logsDone)
		if err := vp.streamRemoteLogs(context.Background(), process, ready); err != nil {
			vp.remoteObservationFailed(err)
		}
	}()
	go func() {
		err := process.Wait(context.Background())
		if !confirmedRemoteExit(err) {
			vp.remoteObservationFailed(err)
			return
		}
		vp.finishRemoteExit(err)
	}()
	go func() {
		select {
		case <-vp.ctx.Done():
			if err := vp.stopRemote(process); err != nil {
				vp.remoteObservationFailed(err)
			}
		case <-vp.done:
		}
	}()
	go vp.awaitReady(ready)
	return nil
}

func (vp *viteProcess) startRemoteTask(kind string, port int) (*devsession.RemoteProcess, error) {
	request := devsession.ProcessStart{PluginID: vp.pluginID, PluginGeneration: vp.buildOpts.Generation, Kind: kind, Source: vp.devPath, Port: port}
	var err error
	// Only explicit canonical provider settings cross this boundary. The default
	// Node/pnpm prefix is independently selected from the supervisor's graph.
	if vp.buildOpts.ExplicitPnpmPath != "" {
		request.PNPMPath, err = resolveTool(vp.buildOpts.ExplicitPnpmPath, "pnpm")
		if err != nil {
			return nil, err
		}
	}
	if vp.buildOpts.ExplicitNodePath != "" {
		request.NodePath, err = resolveTool(vp.buildOpts.ExplicitNodePath, "node")
		if err != nil {
			return nil, err
		}
	}
	vp.remoteStartUnconfirmed = true
	// Cancelling a build must not discard an accepted Start response/handle. Once
	// the bounded start finishes, the ordinary context watcher stops its real Cmd.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	process, err := vp.buildOpts.ProcessSupervisor.Start(ctx, request)
	if err != nil {
		var failure *devcontract.Error
		if errors.As(err, &failure) {
			switch failure.Code {
			case "unauthorized", "invalid_request", "invalid_process_source", "invalid_process_port", "invalid_process_override", "composition_not_installed", "process_start_failed":
				vp.remoteStartUnconfirmed = false
			}
		}
		return nil, err
	}
	vp.remoteStartUnconfirmed = false
	return process, nil
}

func confirmedRemoteExit(err error) bool {
	if err == nil {
		return true
	}
	var exit *devsession.ProcessExitError
	return errors.As(err, &exit)
}

// streamRemoteLogs feeds actual bounded supervisor output through the same Vite
// advertisement parser as local stdout. Lost output is an error, never readiness.
func (vp *viteProcess) streamRemoteLogs(ctx context.Context, process *devsession.RemoteProcess, ready chan<- struct{}) error {
	reader, writer := io.Pipe()
	result := make(chan error, 1)
	go func() { err := copyRemoteLogs(ctx, process, writer); _ = writer.CloseWithError(err); result <- err }()
	vp.pipeStdout(reader, ready)
	_ = reader.Close()
	return <-result
}

func copyRemoteLogs(ctx context.Context, process *devsession.RemoteProcess, writer io.Writer) error {
	var cursor int64
	for {
		requestCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		page, err := process.Logs(requestCtx, cursor, 64<<10)
		cancel()
		if err != nil {
			return err
		}
		if page.Overflow {
			return fmt.Errorf("retained frontend output overflowed; restart to obtain complete readiness evidence")
		}
		if page.NextCursor < cursor || (page.Data != "" && page.NextCursor == cursor) || (page.Data == "" && page.NextCursor != cursor) {
			return fmt.Errorf("retained frontend output cursor is invalid")
		}
		if page.Data != "" {
			if _, err = io.WriteString(writer, page.Data); err != nil {
				return err
			}
		}
		cursor = page.NextCursor
		if page.EOF {
			return nil
		}
		if page.Data != "" {
			continue
		}
		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (vp *viteProcess) remoteObservationFailed(err error) {
	vp.mu.Lock()
	vp.observationErr = err
	vp.setStatus(DevProcessStatusError)
	vp.mu.Unlock()
	vp.logger.Warnw(context.Background(), "retained frontend observation failed", "pluginID", vp.pluginID, "error", err)
	vp.appendLog(newLogEntry(logSourceVite, logLevelError, fmt.Sprintf("Retained frontend observation failed: %v", err)))
	select {
	case vp.observationError <- fmt.Errorf("retained frontend observation failed: %w", err):
	default:
	}
}

func (vp *viteProcess) finishRemoteExit(err error) {
	if vp.remoteLogsDone != nil {
		<-vp.remoteLogsDone
	}
	vp.doneOnce.Do(func() {
		if err != nil {
			vp.appendLog(newLogEntry(logSourceVite, logLevelError, fmt.Sprintf("Retained Vite process exited: %v", err)))
		} else {
			vp.appendLog(newLogEntry(logSourceVite, logLevelInfo, "Retained Vite process exited"))
		}
		vp.setStatus(DevProcessStatusError)
		close(vp.done)
	})
}

func (vp *viteProcess) stopRemote(process *devsession.RemoteProcess) error {
	select {
	case <-vp.done:
		return nil
	default:
	}
	ctx, cancel := context.WithTimeout(context.Background(), viteStopGracePeriod+viteKillWaitPeriod)
	defer cancel()
	if err := process.Stop(ctx); err != nil {
		return err
	}
	// A successful stop response means the retained Cmd has actually exited,
	// drained and been reaped; signal delivery alone cannot close our done channel.
	vp.finishRemoteExit(nil)
	return nil
}
