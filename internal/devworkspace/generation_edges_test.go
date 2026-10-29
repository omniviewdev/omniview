//go:build devcontrol && (darwin || linux)

package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

type generationEdgeConfig struct {
	Workspace           Workspace
	Home, Generation    string
	Gate, GateCommand   string
	PublishGate, Starts string
	Detached            bool
}

// The helper owns a real authenticated host and runs the production supervisor
// executor. The transport gate holds an already-computed response, not an echo
// of the request. Stdin controls exact helper exit independently of disposal.
func TestGenerationEdgeProcess(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_GENERATION_EDGE_MODE")
	if mode == "" {
		return
	}
	var config generationEdgeConfig
	require.NoError(t, json.Unmarshal([]byte(os.Getenv("OMNIVIEW_GENERATION_EDGE_CONFIG")), &config))
	w := config.Workspace
	ctx := context.Background()
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: config.Generation, Role: mode, Source: w.Root}
	if mode == "supervisor" {
		var stopSignals context.CancelFunc
		ctx, stopSignals = signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
		defer stopSignals()
	}
	if mode == "host" {
		var err error
		owner.Source, err = w.RepositoryPath("omniview")
		require.NoError(t, err)
	}
	identity, err := devsession.CaptureProcess(os.Getpid(), owner)
	require.NoError(t, err)
	var protocol *os.File
	if config.Detached && mode == "supervisor" {
		protocol, err = os.OpenFile(os.DevNull, os.O_WRONLY, 0600)
		require.NoError(t, err)
	} else {
		protocol = os.NewFile(3, "generation-protocol")
	}
	defer protocol.Close()
	if mode == "host" {
		profile, err := profileFor(w, config.Home, config.Generation)
		require.NoError(t, err)
		descriptor := profile.Descriptor
		descriptor.Process, descriptor.Readiness = identity, "host-ready"
		store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
		require.NoError(t, err)
		server, err := devcontrol.Start(ctx, devcontrol.Config{Descriptor: descriptor, Discovery: store, Adapters: devcontrol.Adapters{
			Inspect: func(context.Context) (devcontract.InstanceDescriptor, error) { return descriptor, nil },
			Dev:     &readinessProducer{states: map[string]devcontrol.DevState{}},
			Plugins: struct{ devcontrol.Plugins }{}, Settings: struct{ devcontrol.Settings }{},
		}})
		require.NoError(t, err)
		defer server.Close(ctx)
		require.NoError(t, json.NewEncoder(protocol).Encode(descriptor))
		_, _ = io.Copy(io.Discard, os.Stdin)
		return
	}
	require.Equal(t, "supervisor", mode)
	hostCommand := exec.Command(os.Args[0], "-test.run=^TestGenerationEdgeProcess$")
	hostCommand.Dir = w.Root
	hostCommand.Env = append(os.Environ(), "OMNIVIEW_GENERATION_EDGE_MODE=host")
	hostCommand.Stderr = os.Stderr
	hostInput, err := hostCommand.StdinPipe()
	require.NoError(t, err)
	defer hostInput.Close()
	hostOutput, hostProtocol, err := os.Pipe()
	require.NoError(t, err)
	defer hostOutput.Close()
	require.NoError(t, hostOutput.SetReadDeadline(time.Now().Add(20*time.Second)))
	hostCommand.ExtraFiles = []*os.File{hostProtocol}
	hostCommand.Stdout = os.Stderr
	hostOwner := owner
	if config.Starts != "" {
		starts, err := os.OpenFile(config.Starts, os.O_APPEND|os.O_WRONLY, 0600)
		require.NoError(t, err)
		require.NoError(t, json.NewEncoder(starts).Encode(identity))
		require.NoError(t, starts.Close())
	}
	hostOwner.Role = "host"
	hostOwner.Source, err = w.RepositoryPath("omniview")
	require.NoError(t, err)
	host, err := startOwnedChildCommand(ctx, hostCommand, hostOwner, nil, true)
	require.NoError(t, err)
	require.NoError(t, hostProtocol.Close())
	defer func() { require.NoError(t, host.stop(context.Background())) }()
	var descriptor devcontract.InstanceDescriptor
	require.NoError(t, json.NewDecoder(hostOutput).Decode(&descriptor))
	require.Equal(t, host.identity, descriptor.Process)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	token := []byte("generation-edge-private-authenticated-supervisor-token-" + config.Generation)
	record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: config.Generation, Endpoint: "http://" + listener.Addr().String() + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+config.Generation+".secret"), Process: identity}
	registry, err := devsession.OpenRegistry(filepath.Join(config.Home, "generation-edge-sessions"), devsession.RegistryOptions{})
	require.NoError(t, err)
	s := &workspaceSupervisor{
		workspace: w, generation: config.Generation, owner: identity, record: record,
		manager: &Manager{options: Options{Home: config.Home}}, output: os.Stderr,
		sessionContext: ctx, sessionCancel: func() {}, exit: make(chan struct{}),
		children: map[string]*ownedChild{"host": host},
		registry: registry,
		status:   Status{Workspace: w, Generation: config.Generation, Phase: "ready"},
	}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	var gateOnce sync.Once
	handler := supervisorHandler(record.WorkspaceID, record.Generation, token, func(ctx context.Context, command string) (Status, error) {
		status, err := s.execute(ctx, command)
		if command == config.GateCommand {
			gateOnce.Do(func() { lifecycleEdgeGate(t, config.Gate) })
		}
		return status, err
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second}
	serveDone := make(chan error, 1)
	if config.PublishGate != "" {
		lifecycleEdgeGate(t, config.PublishGate)
	}
	go func() { serveDone <- server.Serve(listener) }()
	require.NoError(t, json.NewEncoder(protocol).Encode(record))
	inputDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		close(inputDone)
	}()
	if config.Detached {
		select {
		case <-s.exit:
		case <-ctx.Done():
		}
	} else {
		select {
		case <-inputDone:
		case <-ctx.Done():
		}
	}
	s.runMu.Lock()
	cleanupErr := s.stopChildren(context.Background())
	s.runMu.Unlock()
	require.NoError(t, cleanupErr)
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	require.NoError(t, server.Shutdown(shutdownContext))
	require.ErrorIs(t, <-serveDone, http.ErrServerClosed)
	os.Exit(0)
}

