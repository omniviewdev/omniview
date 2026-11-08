package devworkspace

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

func publishedTuple(t *testing.T, version string) devsdk.Identity {
	t.Helper()
	identity, err := devsdk.NewPublishedIdentity(devsdk.Published{
		Module: devsdk.Module, Version: version, ModuleSum: fixtureModuleSum, GoModSum: fixtureGoModSum,
	})
	require.NoError(t, err)
	return identity
}

// A published selection is verified per Go consumer by the injected verifier,
// with the graph's own owned runner and the consumer's repository ID. The graph
// never resolves it through a source checkout, and it reports each observation.
func TestVerifyBuildSDKDelegatesAPublishedSelectionToTheVerifierPerConsumer(t *testing.T) {
	g := graphFixture(t)
	g.plan.SDK = devsdk.PublishedSelection()
	g.run = func(context.Context, string, string, ...string) ([]byte, error) {
		t.Fatal("a published selection must not be resolved through a source checkout")
		return nil, nil
	}
	published := publishedTuple(t, devsdk.FloorVersion)
	var requests []devsdk.Request
	g.options.VerifySDK = func(_ context.Context, request devsdk.Request) (devsdk.Identity, error) {
		requests = append(requests, request)
		return published, nil
	}
	var observed []string
	g.options.ObserveSDK = func(consumer string, identity devsdk.Identity) {
		require.Equal(t, published, identity)
		observed = append(observed, consumer)
	}
	host, plugin := filepath.Join(g.workspace.Root, "host"), filepath.Join(g.workspace.Root, "plugin")
	for _, directory := range []string{host, plugin} {
		identity, err := g.verifySDK(context.Background(), directory)
		require.NoError(t, err)
		require.Equal(t, published, identity)
	}
	require.Empty(t, observed, "a verification alone is not evidence; only a passed before/after comparison is reported")
	for _, directory := range []string{host, plugin} {
		require.NoError(t, g.verifyUnchangedSDK(context.Background(), directory, published))
	}
	require.Len(t, requests, 4, "each consumer is verified once before and once after")
	for index, want := range []struct{ name, directory string }{{"omniview", host}, {"plugin", plugin}} {
		require.Equal(t, devsdk.ModePublished, requests[index].Selection.Mode())
		require.Equal(t, want.name, requests[index].Consumer.Name)
		require.Equal(t, want.directory, requests[index].Consumer.Directory)
		require.Empty(t, requests[index].Consumer.Modfile, "only the host build verifies its generated modfile")
		require.NotNil(t, requests[index].Run, "verification must run Go under the graph's ownership")
	}
	require.Equal(t, []string{"omniview", "plugin"}, observed)
}

// The verifier is injected code: a published selection must never be satisfied
// by source evidence, nor a source selection by published evidence.
func TestVerifyBuildSDKRefusesAnIdentityOfTheWrongModeForThePublishedSelection(t *testing.T) {
	g := graphFixture(t)
	g.plan.SDK = devsdk.PublishedSelection()
	source, err := fakeSDKIdentity(filepath.Join(t.TempDir(), "sdk"), strings.Repeat("a", 40), strings.Repeat("c", 64))
	require.NoError(t, err)
	for name, answer := range map[string]devsdk.Identity{"source identity": source, "zero identity": {}} {
		t.Run(name, func(t *testing.T) {
			g.options.VerifySDK = func(context.Context, devsdk.Request) (devsdk.Identity, error) { return answer, nil }
			_, err := g.verifySDK(context.Background(), filepath.Join(g.workspace.Root, "host"))
			require.Error(t, err)
		})
	}
}

// An SDK that changes while a published consumer builds is refused under its own
// typed exit-4 code, and nothing built against it may be attested.
func TestPublishedSDKChangeDuringABuildIsATypedExit4Refusal(t *testing.T) {
	g := graphFixture(t)
	g.plan.SDK = devsdk.PublishedSelection()
	current := publishedTuple(t, devsdk.FloorVersion)
	g.options.VerifySDK = func(context.Context, devsdk.Request) (devsdk.Identity, error) { return current, nil }
	plugin := filepath.Join(g.workspace.Root, "plugin")
	before, err := g.verifySDK(context.Background(), plugin)
	require.NoError(t, err)
	require.NoError(t, g.verifyUnchangedSDK(context.Background(), plugin, before), "an unchanged SDK is accepted")

	current = publishedTuple(t, "v0.18.0")
	err = g.verifyUnchangedSDK(context.Background(), plugin, before)
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, devsdk.CodeIdentityChanged, failure.Code)
	require.Equal(t, 4, failure.Exit)
	require.Equal(t, "plugin", failure.Details["consumer"])
	require.Equal(t, devsdk.CodeIdentityChanged, workspaceError(err).Code)
	require.Equal(t, 4, workspaceError(err).Exit)
}

// Build reuse must never reuse another SDK's outputs: the SDK mode and the
// complete validated identity are fingerprint inputs.
func TestBuildReuseFingerprintBindsTheSDKModeAndPublishedIdentity(t *testing.T) {
	g := graphFixture(t)
	g.plan.SDK = devsdk.PublishedSelection()
	node := BuildNode{ID: "plugin-backend:plugin", Kind: "plugin-backend", PluginID: "plugin", Directory: filepath.Join(g.workspace.Root, "plugin")}
	fingerprint := func(identity devsdk.Identity) string {
		g.options.VerifySDK = func(context.Context, devsdk.Request) (devsdk.Identity, error) { return identity, nil }
		inputs, err := g.toolchainInputs(context.Background(), node)
		require.NoError(t, err)
		return inputs
	}
	floor, newer := fingerprint(publishedTuple(t, devsdk.FloorVersion)), fingerprint(publishedTuple(t, "v0.18.0"))
	require.Contains(t, floor, "published")
	require.Contains(t, floor, devsdk.FloorVersion)
	require.Contains(t, floor, fixtureModuleSum)
	require.NotEqual(t, floor, newer, "another release must not reuse this release's outputs")

	other, err := devsdk.NewPublishedIdentity(devsdk.Published{Module: devsdk.Module, Version: devsdk.FloorVersion, ModuleSum: "h1:" + strings.Repeat("B", 43) + "=", GoModSum: fixtureGoModSum})
	require.NoError(t, err)
	require.NotEqual(t, floor, fingerprint(other), "the same version with another checksum must not reuse outputs")

	require.Equal(t, 3, buildReuseSchema, "records written before published identities existed must rebuild")
}
