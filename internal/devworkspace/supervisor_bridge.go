package devworkspace

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type managedProcessRecord struct {
	id     string
	start  devsession.ProcessStart
	host   devcontract.ProcessIdentity
	child  *ownedChild
	output *managedProcessOutput
}
type managedProcessOutput struct {
	mu          sync.Mutex
	buffer      []byte
	end         int64
	failure     error
	destination io.Writer
}

func (o *managedProcessOutput) Write(data []byte) (int, error) {
	n := len(data)
	var err error
	if o.destination != nil {
		n, err = o.destination.Write(data)
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.buffer == nil {
		o.buffer = make([]byte, 1<<20)
	}
	kept := data[:n]
	if len(kept) > len(o.buffer) {
		kept = kept[len(kept)-len(o.buffer):]
	}
	start := int((o.end + int64(n-len(kept))) % int64(len(o.buffer)))
	first := copy(o.buffer[start:], kept)
	copy(o.buffer, kept[first:])
	o.end += int64(n)
	if err != nil {
		o.failure = err
	}
	return n, err
}
func (o *managedProcessOutput) page(cursor int64, limit int, done bool) (devsession.ProcessLogPage, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	base := o.end - int64(len(o.buffer))
	if base < 0 {
		base = 0
	}
	page := devsession.ProcessLogPage{NextCursor: cursor}
	if cursor < base {
		page.Overflow = true
		page.NextCursor = base
		page.Error = devcontract.Fail(4, "process_output_overflow", "owned process output cursor was overtaken")
		return page, nil
	}
	if cursor < 0 || cursor > o.end || limit < 1 || limit > 65536 {
		return page, devcontract.Fail(2, "invalid_request", "invalid process output cursor or limit")
	}
	n := int(o.end - cursor)
	if n > limit {
		n = limit
	}
	if n > 0 {
		data := make([]byte, n)
		start := int(cursor % int64(len(o.buffer)))
		first := copy(data, o.buffer[start:])
		if first > n {
			first = n
		}
		copy(data[first:], o.buffer[:n-first])
		page.Data = string(data)
	}
	page.NextCursor = cursor + int64(n)
	page.EOF = done && page.NextCursor == o.end
	if o.failure != nil {
		page.Error = devcontract.Fail(5, "process_output_failed", "owned process output writer failed")
	}
	return page, nil
}
func (r *managedProcessRecord) status() (devsession.ProcessStatus, error) {
	status := devsession.ProcessStatus{ProcessID: r.id, Identity: r.child.identity, Running: true}
	select {
	case <-r.child.done:
		r.child.mu.Lock()
		defer r.child.mu.Unlock()
		if r.child.disposalErr != nil || r.child.finalizeErr != nil {
			return status, r.child.err
		}
		if r.child.command.ProcessState == nil {
			return status, errors.Join(errOwnedCommandUncertain, r.child.err)
		}
		status.Running = false
		status.ExitCode = r.child.command.ProcessState.ExitCode()
	default:
	}
	return status, nil
}
func managedProcessKey(start devsession.ProcessStart) string {
	return start.PluginID + "\x00" + start.PluginGeneration + "\x00" + start.Kind
}
func (s *workspaceSupervisor) processHandler(token []byte) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := devsession.ProcessResponse{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation}
		respond := func(code int, err error) {
			response.Error = workspaceError(err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(response)
		}
		host := r.Host
		if value, _, err := net.SplitHostPort(host); err == nil {
			host = value
		}
		authorization := r.Header.Get("Authorization")
		expected := "Bearer " + string(token)
		if r.Method != http.MethodPost || r.URL.Path != "/v1/process" || r.URL.RawQuery != "" || host != "127.0.0.1" || r.Header.Get("Origin") != "" || r.Header.Get("Content-Type") != "application/json" {
			respond(400, devcontract.Fail(2, "invalid_request", "private process bridge requires explicit loopback JSON POST"))
			return
		}
		if len(authorization) != len(expected) || subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
			respond(401, devcontract.Fail(6, "unauthorized", "process supervisor authorization required"))
			return
		}
		var request devsession.ProcessRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || request.RequestID == "" {
			respond(400, devcontract.Fail(2, "invalid_request", "invalid private process request"))
			return
		}
		response.RequestID = request.RequestID
		if request.WorkspaceID != s.workspace.Manifest.WorkspaceID || request.Generation != s.generation {
			respond(409, devcontract.Fail(4, "stale_target", "process request generation differs"))
			return
		}
		if err := s.verifyProcessHost(r.Context(), request.Host); err != nil {
			respond(409, err)
			return
		}
		switch request.Operation {
		case "start":
			if request.Start == nil || request.ProcessID != "" {
				respond(400, devcontract.Fail(2, "invalid_request", "process start requires its exact typed selection"))
				return
			}
			record, err := s.startManagedProcess(*request.Start, request.Host)
			if err != nil {
				respond(409, err)
				return
			}
			status, err := record.status()
			if err != nil {
				respond(500, err)
				return
			}
			response.Process = &status
		case "status", "wait", "stop", "logs":
			if request.Start != nil || request.ProcessID == "" {
				respond(400, devcontract.Fail(2, "invalid_request", "owned process handle required"))
				return
			}
			s.processMu.Lock()
			record := s.managedProcesses[request.ProcessID]
			s.processMu.Unlock()
			if record == nil || record.host != request.Host {
				respond(409, devcontract.Fail(4, "process_conflict", "process handle is not owned by this captured host"))
				return
			}
			if request.Operation == "stop" {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				err := record.child.stop(ctx)
				cancel()
				if err != nil {
					respond(500, err)
					return
				}
			}
			if request.Operation == "wait" {
				if request.TimeoutMS < 1 || request.TimeoutMS > 30000 {
					respond(400, devcontract.Fail(2, "invalid_request", "invalid process wait deadline"))
					return
				}
				timer := time.NewTimer(time.Duration(request.TimeoutMS) * time.Millisecond)
				select {
				case <-record.child.done:
				case <-timer.C:
				case <-r.Context().Done():
				}
				timer.Stop()
			}
			status, err := record.status()
			if err != nil {
				respond(500, err)
				return
			}
			response.Process = &status
			if request.Operation == "logs" {
				limit := request.Limit
				if limit == 0 {
					limit = 32768
				}
				page, err := record.output.page(request.Cursor, limit, !status.Running)
				if err != nil {
					respond(400, err)
					return
				}
				response.Logs = &page
			}
		default:
			respond(400, devcontract.Fail(2, "invalid_request", "unknown private process operation"))
			return
		}
		respond(http.StatusOK, nil)
	})
}
func (s *workspaceSupervisor) verifyProcessHost(ctx context.Context, identity devcontract.ProcessIdentity) error {
	s.mu.Lock()
	ready := s.hostCaptureReady
	s.mu.Unlock()
	if ready == nil {
		return devcontract.Fail(4, "process_conflict", "host capture has not started")
	}
	select {
	case <-ready:
	case <-ctx.Done():
		return devcontract.Fail(7, "timeout", "host ownership capture was not acknowledged")
	}
	s.mu.Lock()
	host := s.children["host"]
	s.mu.Unlock()
	if host == nil || host.identity != identity {
		return devcontract.Fail(4, "stale_target", "process request does not match the captured host")
	}
	select {
	case <-host.done:
		return devcontract.Fail(4, "stale_target", "captured host has exited")
	default:
	}
	return devsession.VerifyOwnedProcess(identity, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "host", Source: identity.Source})
}
func validateProcessOverride(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !filepath.IsAbs(path) {
		return "", devcontract.Fail(2, "invalid_process_override", "explicit executable override must be absolute")
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.Mode().IsRegular() {
		return "", devcontract.Fail(2, "invalid_process_override", "explicit executable override is not a regular executable")
	}
	return canonical, nil
}
func (s *workspaceSupervisor) startManagedProcess(start devsession.ProcessStart, host devcontract.ProcessIdentity) (*managedProcessRecord, error) {
	if start.PluginGeneration == "" || start.Kind != "dev" {
		return nil, devcontract.Fail(2, "invalid_request", "invalid managed process selection")
	}
	var frontend *BuildNode
	var source string
	for _, plugin := range s.workspace.Manifest.Plugins {
		if plugin.ID != start.PluginID {
			continue
		}
		var err error
		source, err = s.workspace.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			return nil, err
		}
		for i := range s.graphInstance.Nodes {
			node := &s.graphInstance.Nodes[i]
			if node.ID == "plugin-ui:"+plugin.ID {
				frontend = node
				break
			}
		}
		break
	}
	if frontend == nil || source == "" || start.Source != source {
		return nil, devcontract.Fail(4, "invalid_process_source", "managed process source is not the selected frontend repository")
	}
	composition, err := devcompose.Installed(s.workspace.ResolvedWorkspace, frontend.Directory)
	if err != nil {
		return nil, devcontract.Fail(4, "composition_not_installed", "managed UI requires a complete installed feature composition; stop and reconfigure the workspace")
	}
	key := managedProcessKey(start)
	s.processStartMu.Lock()
	defer s.processStartMu.Unlock()
	s.processMu.Lock()
	closing := s.managedClosing
	id := s.managedKeys[key]
	existing := s.managedProcesses[id]
	s.processMu.Unlock()
	if closing {
		return nil, devcontract.Fail(4, "process_conflict", "managed process owner is shutting down")
	}
	if id != "" {
		if existing != nil && existing.start == start && existing.host == host {
			return existing, nil
		}
		return nil, devcontract.Fail(4, "process_conflict", "managed process key is already owned with different parameters")
	}
	if start.Kind == "dev" {
		leases, err := s.registry.List(context.Background(), s.workspace.Manifest.WorkspaceID)
		if err != nil {
			return nil, err
		}
		found := false
		for _, lease := range leases {
			if lease.Key.Role != "plugin-vite" || lease.Key.PluginID != start.PluginID {
				continue
			}
			owner := lease.Owner
			expected := host
			expected.Source = s.workspace.ManifestPath
			if lease.Generation == s.generation && lease.Port == start.Port && lease.State == devsession.LeaseReserved && owner == expected {
				found = true
			}
			break
		}
		if !found {
			return nil, devcontract.Fail(4, "invalid_process_port", "managed Vite request has no exact current-host reserved lease")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pnpmOverride, err := validateProcessOverride(start.PNPMPath)
	if err != nil {
		return nil, err
	}
	nodeOverride, err := validateProcessOverride(start.NodePath)
	if err != nil {
		return nil, err
	}
	program := pnpmOverride
	var prefix []string
	if program == "" {
		program, prefix, err = s.graphInstance.PNPMCommand(ctx, frontend.PNPMVersion)
		if err != nil {
			return nil, err
		}
	}
	if err := s.checkFeedback(); err != nil {
		return nil, err
	}
	env := s.environment()
	allowed, err := s.graphInstance.ViteEnvironment()
	if err != nil {
		return nil, err
	}
	env = append(env, allowed...)
	env = append(env, "OMNIVIEW_PLUGIN_ID="+start.PluginID)
	env = append(env, devcompose.RootEnvironment+"="+composition.Root)
	if nodeOverride != "" {
		env = append(env, "OMNIVIEW_PNPM_NODE_PATH="+nodeOverride, "PATH="+filepath.Dir(nodeOverride)+string(os.PathListSeparator)+os.Getenv("PATH"))
		if pnpmOverride == "" {
			program = nodeOverride
		}
	}
	args := append([]string(nil), prefix...)
	role := "plugin-vite"
	writer, err := devoutputs.BeginVite(ctx, s.workspace.ResolvedWorkspace, frontend.Directory)
	if err != nil {
		return nil, err
	}
	env = append(env, writer.Environment...)
	args = append(args, "run", "dev", "--port", strconv.Itoa(start.Port), "--strictPort", "--host", "127.0.0.1")
	env = append(env, "OMNIVIEW_VITE_PORT="+strconv.Itoa(start.Port))
	output := &managedProcessOutput{destination: s.output}
	// The start gate serializes preparation, capture and publication with shutdown.
	// The map lock stays available to observe already-running sibling processes.
	child, err := startOwnedChild(s.childContext, frontend.Directory, env, output, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: role, Source: source}, func() error { return writer.Finish(context.WithoutCancel(s.childContext)) }, program, args...)
	if child == nil {
		return nil, err
	}
	record := &managedProcessRecord{id: NewGeneration(), start: start, host: host, child: child, output: output}
	s.processMu.Lock()
	if s.managedProcesses == nil {
		s.managedProcesses = map[string]*managedProcessRecord{}
	}
	if s.managedKeys == nil {
		s.managedKeys = map[string]string{}
	}
	s.managedProcesses[record.id] = record
	s.managedKeys[key] = record.id
	s.processMu.Unlock()
	return record, err
}
func (s *workspaceSupervisor) stopManagedProcesses(ctx context.Context) error {
	s.processStartMu.Lock()
	s.processMu.Lock()
	s.managedClosing = true
	records := make([]*managedProcessRecord, 0, len(s.managedProcesses))
	for _, record := range s.managedProcesses {
		records = append(records, record)
	}
	s.processMu.Unlock()
	s.processStartMu.Unlock()
	var first error
	for _, record := range records {
		if err := record.child.stop(ctx); err != nil && first == nil {
			first = err
		}
	}
	if first != nil {
		return first
	}
	// Release only AFTER every retained child has really exited. An old completed
	// generation must never release a newer generation's still-running port.
	hosts := map[devcontract.ProcessIdentity]bool{}
	for _, record := range records {
		hosts[record.host] = true
	}
	s.mu.Lock()
	last := s.lastHost
	s.mu.Unlock()
	if last != nil {
		hosts[last.identity] = true
	}
	hostSource, err := s.workspace.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	leases, err := s.registry.List(ctx, s.workspace.Manifest.WorkspaceID)
	if err != nil {
		return err
	}
	for _, lease := range leases {
		if lease.Key.Role != "plugin-vite" || lease.Generation != s.generation || lease.State == devsession.LeaseReleased {
			continue
		}
		owner := lease.Owner
		owner.Source = hostSource
		if !hosts[owner] || lease.Owner.Source != s.workspace.ManifestPath {
			continue
		}
		known := lease.Process == nil
		if lease.Process != nil {
			for _, record := range records {
				status, statusErr := record.status()
				if record.start.Kind == "dev" && record.start.PluginID == lease.Key.PluginID && record.child.identity == *lease.Process && statusErr == nil && !status.Running {
					known = true
					break
				}
			}
		}
		if !known {
			return devcontract.Fail(4, "process_conflict", "managed lease references a process outside the retained supervisor handles")
		}
		if err = s.registry.Release(ctx, lease.Key, s.generation); err != nil && first == nil {
			first = err
		}
	}
	return first
}
