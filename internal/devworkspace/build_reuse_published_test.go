package devworkspace

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
	"github.com/omniviewdev/omniview/internal/instance"
)

// These tests run real `go` commands against real published releases served by a
// hermetic scratch world (see pubEnv), so the binaries they reuse carry real Go
// build information.

// selectRelease rewrites a consumer's module files to require release, the way a
// branch changing its SDK dependency would.
func (e *pubEnv) selectRelease(directory, module string, release sdktest.Release) {
	e.t.Helper()
	pubWrite(e.t, filepath.Join(directory, "go.mod"), pubGoMod(module, "", release, e.uuid))
	pubWrite(e.t, filepath.Join(directory, "go.sum"), pubSums(release, e.uuid))
}

// commitFixtureRepositories makes the workspace's repositories real git
// repositories, as reuse fingerprints read the selected source from git.
func commitFixtureRepositories(t *testing.T, w Workspace) {
	t.Helper()
	for _, repository := range w.Manifest.Repositories {
		directory := filepath.Join(w.Root, repository.Directory)
		fixtureGit(t, directory, "init")
		fixtureGit(t, directory, "add", ".")
		fixtureGit(t, directory, "commit", "-m", "fixture source")
	}
}

// reuseGraph is a published graph over the workspace with a reuse record file,
// its producer log captured.
func (e *pubEnv) reuseGraph(w Workspace, hostBuild func(context.Context, HostBuildRequest) error) (*BuildGraph, *bytes.Buffer) {
	e.t.Helper()
	g := e.graph(w, hostBuild)
	var log bytes.Buffer
	g.options.Output = &lockedWriter{writer: &log}
	g.toolInputs = g.toolchainInputs
	g.reusePath = filepath.Join(e.t.TempDir(), "build-reuse.json")
	return g, &log
}

func pluginBackendNode(w Workspace) BuildNode {
	return BuildNode{ID: "plugin-backend:plugin", Kind: "plugin-backend", PluginID: "plugin", Directory: filepath.Join(w.Root, "plugin")}
}

// A published plugin binary built against another release is never re-attested
// on reuse: the buildinfo check refuses it before any evidence is written, and
// the graph rebuilds the node against the current release instead.
func TestBuildReuseRefusesAPluginBinaryBuiltAgainstAnotherReleaseAndRebuilds(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	commitFixtureRepositories(t, w)
	g, log := env.reuseGraph(w, nil)
	node := pluginBackendNode(w)
	g.Nodes = []BuildNode{node}
	ctx := context.Background()

	// A real binary built (and attested) against the OTHER release.
	env.selectRelease(node.Directory, "example.com/plugin", env.other)
	require.NoError(t, g.buildNode(ctx, node))
	otherIdentity, attested := g.attestedIdentity("plugin")
	require.True(t, attested)
	require.Equal(t, env.other.Published(), mustPublished(t, otherIdentity))
	binary := filepath.Join(w.Root, ".local", "build", "plugin", "plugin")
	// The production release policy behind the host's own artifact record does not
	// review the world's second release, so only the graph's buildinfo check is
	// exercised here.

	// The plugin now selects the floor release again; its published output is
	// still the other release's binary, untouched since its publication.
	env.selectRelease(node.Directory, "example.com/plugin", env.sdk)
	_, err := g.reuseOutputs(ctx, node)
	pubRequireCode(t, err, devsdk.CodeIdentityChanged, 4)
	stillAttested, _ := g.attestedIdentity("plugin")
	require.Equal(t, otherIdentity, stillAttested, "a refused reuse must not attest the floor release")

	// Through the graph: a record whose fingerprint and output digest still
	// match makes the node a reuse candidate; the refusal rebuilds it.
	inputs, err := g.nodeInputs(ctx, node)
	require.NoError(t, err)
	digest, err := g.outputDigest(ctx, node)
	require.NoError(t, err)
	state := g.loadBuildReuse()
	require.NoError(t, g.setBuildReuse(state, node.ID, buildReuseRecord{Inputs: inputs, Outputs: digest}))
	builds := pubGoShim(t)

	require.NoError(t, g.produce(ctx, node, state))

	require.Len(t, pubInvocationsOf(t, builds, "build"), 1, "the refused reuse must rebuild exactly once")
	require.Contains(t, log.String(), "build reuse: plugin-backend:plugin: rebuilding")
	require.NotContains(t, log.String(), "skipped")
	rebuilt, _ := g.attestedIdentity("plugin")
	require.Equal(t, env.sdk.Published(), mustPublished(t, rebuilt), "the rebuilt binary is attested under the current release")
	require.NoError(t, devsdk.VerifyBinary("plugin", binary, rebuilt))
	require.NoError(t, instance.VerifyPluginArtifact(w.ResolvedWorkspace, "plugin", binary))

	// And with nothing wrong, the next run reuses it without building.
	again := g.loadBuildReuse()
	require.NotEmpty(t, again.Nodes[node.ID].Inputs, "the rebuilt node is recorded for reuse")
	require.NoError(t, g.produce(ctx, node, again))
	require.Len(t, pubInvocationsOf(t, builds, "build"), 1, "an unchanged node is reused, not rebuilt")
	require.Contains(t, log.String(), "inputs and outputs unchanged, skipped")
}

