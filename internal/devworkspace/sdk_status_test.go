package devworkspace

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
)

// Launch status reports the SDK mode from the manifest and each published
// consumer's declared requirement as unresolved until a launch verifies it;
// a verified observation fills in the resolved version, and a later status of an
// exited launch relabels it as historical evidence, never as a fresh observation.
func TestSDKStatusReportsDeclaredThenVerifiedThenHistoricalEvidence(t *testing.T) {
	w := publishedWorkspace(t)
	declared := workspaceSDKStatus(context.Background(), w)
	require.Equal(t, devsdk.ModePublished, declared.Mode)
	require.Equal(t, []SDKConsumer{
		{RepositoryID: "omniview", RequiredVersion: devsdk.FloorVersion, Verification: SDKUnresolved},
		{RepositoryID: "kubernetes", RequiredVersion: devsdk.FloorVersion, Verification: SDKUnresolved},
	}, declared.Consumers)

	supervisor := &workspaceSupervisor{workspace: w, status: Status{Workspace: w, SDK: declared}}
	resolved := publishedTuple(t, "v0.17.2")
	supervisor.observeSDK("omniview", resolved)
	source, err := fakeSDKIdentity(t.TempDir(), strings.Repeat("a", 40), strings.Repeat("c", 64))
	require.NoError(t, err)
	supervisor.observeSDK("kubernetes", source) // a source identity is not a published observation

	live := supervisor.snapshot().SDK
	require.NotNil(t, live)
	require.Equal(t, SDKConsumer{
		RepositoryID: "omniview", RequiredVersion: devsdk.FloorVersion, ResolvedVersion: "v0.17.2",
		ModuleSum: fixtureModuleSum, GoModSum: fixtureGoModSum, Verification: SDKVerified,
	}, live.Consumers[0], "the declared requirement and the verified effective version are distinct facts")
	require.Equal(t, SDKUnresolved, live.Consumers[1].Verification)
	require.Empty(t, live.Consumers[1].ResolvedVersion)

	history := historicalSDKStatus(live)
	require.Equal(t, SDKHistorical, history.Consumers[0].Verification)
	require.Equal(t, SDKUnresolved, history.Consumers[1].Verification)
	require.Equal(t, SDKVerified, live.Consumers[0].Verification, "relabeling must not rewrite the live status")
	require.Nil(t, historicalSDKStatus(nil))

	raw, err := json.Marshal(Status{SDK: history})
	require.NoError(t, err)
	require.Contains(t, string(raw), `"sdk":{"mode":"published"`)
	require.Contains(t, string(raw), `"resolvedVersion":"v0.17.2"`)
}

func TestSDKStatusOfASourceWorkspaceNamesTheSelectedRepositoryOnly(t *testing.T) {
	w := publishedWorkspace(t)
	sdk := "plugin-sdk"
	w.Manifest.Links.SDKRepositoryID = &sdk
	status := workspaceSDKStatus(context.Background(), w)
	require.Equal(t, &SDKStatus{Mode: devsdk.ModeSource, RepositoryID: sdk}, status)
}
