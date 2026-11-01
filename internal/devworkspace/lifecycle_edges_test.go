//go:build darwin || linux

package devworkspace

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

type lifecycleEdgeConfig struct {
	Root, Home, Action, Name string
	Create                   CreateOptions
	Edit                     EditOptions
	DeleteBranches           bool
	Gate, Git, GitDirectory  string
	GitCommand               string
	AfterGit                 bool
}

type lifecycleEdgeResult struct {
	Workspace Workspace
	Removal   RemoveResult
	Code      string
	Error     string
}

// Each operation runs with its own environment and Manager. The Git shim runs
// real Git before/after a pipe-equivalent TCP barrier; it never supplies output.
func TestLifecycleEdgeProcess(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_LIFECYCLE_EDGE_MODE")
	if mode == "" {
		return
	}
	var config lifecycleEdgeConfig
	require.NoError(t, json.Unmarshal([]byte(os.Getenv("OMNIVIEW_LIFECYCLE_EDGE_CONFIG")), &config))
	if mode == "git" {
		args := os.Args
		for len(args) != 0 && args[0] != "--" {
			args = args[1:]
		}
		require.NotEmpty(t, args)
		args = args[1:]
		matched := false
		if len(args) >= 4 && args[0] == "-C" {
			actual, actualErr := os.Stat(args[1])
			target, targetErr := os.Stat(config.GitDirectory)
			matched = actualErr == nil && targetErr == nil && os.SameFile(actual, target) && strings.Contains(strings.Join(args[2:], " "), config.GitCommand)
		}
		gate := func() {
			if matched {
				lifecycleEdgeGate(t, config.Gate)
			}
		}
		if !config.AfterGit {
			gate()
		}
		command := exec.Command(config.Git, args...)
		command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
		err := command.Run()
		if err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				os.Exit(exit.ExitCode())
			}
			t.Fatal(err)
		}
		if config.AfterGit {
			gate()
		}
		os.Exit(0)
	}
	var m *Manager
	var err error
	if config.Action != "registry" && config.Action != "collections" {
		m, err = Open(config.Root, Options{Home: config.Home, Stopped: func(context.Context, devcontract.ResolvedWorkspace) error { return nil }})
		require.NoError(t, err)
	}
	protocol := os.NewFile(3, "lifecycle-protocol")
	defer protocol.Close()
	input := bufio.NewReader(os.Stdin)
	require.NoError(t, json.NewEncoder(protocol).Encode("ready"))
	_, err = input.ReadString('\n')
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		if _, err := input.ReadString('\n'); err == nil {
			cancel()
		}
	}()
	var result lifecycleEdgeResult
	switch config.Action {
	case "registry":
		_, err = LoadRegistry(ctx, config.Root)
	case "collections":
		_, err = DiscoverCollections(ctx, filepath.Join(config.Root, "omniview"))
	case "create":
		result.Workspace, err = m.Create(ctx, config.Create)
	case "edit":
		result.Workspace, err = m.Edit(ctx, config.Name, config.Edit)
	case "resume":
		result.Workspace, err = m.Resume(ctx, config.Name)
	case "remove":
		options := RemoveOptions{DeleteBranches: config.DeleteBranches}
		if config.Gate != "" && config.GitCommand == "" {
			options.BeforeRemove = func(context.Context, Workspace, []GuardFile) error {
				lifecycleEdgeGate(t, config.Gate)
				return nil
			}
		}
		result.Removal, err = m.Remove(ctx, config.Name, options)
	default:
		t.Fatalf("unknown lifecycle operation %q", config.Action)
	}
	if err != nil {
		result.Error = err.Error()
		if failure := workspaceError(err); failure != nil {
			result.Code = failure.Code
		}
		if errors.Is(err, context.Canceled) {
			result.Code = "context_canceled"
		}
	}
	require.NoError(t, json.NewEncoder(protocol).Encode(result))
	os.Exit(0)
}

func lifecycleEdgeGate(t *testing.T, endpoint string) {
	t.Helper()
	connection, err := net.DialTimeout("tcp", endpoint, 10*time.Second)
	require.NoError(t, err)
	defer connection.Close()
	require.NoError(t, connection.SetDeadline(time.Now().Add(20*time.Second)))
	_, err = io.CopyN(io.Discard, connection, 1)
	require.NoError(t, err)
}

