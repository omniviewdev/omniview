package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

var errSupervisorExecutableForbidden = errors.New("test attempted to resolve a supervisor executable")

// forbidSupervisorExecutable is the injected resolver for tests that must never
// launch a supervisor: reaching it is the observable "launch preconditions met".
func forbidSupervisorExecutable() (string, error) { return "", errSupervisorExecutableForbidden }

// mustEnvironment is the supervisor child environment of a fixture whose
// selected SDK resolves.
func mustEnvironment(t testing.TB, s *workspaceSupervisor) []string {
	t.Helper()
	environment, err := s.environment()
	require.NoError(t, err)
	return environment
}

// A typed error raised inside a build node must cross the real supervisor
// status transport with its code, and recover its exit class on the controller.
func TestTypedBuildNodeErrorsKeepCodeAndExitAcrossSupervisorTransport(t *testing.T) {
	g := graphFixture(t)
	g.workspace.ManifestPath = filepath.Join(g.workspace.Root, "workspace.json")
	s := &workspaceSupervisor{
		manager: &Manager{Root: filepath.Dir(filepath.Dir(g.workspace.Root)), options: Options{Home: t.TempDir()}}, workspace: g.workspace,
		generation: g.options.Generation, status: Status{Workspace: g.workspace, Generation: g.options.Generation, Phase: "building"},
	}
	g.options.OnEvent = func(event BuildEvent) {
		if event.Phase == "error" {
			s.status.LastError = supervisedBuildError(event, g.workspace)
			s.status.Phase = "build-error"
		}
	}
	base := outputGraphNode(t, g, "base-ui")
	token := []byte("typed-build-error-authenticated-token")
	server := httptest.NewServer(supervisorHandler(g.workspace.Manifest.WorkspaceID, g.options.Generation, token, s.execute))
	defer server.Close()
	record := supervisorRecord{WorkspaceID: g.workspace.Manifest.WorkspaceID, Generation: g.options.Generation, Endpoint: server.URL + "/v1/supervisor"}
	for _, test := range []struct {
		name, code string
		cause      error
		exit       int
	}{
		{"prerequisite", "peer_contract_mismatch", devcontract.Fail(3, "peer_contract_mismatch", "typed prerequisite refusal"), 3},
		{"ownership conflict class", "invalid_journal", devcontract.Fail(4, "invalid_journal", "typed ownership refusal"), 4},
		{"joined with tool output", "generated_cleanup_pending", errors.Join(errors.New("go failed:\ncompiler text"), devcontract.Fail(4, "generated_cleanup_pending", "typed cleanup refusal")), 4},
		{"untyped failure", "build_failed", errors.New("compiler token=secret-output"), 5},
	} {
		t.Run(test.name, func(t *testing.T) {
			s.status.LastError, s.status.Phase = nil, "building"
			g.runProducer = func(context.Context, string, []string, string, ...string) ([]byte, error) { return nil, test.cause }
			require.Error(t, g.execute(context.Background(), []BuildNode{base}, nil))
			require.NotNil(t, s.status.LastError)
			status, err := callSupervisor(context.Background(), record, token, supervisorStatusCommand)
			require.NoError(t, err)
			require.NotNil(t, status.LastError)
			require.Equal(t, test.code, status.LastError.Code, "a typed node error must not be flattened to build_failed")
			require.Zero(t, status.LastError.Exit, "Exit is not serialized; only the code crosses")
			controller := workspaceOwnershipError(status.LastError, g.workspace)
			require.Equal(t, test.code, controller.Code)
			require.Equal(t, test.exit, controller.Exit)
			require.NotContains(t, controller.Message, "secret-output")
		})
	}
}

// sdkSourceProbe prints every environment entry whose name is SDK_SOURCE in
// any letter case, which is what a case-insensitive (Windows) environment would
// resolve to the Taskfile's variable.
func sdkSourceProbe(t *testing.T) (program string, script string) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node is required for command environment behavior")
	}
	return node, `const found = {}; for (const [key, value] of Object.entries(process.env)) if (key.toLowerCase() === "sdk_source") found[key] = value; process.stdout.write(JSON.stringify(found))`
}

