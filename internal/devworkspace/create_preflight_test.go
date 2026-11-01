package devworkspace

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestCreateLaunchPreflightRejectsDivergentSDKWithoutMaterialization(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	sdk := filepath.Join(root, "plugin-sdk")
	reviewed := fixtureGit(t, sdk, "rev-parse", "HEAD")
	options := LaunchOptions{Mode: "browser", ReviewedSDKRevision: reviewed, LinkEvidence: LinkProtocolEvidence{Protocol: "workspace", Versions: []string{devcompose.Version}, AtomicDist: true, Peers: true, Runtime: true}}
	create := CreateOptions{Slug: "launch-preflight", Repositories: []string{"plugin-sdk"}}
	require.NoError(t, m.PreflightCreateLaunch(ctx, create, options))
	// A new root with identical bytes deliberately does not preserve ancestry.
	tree := fixtureGit(t, sdk, "rev-parse", "HEAD^{tree}")
	divergent := fixtureGit(t, sdk, "commit-tree", tree, "-m", "independent release")
	create.Refs = map[string]string{"plugin-sdk": divergent}
	err := m.PreflightCreateLaunch(ctx, create, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, "sdk_source_untrusted", issue.Code)
	require.Contains(t, issue.Message, divergent)
	require.Contains(t, issue.Message, reviewed)
	require.NoDirExists(t, filepath.Join(root, "workspaces", create.Slug))
	require.Empty(t, fixtureGit(t, sdk, "for-each-ref", "--format=%(refname)", "refs/heads/feature/launch-preflight"))
	items, err := m.List(ctx)
	require.NoError(t, err)
	require.Empty(t, items)
}

func TestCreateLaunchPreflightRequiresSDKSelection(t *testing.T) {
	m, root := fixtureManager(t)
	options := LaunchOptions{Mode: "browser", ReviewedSDKRevision: fixtureGit(t, filepath.Join(root, "plugin-sdk"), "rev-parse", "HEAD"), LinkEvidence: LinkProtocolEvidence{Protocol: "workspace", Versions: []string{devcompose.Version}, AtomicDist: true, Peers: true, Runtime: true}}
	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "missing-sdk"}, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, "sdk_source_required", issue.Code)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "missing-sdk"))
}