type lifecycleEdgeProcess struct {
	input              io.WriteCloser
	output             *json.Decoder
	cmd                *exec.Cmd
	log                *os.File
	done               chan struct{}
	value              lifecycleEdgeResult
	decodeErr, waitErr error
}

func startLifecycleEdge(t *testing.T, m *Manager, config lifecycleEdgeConfig) *lifecycleEdgeProcess {
	t.Helper()
	config.Root, config.Home = m.Root, m.options.Home
	binary, err := os.Executable()
	require.NoError(t, err)
	config.Git, err = exec.LookPath("git")
	require.NoError(t, err)
	data, err := json.Marshal(config)
	require.NoError(t, err)
	environment := append(os.Environ(), "OMNIVIEW_LIFECYCLE_EDGE_MODE=operation", "OMNIVIEW_LIFECYCLE_EDGE_CONFIG="+string(data))
	environment = append(environment, "GORACE="+os.Getenv("GORACE")+" atexit_sleep_ms=0")
	if config.GitCommand != "" {
		shim := t.TempDir()
		script := "#!/bin/sh\nOMNIVIEW_LIFECYCLE_EDGE_MODE=git exec \"$OMNIVIEW_LIFECYCLE_EDGE_BINARY\" -test.run=^TestLifecycleEdgeProcess$ -- \"$@\"\n"
		require.NoError(t, os.WriteFile(filepath.Join(shim, "git"), []byte(script), 0700))
		environment = append(environment, "PATH="+shim+string(os.PathListSeparator)+os.Getenv("PATH"), "OMNIVIEW_LIFECYCLE_EDGE_BINARY="+binary)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	p := &lifecycleEdgeProcess{cmd: exec.CommandContext(ctx, binary, "-test.run=^TestLifecycleEdgeProcess$"), done: make(chan struct{})}
	p.cmd.Env = environment
	p.log, err = os.CreateTemp(t.TempDir(), "lifecycle-helper-*.log")
	require.NoError(t, err)
	p.cmd.Stderr, p.cmd.Stdout = p.log, p.log
	p.input, err = p.cmd.StdinPipe()
	require.NoError(t, err)
	output, protocol, err := os.Pipe()
	require.NoError(t, err)
	require.NoError(t, output.SetReadDeadline(time.Now().Add(25*time.Second)))
	p.output = json.NewDecoder(output)
	p.cmd.ExtraFiles = []*os.File{protocol}
	require.NoError(t, p.cmd.Start())
	require.NoError(t, protocol.Close())
	t.Cleanup(func() {
		_ = p.input.Close()
		cancel()
		<-p.done
		_ = output.Close()
		if t.Failed() {
			data, _ := os.ReadFile(p.log.Name())
			t.Logf("lifecycle helper: %s", data)
		}
		_ = p.log.Close()
	})
	var ready string
	readyErr := p.output.Decode(&ready)
	go func() {
		if readyErr == nil {
			p.decodeErr = p.output.Decode(&p.value)
		} else {
			p.decodeErr = readyErr
		}
		p.waitErr = p.cmd.Wait()
		close(p.done)
	}()
	require.NoError(t, readyErr)
	require.Equal(t, "ready", ready)
	return p
}

func (p *lifecycleEdgeProcess) signal(t *testing.T) {
	t.Helper()
	_, err := io.WriteString(p.input, "next\n")
	require.NoError(t, err)
}

func (p *lifecycleEdgeProcess) result(t *testing.T) lifecycleEdgeResult {
	t.Helper()
	<-p.done
	require.NoError(t, p.decodeErr)
	require.NoError(t, p.waitErr)
	return p.value
}

func lifecycleEdgeListener(t *testing.T) *net.TCPListener {
	t.Helper()
	listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.ParseIP("127.0.0.1")})
	require.NoError(t, err)
	require.NoError(t, listener.SetDeadline(time.Now().Add(20*time.Second)))
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

