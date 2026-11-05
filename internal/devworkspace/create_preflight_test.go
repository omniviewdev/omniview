package devworkspace

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestCreateLaunchPreflightRequiresSDKSelection(t *testing.T) {
	m, root := fixtureManager(t)
	options := LaunchOptions{
		Mode: "browser",
		LinkEvidence: LinkProtocolEvidence{
			Protocol: "workspace", Versions: []string{devcompose.Version}, AtomicDist: true, Peers: true, Runtime: true,
		},
	}
	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "missing-sdk"}, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, "sdk_source_required", issue.Code)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "missing-sdk"))
}