func mustPublished(t *testing.T, identity devsdk.Identity) devsdk.Published {
	t.Helper()
	published, ok := identity.Published()
	require.True(t, ok)
	return published
}

// The fingerprint names the SDK observed before the build. If the SDK moved
// before the build's own verification, the build attested another identity and
// no reuse record may name the stale one.
func TestBuildReuseStoresNoRecordWhenTheSDKMovedAfterFingerprinting(t *testing.T) {
	for _, moved := range []bool{false, true} {
		name := "unchanged"
		if moved {
			name = "moved"
		}
		t.Run(name, func(t *testing.T) {
			env := newPubEnv(t)
			w := env.workspace()
			env.activate()
			commitFixtureRepositories(t, w)
			g, log := env.reuseGraph(w, nil)
			node := pluginBackendNode(w)
			g.Nodes = []BuildNode{node}
			g.toolInputs = func(ctx context.Context, n BuildNode) (string, error) {
				fingerprint, err := g.toolchainInputs(ctx, n)
				if moved && err == nil {
					env.selectRelease(node.Directory, "example.com/plugin", env.other) // after the fingerprint was taken
				}
				return fingerprint, err
			}
			state := g.loadBuildReuse()

			require.NoError(t, g.produce(context.Background(), node, state))

			attested, ok := g.attestedIdentity("plugin")
			require.True(t, ok)
			stored := g.loadBuildReuse().Nodes[node.ID]
			if !moved {
				require.Equal(t, env.sdk.Published(), mustPublished(t, attested))
				require.NotEmpty(t, stored.Inputs, "the bound build is recorded for reuse")
				return
			}
			require.Equal(t, env.other.Published(), mustPublished(t, attested), "the build ran under the moved SDK")
			require.Empty(t, stored.Inputs, "a record fingerprinted under another SDK must not be stored")
			require.Empty(t, stored.Outputs)
			require.Empty(t, state.Nodes[node.ID].Inputs)
			require.Contains(t, log.String(), "not recorded for reuse")
		})
	}
}

// hostReuseFixture publishes a real host binary built against the floor release
// as the supervisor's browser host output, the tree reuse adopts.
func (e *pubEnv) hostReuseFixture(w Workspace) (*workspaceSupervisor, string) {
	t := e.t
	t.Helper()
	s := &workspaceSupervisor{workspace: w, options: LaunchOptions{Mode: "browser"}}
	prepared, err := PrepareGeneratedTree(w, s.hostOutput(), NewGeneration())
	require.NoError(t, err)
	staged := filepath.Join(prepared.Directory, s.hostLaunchRelative())
	require.NoError(t, os.MkdirAll(filepath.Dir(staged), 0o700))
	_, err = e.run()(context.Background(), filepath.Join(w.Root, "omniview"), nil, "build", "-mod=readonly", "-o", staged, ".")
	require.NoError(t, err)
	require.NoError(t, RecordGeneratedTree(prepared))
	return s, filepath.Join(prepared.Destination, s.hostLaunchRelative())
}

// The host is adopted on reuse only when its own buildinfo names the release the
// graph just verified.
func TestHostReuseVerifiesThePublishedBinaryBeforeAdoptingIt(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	s, binary := env.hostReuseFixture(w)
	ctx := context.Background()
	floor, err := devsdk.NewPublishedIdentity(env.sdk.Published())
	require.NoError(t, err)
	other, err := devsdk.NewPublishedIdentity(env.other.Published())
	require.NoError(t, err)

	refused := &workspaceSupervisor{workspace: w, options: s.options}
	err = refused.reuseHost(ctx, other)
	pubRequireCode(t, err, devsdk.CodeIdentityChanged, 4)
	require.Empty(t, refused.binary, "a host built against another release must not be adopted")

	require.NoError(t, s.reuseHost(ctx, floor))
	require.Equal(t, binary, s.binary)
}

