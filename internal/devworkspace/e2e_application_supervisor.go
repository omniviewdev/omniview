//go:build e2eapplication

package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
)

// The existing owned-command wrapper is the real supervisor of this immutable
// application's host tree. Reuse the production bridge and short-socket owner;
// do not impersonate a bridge with environment strings or redirect general TMPDIR.
type applicationFixtureSupervisor struct {
	supervisor *workspaceSupervisor
	server     *http.Server
	done       chan error
}

func startApplicationFixtureSupervisor(options ApplicationFixtureCommand) (*applicationFixtureSupervisor, []string, error) {
	values := make(map[string]string)
	for _, entry := range options.Environment {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	if options.Owner.Role != "host" || options.ProfileWorkspace != values[devcontract.WorkspaceEnvironment] || options.Owner.Generation != values["OMNIVIEW_GENERATION"] || values["HOME"] == "" {
		return nil, nil, fmt.Errorf("application supervisor requires the exact selected host profile and generation")
	}
	profile, err := instance.Resolve(instance.Options{Home: values["HOME"], EnvironmentManifest: options.ProfileWorkspace, Generation: options.Owner.Generation, Channel: "local"})
	if err != nil {
		return nil, nil, err
	}
	source, err := profile.Workspace.RepositoryPath("omniview")
	if err != nil {
		return nil, nil, err
	}
	if profile.Workspace.Manifest.WorkspaceID != options.Owner.WorkspaceID || source != options.Owner.Source || len(profile.Workspace.Manifest.Plugins) != 0 {
		return nil, nil, fmt.Errorf("application supervisor requires the actual installed-only host profile")
	}
	if err = profile.PrepareRuntime(); err != nil {
		return nil, nil, err
	}
	w := Workspace{ResolvedWorkspace: *profile.Workspace}
	owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: options.Owner.Generation, Role: "supervisor", Source: w.Root})
	if err != nil {
		return nil, nil, err
	}
	registry, err := devsession.OpenRegistry(filepath.Join(values["HOME"], ".omniview-dev", "sessions"), devsession.RegistryOptions{})
	if err != nil {
		return nil, nil, err
	}
	s := &workspaceSupervisor{workspace: w, generation: options.Owner.Generation, owner: owner, registry: registry, output: os.Stdout, children: map[string]*ownedChild{}, hostCaptureReady: make(chan struct{})}
	result := &applicationFixtureSupervisor{supervisor: s, done: make(chan error, 1)}
	s.unixSocketDirectory, err = devsession.CreateUnixSocketDirectory(profile.RuntimeRoot, owner)
	if err != nil {
		return result, nil, err
	}
	token, err := devsession.GenerateToken()
	if err != nil {
		return result, nil, err
	}
	tokenFile := launchPath(w, "supervisor-"+options.Owner.Generation+".secret")
	if _, err = devsession.EnsurePrivateDirectory(filepath.Dir(tokenFile)); err != nil {
		return result, nil, err
	}
	if _, err = os.Lstat(tokenFile); err == nil {
		return result, nil, os.ErrExist
	} else if !os.IsNotExist(err) {
		return result, nil, err
	}
	// This runtime-only profile is intentionally not a source worktree. Its
	// private generation credential belongs to the invocation, not a Git ledger.
	if err = devsession.WritePrivateFile(tokenFile, token); err != nil {
		return result, nil, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return result, nil, err
	}
	result.server = &http.Server{Handler: s.processHandler(token), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		err := result.server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		result.done <- err
	}()
	environment := append([]string{}, options.Environment...)
	for key := range values {
		if strings.HasPrefix(key, "OMNIVIEW_PROCESS_BRIDGE_") {
			return result, nil, fmt.Errorf("application supervisor refuses inherited bridge selections")
		}
	}
	environment = append(environment, "OMNIVIEW_PROCESS_BRIDGE_ENDPOINT=http://"+listener.Addr().String()+"/v1/process", "OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE="+tokenFile)
	return result, environment, nil
}

func (s *applicationFixtureSupervisor) capture(child *ownedChild) {
	if s == nil {
		return
	}
	s.supervisor.mu.Lock()
	s.supervisor.children["host"] = child
	s.supervisor.lastHost = child
	close(s.supervisor.hostCaptureReady)
	s.supervisor.mu.Unlock()
}

func (s *applicationFixtureSupervisor) stop(child *ownedChild) error {
	var result error
	if s != nil {
		result = s.supervisor.stopManagedProcesses(context.Background())
	}
	if child != nil {
		result = errors.Join(result, child.stop(context.Background()))
	}
	if s == nil {
		return result
	}
	result = errors.Join(result, s.supervisor.stopManagedProcesses(context.Background()))
	if result != nil {
		return result
	}
	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := s.server.Shutdown(ctx)
		cancel()
		if err != nil {
			return err
		}
	}
	// No namespace retirement until every exact retained process group and bridge
	// producer has stopped. Close retains the original capability on failure.
	return s.supervisor.unixSocketDirectory.Close()
}
