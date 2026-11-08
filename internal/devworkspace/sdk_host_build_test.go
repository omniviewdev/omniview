package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsource"
)

// swapSelectedSDKForRedirect replaces the selected SDK directory with a symlink
// to another real checkout, as a user (or a tool) can while a watch is running.
func swapSelectedSDKForRedirect(t *testing.T, g *BuildGraph) (redirectTarget string) {
	t.Helper()
	sdk := sdkDirectory(t, g)
	redirectTarget = fixtureRepo(t, t.TempDir(), "other-sdk", "")
	require.NoError(t, os.Rename(sdk, sdk+".verified"))
	require.NoError(t, os.Symlink(redirectTarget, sdk))
	return redirectTarget
}

// The canonical comparisons in graph verification cannot see a selected
// directory replaced by a redirect: both sides resolve to the other checkout.
// The host build must still refuse it, as it did before identities were typed.
func TestHostBuildRefusesASelectedSDKRedirectedAfterVerification(t *testing.T) {
	g := graphFixture(t)
	sdk := sdkDirectory(t, g)
	ctx := context.Background()
	verified, err := devsdk.NewVerifier(devsdk.Policy{})(ctx, devsdk.Request{Selection: g.plan.SDK})
	require.NoError(t, err)

	// Control: the verified, unredirected selection is accepted.
	directory, err := hostSDKDirectory(HostBuildRequest{Workspace: g.workspace, SDK: verified})
	require.NoError(t, err)
	require.Equal(t, sdk, directory, "the host module preparation must receive the selected directory as written")

	swapSelectedSDKForRedirect(t, g)

	// A watch rebuild verifies again just before it builds the host. Resolving
	// the swapped directory yields a perfectly valid identity of the other
	// checkout, so only the host build's own check can refuse it.
	g.run = func(context.Context, string, string, ...string) ([]byte, error) {
		return json.Marshal(map[string]any{"Path": devsdk.Module, "Dir": sdk, "Replace": map[string]any{"Dir": sdk}})
	}
	g.options.VerifySDK = devsdk.NewVerifier(devsdk.Policy{})
	reverified, err := g.verifySDK(ctx, filepath.Join(g.workspace.Root, "host"))
	require.NoError(t, err, "graph verification resolves the redirect canonically and cannot see it")
	require.NotEqual(t, verified, reverified)

	for name, identity := range map[string]devsdk.Identity{
		"identity verified before the swap":   verified,
		"identity re-verified after the swap": reverified,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := hostSDKDirectory(HostBuildRequest{Workspace: g.workspace, SDK: identity})
			require.ErrorContains(t, err, "redirected")
		})
	}

	// End to end through the real host build: with no tools on PATH, any
	// command it started would fail differently than this refusal.
	t.Setenv("PATH", t.TempDir())
	supervisor := &workspaceSupervisor{
		workspace: g.workspace, generation: g.options.Generation, options: LaunchOptions{Mode: "browser"},
		manager: &Manager{options: Options{Home: t.TempDir()}},
	}
	for name, identity := range map[string]devsdk.Identity{"stale identity": verified, "re-verified identity": reverified} {
		t.Run("host build "+name, func(t *testing.T) {
			err := supervisor.buildHost(ctx, HostBuildRequest{Workspace: g.workspace, SDK: identity})
			require.ErrorContains(t, err, "redirected")
			require.NotContains(t, err.Error(), "executable file not found", "the host build ran a command before refusing the redirect")
		})
	}
}

func TestHostSDKDirectoryRequiresTheVerifiedSelectedCheckout(t *testing.T) {
	g := graphFixture(t)
	sdk := sdkDirectory(t, g)
	verified, err := devsdk.NewVerifier(devsdk.Policy{})(context.Background(), devsdk.Request{Selection: g.plan.SDK})
	require.NoError(t, err)

	elsewhere, err := devsdk.NewSourceIdentity(devsource.Identity{
		Directory: filepath.Dir(sdk), Revision: strings.Repeat("a", 40), SourceDigest: strings.Repeat("b", 64),
	})
	require.NoError(t, err)
	_, err = hostSDKDirectory(HostBuildRequest{Workspace: g.workspace, SDK: elsewhere})
	require.ErrorContains(t, err, "redirected", "an identity of another directory is not the selected checkout")

	_, err = hostSDKDirectory(HostBuildRequest{Workspace: g.workspace, SDK: publishedFixtureIdentity(t)})
	require.ErrorContains(t, err, "verified source SDK identity")
	_, err = hostSDKDirectory(HostBuildRequest{Workspace: g.workspace})
	require.ErrorContains(t, err, "verified source SDK identity", "the zero identity verifies nothing")

	unselected := g.workspace
	unselected.Manifest.Links.SDKRepositoryID = nil
	_, err = hostSDKDirectory(HostBuildRequest{Workspace: unselected, SDK: verified})
	require.ErrorContains(t, err, "selected local SDK source")
}