type generationEdgeOwner struct {
	child  *ownedChild
	input  io.WriteCloser
	record supervisorRecord
}

func startGenerationEdge(t *testing.T, m *Manager, w Workspace, generation, gate, gateCommand string) *generationEdgeOwner {
	t.Helper()
	config, err := json.Marshal(generationEdgeConfig{Workspace: w, Home: m.options.Home, Generation: generation, Gate: gate, GateCommand: gateCommand})
	require.NoError(t, err)
	command := exec.Command(os.Args[0], "-test.run=^TestGenerationEdgeProcess$")
	command.Dir = w.Root
	command.Env = append(os.Environ(), "OMNIVIEW_GENERATION_EDGE_MODE=supervisor", "OMNIVIEW_GENERATION_EDGE_CONFIG="+string(config), "GORACE="+os.Getenv("GORACE")+" atexit_sleep_ms=0")
	log, err := os.CreateTemp(t.TempDir(), "generation-owner-*.log")
	require.NoError(t, err)
	command.Stderr = log
	command.Stdout = log
	input, err := command.StdinPipe()
	require.NoError(t, err)
	output, protocol, err := os.Pipe()
	require.NoError(t, err)
	require.NoError(t, output.SetReadDeadline(time.Now().Add(25*time.Second)))
	command.ExtraFiles = []*os.File{protocol}
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	child, err := startOwnedChildCommand(ctx, command, owner, nil, true)
	require.NoError(t, err)
	require.NoError(t, protocol.Close())
	p := &generationEdgeOwner{child: child, input: input}
	t.Cleanup(func() {
		_ = input.Close()
		cleanupContext, cancelCleanup := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancelCleanup()
		select {
		case <-child.done:
		case <-cleanupContext.Done():
			fallbackContext, cancelFallback := context.WithTimeout(context.Background(), 10*time.Second)
			stopErr := child.stop(fallbackContext)
			cancelFallback()
			if stopErr != nil {
				t.Errorf("exact supervisor failed graceful nested-child cleanup: %v", stopErr)
			}
			select {
			case <-child.done:
			default:
				t.Error("exact supervisor remains retained after bounded cleanup")
			}
		}
		cancel()
		_ = output.Close()
		if t.Failed() {
			data, err := os.ReadFile(log.Name())
			require.NoError(t, err)
			t.Logf("authenticated helper: %s", data)
		}
		require.NoError(t, log.Close())
	})
	require.NoError(t, json.NewDecoder(output).Decode(&p.record))
	require.Equal(t, child.identity, p.record.Process)
	require.NoError(t, verifySupervisor(p.record, w))
	return p
}