// An exported SDK_SOURCE would make the Taskfile replace the SDK with a
// checkout the verifier never observed, so only the selected source may set it.
func TestOwnedCommandsNeverInheritAmbientSDKSource(t *testing.T) {
	node, script := sdkSourceProbe(t)
	t.Setenv("SDK_SOURCE", "/ambient/sdk-overlay")
	t.Setenv("sdk_source", "/ambient/lowercase-overlay")
	t.Setenv("Sdk_Source", "/ambient/mixed-case-overlay")
	g := graphFixture(t)
	read := func(raw []byte) map[string]string {
		found := map[string]string{}
		require.NoError(t, json.Unmarshal(raw, &found))
		return found
	}
	raw, err := g.command(context.Background(), g.workspace.Root, node, "-e", script)
	require.NoError(t, err)
	require.Empty(t, read(raw), "an ambient value reached a graph command")
	raw, err = g.commandWithEnvironment(context.Background(), g.workspace.Root, []string{"SDK_SOURCE=/selected/sdk"}, node, "-e", script)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"SDK_SOURCE": "/selected/sdk"}, read(raw), "the selected source must still be the only value that can set it")
	raw, err = linkCommand(context.Background(), g.workspace.Root, node, "-e", script)
	require.NoError(t, err)
	require.Empty(t, read(raw), "an ambient value reached a dependency command")
}

func TestSDKSourceEnvironmentMatchesOnlyThatVariableInAnyCase(t *testing.T) {
	for _, key := range []string{"SDK_SOURCE", "sdk_source", "Sdk_Source", "sDK_sOURCE"} {
		require.True(t, sdkSourceEnvironment(key), key)
	}
	for _, key := range []string{"", "SDK_SOURCES", "NOT_SDK_SOURCE", "SDK_SOURCE_", "SDK-SOURCE", "SDK_SOURC"} {
		require.False(t, sdkSourceEnvironment(key), key)
	}
}

// sdkSourceEntries returns every entry named SDK_SOURCE in any letter case.
func sdkSourceEntries(env []string) []string {
	var entries []string
	for _, entry := range env {
		if key, _, _ := strings.Cut(entry, "="); strings.EqualFold(key, "SDK_SOURCE") {
			entries = append(entries, entry)
		}
	}
	return entries
}

// effectiveEnvironmentValue resolves name the way a child process does for a
// block with duplicates: the last entry wins, and on Windows names compare
// case-insensitively.
func effectiveEnvironmentValue(env []string, name string, caseInsensitive bool) (string, bool) {
	value, found := "", false
	for _, entry := range env {
		key, entryValue, _ := strings.Cut(entry, "=")
		if key == name || caseInsensitive && strings.EqualFold(key, name) {
			value, found = entryValue, true
		}
	}
	return value, found
}

// The workspace child environment sets SDK_SOURCE only from the selected SDK,
// whatever letter case an ambient variable uses. The case-insensitive leg is
// what a Windows child resolves; a case-sensitive filter fails it in published
// mode (the variant would be the only SDK_SOURCE) and by leaving two entries in
// source mode.
func TestWorkspaceEnvironmentStripsEveryCaseVariantOfSDKSource(t *testing.T) {
	g := graphFixture(t)
	selected := sdkDirectory(t, g)
	published := g.workspace
	published.Manifest.Links.SDKRepositoryID = nil
	for _, variant := range []string{"SDK_SOURCE", "sdk_source", "Sdk_Source", "sDK_sOURCE"} {
		t.Run(variant, func(t *testing.T) {
			ambient := []string{"HOME=/unchanged", variant + "=/ambient/sdk-overlay", "NOT_SDK_SOURCE=/kept", "SDK_SOURCE_NOTES=/kept"}
			env, err := workspaceEnvironment(ambient, g.workspace, "generation", LaunchOptions{})
			require.NoError(t, err)
			require.Equal(t, []string{"SDK_SOURCE=" + selected}, sdkSourceEntries(env), "an ambient %s entry survived beside the selected value", variant)
			for _, caseInsensitive := range []bool{false, true} {
				value, found := effectiveEnvironmentValue(env, "SDK_SOURCE", caseInsensitive)
				require.True(t, found)
				require.Equal(t, selected, value, "case-insensitive=%t", caseInsensitive)
			}
			require.Contains(t, env, "NOT_SDK_SOURCE=/kept", "unrelated names are not SDK_SOURCE")
			require.Contains(t, env, "SDK_SOURCE_NOTES=/kept", "unrelated names are not SDK_SOURCE")

			env, err = workspaceEnvironment(ambient, published, "generation", LaunchOptions{})
			require.NoError(t, err)
			require.Empty(t, sdkSourceEntries(env), "a published selection must not inherit an %s overlay", variant)
			for _, caseInsensitive := range []bool{false, true} {
				_, found := effectiveEnvironmentValue(env, "SDK_SOURCE", caseInsensitive)
				require.False(t, found, "case-insensitive=%t resolved an ambient overlay", caseInsensitive)
			}
		})
	}
}