func TestLifecycleEdgesConcurrentSameSlugHasOneDurableWinner(t *testing.T) {
	m, _ := fixtureManager(t)
	config := lifecycleEdgeConfig{Action: "create", Create: CreateOptions{Slug: "one-winner", Repositories: []string{"ui"}}}
	first, second := startLifecycleEdge(t, m, config), startLifecycleEdge(t, m, config)
	first.signal(t)
	second.signal(t)
	a, b := first.result(t), second.result(t)
	require.NotEqual(t, a.Error == "", b.Error == "", "exactly one create must succeed")
	winner, loser := a, b
	if winner.Error != "" {
		winner, loser = b, a
	}
	require.Contains(t, []string{"workspace_busy", "workspace_exists"}, loser.Code)
	items, err := m.List(context.Background())
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, winner.Workspace.Manifest.WorkspaceID, items[0].Manifest.WorkspaceID)
	j, err := loadJournal(winner.Workspace.Root)
	require.NoError(t, err)
	require.Equal(t, "complete", j.Phase)
	for i := range j.Resources {
		require.NoError(t, verifyWorktree(context.Background(), &j.Resources[i], true))
		require.Equal(t, j.Resources[i].Repository.BaseCommit, refValue(context.Background(), j.Resources[i].CommonDir, j.Resources[i].Marker))
	}
	stages, err := filepath.Glob(filepath.Join(m.Root, "workspaces", ".create-*"))
	require.NoError(t, err)
	require.Empty(t, stages)
}

func TestLifecycleEdgesCancelledCreateAfterFirstWorktreeResumesSameIdentity(t *testing.T) {
	m, root := fixtureManager(t)
	listener := lifecycleEdgeListener(t)
	p := startLifecycleEdge(t, m, lifecycleEdgeConfig{Action: "create", Create: CreateOptions{Slug: "cancel-create", Repositories: []string{"ui"}}, Gate: listener.Addr().String(), GitDirectory: filepath.Join(root, "omniview", ".git"), GitCommand: "worktree add", AfterGit: true})
	p.signal(t)
	gate := lifecycleEdgeAccept(t, listener, p)
	defer gate.Close()
	dir := filepath.Join(root, "workspaces", "cancel-create")
	before, err := loadJournal(dir)
	require.NoError(t, err)
	require.Equal(t, "create", before.Phase)
	require.FileExists(t, filepath.Join(dir, "omniview", ".git"))
	p.signal(t)
	result := p.result(t)
	require.NotEmpty(t, result.Error)
	resumed, err := m.Resume(context.Background(), before.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, before.WorkspaceID, resumed.Manifest.WorkspaceID)
	require.Equal(t, "complete", resumed.Phase)
	for _, repo := range resumed.Manifest.Repositories {
		require.Equal(t, repo.BaseCommit, fixtureGit(t, filepath.Join(resumed.Root, repo.Directory), "rev-parse", "HEAD"))
	}
}

func TestLifecycleEdgesLaterEditFailureRetainsWholeIntent(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "partial-edit"})
	require.NoError(t, err)
	reg, err := LoadRegistry(ctx, root)
	require.NoError(t, err)
	planned, err := m.plan(ctx, reg, CreateOptions{Slug: w.Manifest.Slug, workspaceID: w.Manifest.WorkspaceID, Repositories: []string{"plugin-sdk", "ui"}})
	require.NoError(t, err)
	var ui devcontract.Repository
	for _, repo := range planned.Repositories {
		if repo.ID == "ui" {
			ui = repo
		}
	}
	require.NotEmpty(t, ui.Branch)
	common := filepath.Join(root, "ui", ".bare")
	foreign := "refs/heads/" + ui.Branch + "/foreign"
	fixtureGit(t, common, "update-ref", foreign, ui.BaseCommit)
	_, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{AddRepositories: []string{"plugin-sdk", "ui"}})
	require.Error(t, err)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	require.Equal(t, "edit", j.Phase)
	require.Len(t, j.Manifest.Repositories, 3)
	require.DirExists(t, filepath.Join(w.Root, "plugin-sdk"))
	require.Equal(t, ui.BaseCommit, refValue(ctx, common, foreign))
	manifest, err := readManifest(w.Root)
	require.NoError(t, err)
	require.Len(t, manifest.Repositories, 1, "partial source cohort must not publish as complete")
	fixtureGit(t, common, "update-ref", "-d", foreign)
	resumed, err := m.Resume(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, w.Manifest.WorkspaceID, resumed.Manifest.WorkspaceID)
	require.Len(t, resumed.Manifest.Repositories, 3)
	require.Equal(t, "complete", resumed.Phase)
}