type generationEdgeOutcome struct {
	status Status
	err    error
}

func generationEdgeAwait(t *testing.T, done <-chan generationEdgeOutcome) generationEdgeOutcome {
	t.Helper()
	select {
	case result := <-done:
		return result
	case <-time.After(10 * time.Second):
		t.Fatal("workspace operation did not reach a terminal outcome")
		return generationEdgeOutcome{}
	}
}

func TestGenerationEdgesAuthenticatedStatusCannotOutliveRecordReplacement(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "stale-inspect"})
	require.NoError(t, err)
	listener := lifecycleEdgeListener(t)
	old := startGenerationEdge(t, m, w, NewGeneration(), listener.Addr().String(), supervisorStatusCommand)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	done := make(chan generationEdgeOutcome, 1)
	go func() {
		status, err := m.Status(ctx, w.Manifest.WorkspaceID)
		done <- generationEdgeOutcome{status, err}
	}()
	gate, err := listener.Accept()
	require.NoError(t, err)
	defer gate.Close()
	// Hold the old, genuinely ready snapshot, but retire its host before the
	// successor claims discovery. Two live hosts must never share that claim.
	token, err := readSupervisorToken(w, old.record)
	require.NoError(t, err)
	stopped, err := callSupervisor(ctx, old.record, token, supervisorStopCommand)
	require.NoError(t, err)
	require.Equal(t, "stopped", stopped.Phase)
	successor := startGenerationEdge(t, m, w, NewGeneration(), "", "")
	_, err = gate.Write([]byte{1})
	require.NoError(t, err)
	result := generationEdgeAwait(t, done)
	if result.err == nil {
		require.Equal(t, successor.record.Generation, result.status.Generation, "an authenticated obsolete response must not establish readiness")
	} else {
		require.NotEqual(t, "ready", result.status.Phase)
	}
	var persisted supervisorRecord
	require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &persisted))
	require.Equal(t, successor.record, persisted)
	require.NoError(t, verifySupervisor(old.record, w))
	require.NoError(t, verifySupervisor(successor.record, w))
	current, err := m.Status(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, successor.record.Generation, current.Generation)
	require.Equal(t, "ready", current.Phase)
	require.NotNil(t, current.Instance)
	require.Equal(t, successor.record.Generation, current.Instance.Generation)
}