// An unresolvable selection must fail the environment, not hand back one that
// dropped the ambient value but never gained the selected one.
func TestWorkspaceEnvironmentRefusesAnUnresolvableSDKSelection(t *testing.T) {
	g := graphFixture(t)
	broken := g.workspace
	missing := "absent-sdk"
	broken.Manifest.Links.SDKRepositoryID = &missing
	env, err := workspaceEnvironment([]string{"sdk_source=/ambient/sdk-overlay"}, broken, "generation", LaunchOptions{})
	require.Error(t, err)
	require.Nil(t, env, "no environment may be handed out when the selected SDK cannot be resolved")
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure, "the typed selection failure must stay classifiable")
	require.Equal(t, "missing_repository", failure.Code)

	supervisor := &workspaceSupervisor{workspace: broken, generation: "generation"}
	_, err = supervisor.environment()
	require.ErrorAs(t, err, &failure, "the supervisor environment must propagate the same refusal")
}

// The bindings task is the production path an ambient SDK_SOURCE would flip.
func TestBindingsTaskNeverSeesAmbientSDKSource(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the capture task is a POSIX shell script")
	}
	bin, capture := t.TempDir(), filepath.Join(t.TempDir(), "task-env")
	require.NoError(t, os.WriteFile(filepath.Join(bin, "task"), []byte("#!/bin/sh\nprintf '%s' \"${SDK_SOURCE-unset}\" > \"$CAPTURE_FILE\"\nexit 1\n"), 0o700))
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CAPTURE_FILE", capture)
	t.Setenv("SDK_SOURCE", "/ambient/sdk-overlay")
	g := graphFixture(t)
	node := outputGraphNode(t, g, "bindings")
	real := g.command
	g.run = func(ctx context.Context, directory, program string, args ...string) ([]byte, error) {
		if program == "task" {
			return real(ctx, directory, program, args...)
		}
		return json.Marshal(map[string]any{"Path": devsdk.Module, "Dir": sdkDirectory(t, g)})
	}
	g.options.Bindings = nil
	require.Error(t, g.buildNode(context.Background(), node), "the capture task fails the build by design")
	raw, err := os.ReadFile(capture)
	require.NoError(t, err)
	require.Equal(t, "unset", string(raw), "the ambient SDK_SOURCE reached the bindings task")
}

func TestWatchRootsAndSDKContainmentFollowTheSelection(t *testing.T) {
	g := graphFixture(t)
	sdk := sdkDirectory(t, g)
	roots := g.watchRoots()
	require.Equal(t, sdk, roots[0], "a selected SDK checkout is watched first")
	require.Len(t, roots, len(g.workspace.Manifest.Repositories), "the SDK checkout is watched exactly once")
	require.True(t, g.sdkContains(sdk))
	require.True(t, g.sdkContains(filepath.Join(sdk, "pkg", "state", "root.go")))
	require.False(t, g.sdkContains(sdk+"-sibling/file.go"), "a sibling with the same prefix is not inside the checkout")
	changed, err := g.affected([]string{filepath.Join(sdk, "api.go")})
	require.NoError(t, err)
	require.Subset(t, nodeIDs(changed), []string{"bindings", "host-backend"}, "an SDK checkout edit rebuilds bindings and the host")

	g.plan.SDK = devsdk.PublishedSelection()
	published := g.watchRoots()
	require.Len(t, published, len(g.workspace.Manifest.Repositories))
	require.NotContains(t, published, "", "a published SDK must never add an empty watch root")
	require.False(t, g.sdkContains(sdk), "a published SDK has no checkout to contain paths")
	require.False(t, g.sdkContains(""))
	changed, err = g.affected([]string{filepath.Join(sdk, "api.go")})
	require.NoError(t, err)
	require.Empty(t, nodeIDs(changed), "SDK checkout edits are not SDK changes when no checkout is selected")
}

func nodeIDs(nodes []BuildNode) []string {
	var ids []string
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	return ids
}

// Start and Restart resolve the supervisor executable through the manager, so a
// test can never exec its own binary when launch preconditions are met.
func TestStartAndRestartResolveTheSupervisorExecutableThroughTheManager(t *testing.T) {
	m, _ := fixtureManager(t)
	resolved := 0
	m.options.Executable = func() (string, error) {
		resolved++
		return forbidSupervisorExecutable()
	}
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "executable-seam", Repositories: []string{"plugin-sdk"}})
	require.NoError(t, err)
	options := LaunchOptions{Mode: "browser"}
	require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), options))

	_, err = m.Restart(ctx, w.Manifest.WorkspaceID)
	require.ErrorIs(t, err, errSupervisorExecutableForbidden)
	_, err = m.Start(ctx, w.Manifest.WorkspaceID, options, "", io.Discard)
	require.ErrorIs(t, err, errSupervisorExecutableForbidden)
	require.Equal(t, 2, resolved)

	_, err = m.Start(ctx, w.Manifest.WorkspaceID, options, "/must-not-launch", io.Discard)
	require.Error(t, err)
	require.NotErrorIs(t, err, errSupervisorExecutableForbidden)
	require.Equal(t, 2, resolved, "an explicit executable must bypass the resolver")
}