func TestLifecycleEdgesCancelledRemovalAfterFirstDeletionKeepsOriginalFlags(t *testing.T) {
	m, root := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "partial-remove", Repositories: []string{"ui"}})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
	sentinel := filepath.Join(w.StateRoot, "retained-user-state")
	require.NoError(t, os.WriteFile(sentinel, []byte("keep"), 0600))
	listener := lifecycleEdgeListener(t)
	p := startLifecycleEdge(t, m, lifecycleEdgeConfig{Action: "remove", Name: w.Manifest.WorkspaceID, DeleteBranches: true, Gate: listener.Addr().String(), GitDirectory: filepath.Join(root, "ui", ".bare"), GitCommand: "worktree remove"})
	p.signal(t)
	gate := lifecycleEdgeAccept(t, listener, p)
	defer gate.Close()
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	require.Equal(t, "remove", j.Phase)
	require.True(t, j.Resources[0].Removed)
	require.NoDirExists(t, filepath.Join(w.Root, "omniview"))
	p.signal(t)
	require.NotEmpty(t, p.result(t).Error)
	_, err = m.Remove(context.Background(), w.Manifest.WorkspaceID, RemoveOptions{PurgeState: true})
	require.Error(t, err, "pending removal cannot change deletion/purge authority")
	require.FileExists(t, sentinel)
	_, err = m.Resume(context.Background(), w.Manifest.WorkspaceID)
	require.Error(t, err)
	result, err := m.Remove(context.Background(), w.Manifest.WorkspaceID, RemoveOptions{DeleteBranches: true})
	require.NoError(t, err)
	require.True(t, result.StateRetained)
	require.FileExists(t, sentinel)
	require.NoDirExists(t, w.Root)
	for _, r := range j.Resources {
		require.Empty(t, refValue(context.Background(), r.CommonDir, "refs/heads/"+r.Repository.Branch))
		require.Empty(t, refValue(context.Background(), r.CommonDir, r.Marker))
	}
}

func TestLifecycleEdgesRemoveContendsWithRemoveEditAndResume(t *testing.T) {
	for _, action := range []string{"remove", "edit", "resume"} {
		t.Run(action, func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "retiring"})
			require.NoError(t, err)
			foreign, err := m.Create(ctx, CreateOptions{Slug: "unrelated", Repositories: []string{"ui"}})
			require.NoError(t, err)
			require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
			sentinel := filepath.Join(w.StateRoot, "keep-state")
			require.NoError(t, os.WriteFile(sentinel, []byte("keep"), 0600))
			listener := lifecycleEdgeListener(t)
			remover := startLifecycleEdge(t, m, lifecycleEdgeConfig{Action: "remove", Name: w.Manifest.WorkspaceID, Gate: listener.Addr().String()})
			remover.signal(t)
			gate := lifecycleEdgeAccept(t, listener, remover)
			defer gate.Close()
			name := "must-not-publish"
			contender := startLifecycleEdge(t, m, lifecycleEdgeConfig{Action: action, Name: w.Manifest.WorkspaceID, Edit: EditOptions{DisplayName: &name}})
			contender.signal(t)
			require.Equal(t, "workspace_busy", contender.result(t).Code)
			_, err = gate.Write([]byte{1})
			require.NoError(t, err)
			require.Empty(t, remover.result(t).Error)
			require.NoDirExists(t, w.Root)
			require.FileExists(t, sentinel)
			require.NoError(t, devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID))
			for _, repo := range w.Manifest.Repositories {
				require.Equal(t, repo.BaseCommit, fixtureGit(t, filepath.Join(m.Root, repo.Directory), "rev-parse", repo.Branch))
			}
			after, err := m.Inspect(ctx, foreign.Manifest.WorkspaceID)
			require.NoError(t, err)
			require.Equal(t, foreign.Manifest, after.Manifest)
			for _, repo := range foreign.Manifest.Repositories {
				require.Equal(t, repo.BaseCommit, fixtureGit(t, filepath.Join(after.Root, repo.Directory), "rev-parse", "HEAD"))
			}
		})
	}
}