func TestGenerationEdgesReplacementDuringShutdownPreservesSuccessor(t *testing.T) {
	for _, command := range []string{supervisorStopCommand, supervisorRestartCommand} {
		t.Run(command, func(t *testing.T) {
			m, _ := fixtureManager(t)
			w, err := m.Create(context.Background(), CreateOptions{Slug: "replace-shutdown"})
			require.NoError(t, err)
			require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), generationEdgeLaunchOptions(w)))
			listener := lifecycleEdgeListener(t)
			old := startGenerationEdge(t, m, w, NewGeneration(), listener.Addr().String(), command)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			done := make(chan generationEdgeOutcome, 1)
			go func() {
				var status Status
				var err error
				if command == supervisorStopCommand {
					status, err = m.Down(ctx, w.Manifest.WorkspaceID)
				} else {
					status, err = m.Restart(ctx, w.Manifest.WorkspaceID)
				}
				done <- generationEdgeOutcome{status, err}
			}()
			gate, err := listener.Accept()
			require.NoError(t, err)
			defer gate.Close()
			var stopped Status
			require.NoError(t, readLaunchJSON(launchPath(w, "launch-status.json"), &stopped))
			require.Equal(t, old.record.Generation, stopped.Generation)
			require.Equal(t, "stopped", stopped.Phase)
			successor := startGenerationEdge(t, m, w, NewGeneration(), "", "")
			_, err = gate.Write([]byte{1})
			require.NoError(t, err)
			result := generationEdgeAwait(t, done)
			var failure *devcontract.Error
			require.ErrorAs(t, result.err, &failure)
			require.Equal(t, "stale_target", failure.Code, "shutdown must reject replacement, not wait for or stop the successor")
			var persisted supervisorRecord
			require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &persisted))
			require.Equal(t, successor.record, persisted)
			require.NoError(t, verifySupervisor(successor.record, w))
			status, err := m.Status(context.Background(), w.Manifest.WorkspaceID)
			require.NoError(t, err)
			require.Equal(t, "ready", status.Phase)
			require.Equal(t, successor.record.Generation, status.Generation)
		})
	}
}

func TestGenerationEdgesCancelledResponseAfterDisposalCanRetryExactOwner(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "disposal-retry"})
	require.NoError(t, err)
	listener := lifecycleEdgeListener(t)
	owner := startGenerationEdge(t, m, w, NewGeneration(), listener.Addr().String(), supervisorStopCommand)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan generationEdgeOutcome, 1)
	go func() { status, err := m.Down(ctx, w.Manifest.WorkspaceID); done <- generationEdgeOutcome{status, err} }()
	gate, err := listener.Accept()
	require.NoError(t, err)
	defer gate.Close()
	cancel()
	require.Error(t, generationEdgeAwait(t, done).err)
	var stopped Status
	require.NoError(t, readLaunchJSON(launchPath(w, "launch-status.json"), &stopped))
	require.Equal(t, owner.record.Generation, stopped.Generation)
	require.Equal(t, "stopped", stopped.Phase)
	require.NoError(t, verifySupervisor(owner.record, w), "child disposal does not prove supervisor exit")
	_, err = gate.Write([]byte{1})
	require.NoError(t, err)
	status, err := m.Status(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, "stopped", status.Phase)
	require.Equal(t, owner.record.Generation, status.Generation)
	retryCtx, retryCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer retryCancel()
	require.NoError(t, owner.input.Close())
	select {
	case <-owner.child.done:
	case <-retryCtx.Done():
		t.Fatal("exact supervisor did not finish disposal and exit")
	}
	result, err := m.Down(retryCtx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, owner.record.Generation, result.Generation)
	require.Contains(t, []string{"stopped", "crashed"}, result.Phase)
	require.ErrorIs(t, devsession.VerifyOwnedProcess(owner.record.Process, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: owner.record.Generation, Role: "supervisor", Source: w.Root}), devsession.ErrProcessGone)
}