// Through the graph: a host node whose recorded fingerprint still matches but
// whose published binary was built against another release is rebuilt, never
// adopted.
func TestBuildReuseRebuildsAHostBuiltAgainstAnotherRelease(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	commitFixtureRepositories(t, w)
	s, _ := env.hostReuseFixture(w)
	var requests []HostBuildRequest
	g, log := env.reuseGraph(w, func(_ context.Context, request HostBuildRequest) error {
		requests = append(requests, request)
		return nil
	})
	g.options.HostOutput, g.options.HostVariant, g.options.ReuseHost = s.hostOutput(), s.hostVariant(), s.reuseHost
	node := BuildNode{ID: "host-backend", Kind: "host-backend", Directory: filepath.Join(w.Root, "omniview")}
	g.Nodes = []BuildNode{node}
	ctx := context.Background()

	// The host go.mod now selects the other release, but the published binary
	// was built against the floor release.
	env.selectRelease(node.Directory, "github.com/omniviewdev/omniview", env.other)
	fixtureGit(t, node.Directory, "add", ".")
	fixtureGit(t, node.Directory, "commit", "-m", "select another SDK release")
	inputs, err := g.nodeInputs(ctx, node)
	require.NoError(t, err)
	digest, err := g.outputDigest(ctx, node)
	require.NoError(t, err)
	state := g.loadBuildReuse()
	require.NoError(t, g.setBuildReuse(state, node.ID, buildReuseRecord{Inputs: inputs, Outputs: digest}))

	require.NoError(t, g.produce(ctx, node, state))

	require.Len(t, requests, 1, "the refused adoption must rebuild the host")
	require.Equal(t, env.other.Published(), mustPublished(t, requests[0].SDK))
	require.Empty(t, s.binary, "the stale host binary was not adopted")
	require.Contains(t, log.String(), "build reuse: host-backend: rebuilding")
	require.False(t, strings.Contains(log.String(), "skipped"))
}

// With real releases and a real compile: a plugin build against the floor
// release is reported verified once its before/after comparison passes; a later
// build during which the plugin's go.mod moves to another release fails with
// the typed refusal and leaves the consumer unresolved, never verified at the
// moved release.
func TestSDKStatusOfARealPluginBuildFollowsItsBeforeAfterComparison(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	g, _ := env.reuseGraph(w, nil)
	node := pluginBackendNode(w)
	g.Nodes = []BuildNode{node}
	supervisor := &workspaceSupervisor{workspace: w, status: Status{Workspace: w, SDK: workspaceSDKStatus(context.Background(), w)}}
	var observed []devsdk.Published
	g.options.ObserveSDK = func(consumer string, identity devsdk.Identity) {
		observed = append(observed, mustPublished(t, identity))
		supervisor.observeSDK(consumer, identity)
	}
	g.options.DowngradeSDK = supervisor.downgradeSDK
	ctx := context.Background()

	require.NoError(t, g.buildNode(ctx, node))
	require.Equal(t, SDKConsumer{
		RepositoryID: "plugin", RequiredVersion: devsdk.FloorVersion, ResolvedVersion: env.sdk.Version,
		ModuleSum: env.sdk.ModuleSum, GoModSum: env.sdk.GoModSum, Verification: SDKVerified,
	}, statusConsumer(t, supervisor, "plugin"))

	build := g.run
	g.run = func(ctx context.Context, directory, program string, args ...string) ([]byte, error) {
		output, err := build(ctx, directory, program, args...)
		if program == "go" && len(args) > 0 && args[0] == "build" {
			env.selectRelease(node.Directory, "example.com/plugin", env.other) // the SDK moves while the compile runs
		}
		return output, err
	}
	pubRequireCode(t, g.buildNode(ctx, node), devsdk.CodeIdentityChanged, 4)

	consumer := statusConsumer(t, supervisor, "plugin")
	require.Equal(t, SDKUnresolved, consumer.Verification)
	require.Empty(t, consumer.ResolvedVersion)
	require.Empty(t, consumer.ModuleSum)
	for _, published := range observed {
		require.Equal(t, env.sdk.Published(), published, "the moved release was never reported as verified")
	}
}

// Every Go command that builds for a consumer runs in module mode, the mode its
// SDK verification ran in: an ambient GO111MODULE=off would make the compiler
// ignore the go.mod that verification read. Pinned for the graph's commands and
// for the supervisor's build commands alike.
func TestBuildCommandsRunInTheModuleModeTheirVerificationRanIn(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	t.Setenv("GO111MODULE", "off")
	g, _ := env.reuseGraph(w, nil)
	directory := filepath.Join(w.Root, "plugin")
	ctx := context.Background()

	output, err := g.run(ctx, directory, "go", "env", "GO111MODULE")
	require.NoError(t, err)
	require.Equal(t, "on", strings.TrimSpace(string(output)), "graph build commands")
	output, err = g.goRunner()(ctx, directory, devsdk.ModuleEnvironment(), "env", "GO111MODULE")
	require.NoError(t, err)
	require.Equal(t, "on", strings.TrimSpace(string(output)), "the verifier's runner")

	s := &workspaceSupervisor{workspace: w, generation: NewGeneration()}
	output, err = s.runLaunchCommand(ctx, directory, os.Environ(), nil, "go", "env", "GO111MODULE")
	require.NoError(t, err)
	require.Equal(t, "on", strings.TrimSpace(string(output)), "supervisor build commands")
}