func TestLifecycleEdgesRollbackRetainsLiveOutputWriterEvidence(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	hostSource := filepath.Join(m.Root, "omniview")
	require.NoError(t, os.WriteFile(filepath.Join(hostSource, "package.json"), []byte("{\"name\":\"rollback-host\",\"private\":true}\n"), 0600))
	fixtureGit(t, hostSource, "add", "package.json")
	fixtureGit(t, hostSource, "commit", "-m", "add producer manifest")
	reg, err := LoadRegistry(ctx, m.Root)
	require.NoError(t, err)
	manifest, err := m.plan(ctx, reg, CreateOptions{Slug: "rollback-writer"})
	require.NoError(t, err)
	stage, j, err := m.prepareCreate(manifest, reg)
	require.NoError(t, err)
	root, err := m.publishCreate(stage, j)
	require.NoError(t, err)
	require.NoError(t, m.addWorktree(ctx, root, j, &j.Resources[0]))
	w, err := m.inspectRoot(root)
	require.NoError(t, err)
	host, err := w.RepositoryPath("omniview")
	require.NoError(t, err)
	writer, err := devoutputs.BeginInstall(ctx, w.ResolvedWorkspace, host)
	require.NoError(t, err)
	// Finish is allowed only after the producer stops; keep this capability live
	// throughout the refusal and prove its evidence still permits finalization.
	err = m.Rollback(ctx, w.Manifest.WorkspaceID)
	require.Error(t, err)
	require.DirExists(t, host)
	after, err := loadJournal(root)
	require.NoError(t, err)
	require.Equal(t, j.WorkspaceID, after.WorkspaceID)
	require.Equal(t, "create", after.Phase)
	require.NoError(t, verifyWorktree(ctx, &after.Resources[0], true))
	require.NoError(t, writer.Finish(ctx))
	require.NoError(t, m.Rollback(ctx, w.Manifest.WorkspaceID))
	require.NoDirExists(t, root)
}

func lifecycleEdgeAccept(t *testing.T, listener *net.TCPListener, process *lifecycleEdgeProcess) net.Conn {
	t.Helper()
	type accepted struct {
		connection net.Conn
		err        error
	}
	done := make(chan accepted, 1)
	go func() {
		connection, err := listener.Accept()
		done <- accepted{connection, err}
	}()
	select {
	case result := <-done:
		require.NoError(t, result.err)
		return result.connection
	case <-process.done:
		_ = listener.Close()
		result := <-done
		if result.connection != nil {
			_ = result.connection.Close()
		}
		value := process.result(t)
		t.Fatalf("lifecycle helper ended before Git/operation barrier: code=%s error=%s", value.Code, value.Error)
		return nil
	}
}

func TestRegistryAndCollectionsCancelDuringSourceGitValidation(t *testing.T) {
	for _, action := range []string{"registry", "collections"} {
		for _, command := range []string{"rev-parse", "config --get remote.origin.url"} {
			t.Run(action+"/"+command, func(t *testing.T) {
				m, root := fixtureManager(t)
				fixtureGit(t, filepath.Join(root, "omniview"), "remote", "add", "origin", "https://example.invalid/host.git")
				listener := lifecycleEdgeListener(t)
				p := startLifecycleEdge(t, m, lifecycleEdgeConfig{
					Action: action, Gate: listener.Addr().String(),
					GitDirectory: filepath.Join(root, "omniview", ".git"),
					GitCommand:   command, AfterGit: true,
				})
				p.signal(t)
				gate := lifecycleEdgeAccept(t, listener, p)
				defer gate.Close()
				p.signal(t)
				require.Equal(t, "context_canceled", p.result(t).Code)
			})
		}
	}
}