func TestGenerationEdgesExitedCaptureCannotPublishLiveIdentity(t *testing.T) {
	// Capture and publication are separate existing seams. Keep a real Cmd
	// through Wait, then use the production capture gate on that exact handle.
	command := exec.Command(os.Args[0], "-test.run=^TestGenerationEdgeProcess$")
	command.Env = append(os.Environ(), "OMNIVIEW_GENERATION_EDGE_MODE=")
	require.NoError(t, command.Start())
	require.NoError(t, command.Wait())
	workspaceID := "8054707b-a5be-4c69-820a-275d48d61001"
	generation := NewGeneration()
	owner := devsession.ProcessOwner{WorkspaceID: workspaceID, Generation: generation, Role: "supervisor", Source: filepath.Dir(os.Args[0])}
	identity, err := captureExecutedProcess(context.Background(), command.Path, supervisorExecutable(), time.Second, func() (devcontract.ProcessIdentity, error) {
		return devsession.CaptureProcess(command.Process.Pid, owner)
	})
	require.ErrorIs(t, err, devsession.ErrProcessGone)
	require.Zero(t, identity.PID)
	require.Empty(t, identity.Generation)
}

func generationEdgeExecutable(t *testing.T, m *Manager, w Workspace, publishGate string) (string, string, string) {
	t.Helper()
	generation := NewGeneration()
	starts := filepath.Join(t.TempDir(), "supervisor-starts.jsonl")
	require.NoError(t, os.WriteFile(starts, nil, 0600))
	data, err := json.Marshal(generationEdgeConfig{Workspace: w, Home: m.options.Home, Generation: generation, Detached: true, PublishGate: publishGate, Starts: starts})
	require.NoError(t, err)
	binary, err := os.Executable()
	require.NoError(t, err)
	script := "#!/bin/sh\nexport GORACE=" + shellArgument(os.Getenv("GORACE")+" atexit_sleep_ms=0") + "\nexport OMNIVIEW_GENERATION_EDGE_MODE=supervisor\nexport OMNIVIEW_GENERATION_EDGE_CONFIG=" + shellArgument(string(data)) + "\nexec " + shellArgument(binary) + " -test.run=^TestGenerationEdgeProcess$\n"
	path := filepath.Join(t.TempDir(), "supervisor")
	require.NoError(t, os.WriteFile(path, []byte(script), 0700))
	return path, generation, starts
}

func TestGenerationEdgesConcurrentStartPublishesOneSupervisor(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "concurrent-up", Repositories: []string{"plugin-sdk"}})
	require.NoError(t, err)
	executable, generation, starts := generationEdgeExecutable(t, m, w, "")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := m.Down(ctx, w.Manifest.WorkspaceID)
		require.NoError(t, err)
	})
	barrier := make(chan struct{})
	done := make(chan generationEdgeOutcome, 2)
	for range 2 {
		go func() {
			<-barrier
			status, err := m.Start(ctx, w.Manifest.WorkspaceID, generationEdgeLaunchOptions(w), executable, io.Discard)
			done <- generationEdgeOutcome{status, err}
		}()
	}
	close(barrier)
	first, second := generationEdgeAwait(t, done), generationEdgeAwait(t, done)
	require.NotEqual(t, first.err == nil, second.err == nil, "only one concurrent caller may create a supervisor")
	winner, loser := first, second
	if winner.err != nil {
		winner, loser = second, first
	}
	require.Equal(t, generation, winner.status.Generation)
	require.Equal(t, "ready", winner.status.Phase)
	require.Error(t, loser.err)
	data, err := os.ReadFile(starts)
	require.NoError(t, err)
	require.Equal(t, 1, bytes.Count(data, []byte{'\n'}), "start serialization must protect actual process creation")
	var record supervisorRecord
	require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &record))
	require.Equal(t, generation, record.Generation)
	require.NoError(t, verifySupervisor(record, w))
}

func TestGenerationEdgesCancelledStartRetainsInspectableStoppableOwner(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "cancel-up", Repositories: []string{"plugin-sdk"}})
	require.NoError(t, err)
	listener := lifecycleEdgeListener(t)
	executable, generation, starts := generationEdgeExecutable(t, m, w, listener.Addr().String())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan generationEdgeOutcome, 1)
	go func() {
		status, err := m.Start(ctx, w.Manifest.WorkspaceID, generationEdgeLaunchOptions(w), executable, io.Discard)
		done <- generationEdgeOutcome{status, err}
	}()
	gate, err := listener.Accept()
	require.NoError(t, err)
	defer gate.Close()
	// The supervisor and authenticated host now exist, but HTTP observation has
	// not completed. Cancel only the short-lived caller, not either retained owner.
	var record supervisorRecord
	require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &record))
	require.Equal(t, generation, record.Generation)
	require.NoError(t, verifySupervisor(record, w))
	cancel()
	require.Error(t, generationEdgeAwait(t, done).err)
	_, err = gate.Write([]byte{1})
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := m.Down(ctx, w.Manifest.WorkspaceID)
		require.NoError(t, err)
	})
	statusCtx, statusCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer statusCancel()
	status, err := m.Status(statusCtx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, "ready", status.Phase)
	require.Equal(t, generation, status.Generation)
	require.NotNil(t, status.Instance)
	require.NoError(t, verifySupervisor(record, w))
	data, err := os.ReadFile(starts)
	require.NoError(t, err)
	require.Equal(t, 1, bytes.Count(data, []byte{'\n'}))
	stopped, err := m.Down(statusCtx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, generation, stopped.Generation)
	require.Equal(t, "stopped", stopped.Phase)
}

func TestGenerationEdgesDownWaitsForCapturedSourceUpdateWithoutResurrection(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	target := upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	entered, release := activeFollowBarrier(t, m, w)
	updateCtx, cancelUpdate := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelUpdate()
	updateDone := make(chan error, 1)
	go func() {
		_, err := m.Update(updateCtx, w.Manifest.WorkspaceID, UpdateOptions{})
		updateDone <- err
	}()
	var child *ownedChild
	select {
	case child = <-entered:
	case <-updateCtx.Done():
		t.Fatal("source update did not reach durable captured-cohort barrier")
	}
	t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
	captured, err := readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, sourceUpdateOverlays, captured.Phase)
	require.Equal(t, target, captured.Plan.Repositories[0].TargetSHA)
	directory, err := followDirectory(m, w)
	require.NoError(t, err)
	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)
	defer watcher.Close()
	require.NoError(t, watcher.Add(directory))
	downCtx, cancelDown := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelDown()
	downDone := make(chan generationEdgeOutcome, 1)
	go func() {
		status, err := m.Down(downCtx, w.Manifest.WorkspaceID)
		downDone <- generationEdgeOutcome{status, err}
	}()
	fenced := false
	for !fenced {
		select {
		case event := <-watcher.Events:
			fenced = event.Name == filepath.Join(directory, "follow-fence.json")
		case err := <-watcher.Errors:
			require.NoError(t, err)
		case <-downCtx.Done():
			t.Fatal("down did not publish its foreground consent fence")
		}
	}
	select {
	case result := <-downDone:
		t.Fatalf("down returned before active update relinquished authority: %v", result.err)
	default:
	}
	release()
	select {
	case err := <-updateDone:
		require.Error(t, err)
	case <-updateCtx.Done():
		t.Fatal("active source update did not reach a terminal outcome")
	}
	result := generationEdgeAwait(t, downDone)
	require.NoError(t, result.err)
	require.Equal(t, "stopped", result.status.Phase)
	select {
	case <-child.done:
	default:
		t.Fatal("down completed before active producer disposal")
	}
	retained, err := readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, captured, retained)
	require.Equal(t, target, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
	require.NoFileExists(t, launchPath(w, "supervisor.json"))
}

func generationEdgeLaunchOptions(w Workspace) LaunchOptions {
	revision := w.Manifest.Repositories[0].BaseCommit
	for _, repository := range w.Manifest.Repositories {
		if repository.ID == "plugin-sdk" {
			revision = repository.BaseCommit
		}
	}
	return LaunchOptions{Mode: "browser", ReviewedSDKRevision: revision, Timeout: 10 * time.Second}
}
