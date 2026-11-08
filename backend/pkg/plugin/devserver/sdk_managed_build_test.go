package devserver

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsource"
)

func TestManagedBuildIsDecidedByWorkspaceIdentityNotByAnSDKDirectory(t *testing.T) {
	for name, test := range map[string]struct {
		options BuildOpts
		managed bool
	}{
		"plain development build":    {BuildOpts{}, false},
		"empty workspace identity":   {BuildOpts{Environment: []string{"OMNIVIEW_WORKSPACE_ID="}}, false},
		"workspace identity":         {BuildOpts{Environment: []string{"OMNIVIEW_WORKSPACE_ID=7595bdf8-c4e9-46fa-b233-ea2bf9d23eca"}}, true},
		"resolved workspace":         {BuildOpts{Workspace: &devcontract.ResolvedWorkspace{}}, true},
		"unrelated environment only": {BuildOpts{Environment: []string{"SDK_SOURCE=/ambient"}}, false},
	} {
		t.Run(name, func(t *testing.T) {
			gw := &goWatcherProcess{buildOpts: test.options}
			require.Equal(t, test.managed, gw.managedBuild())
		})
	}
}

// Attestation must follow the build's management and identity mode, never the
// presence of a checkout directory: a published identity has none.
func TestAttestationBranchesCoverManagedAndUnmanagedBuildsInBothModes(t *testing.T) {
	root := appstate.NewTestService(t).Plugins()
	source, err := devsdk.NewSourceIdentity(devsource.Identity{
		Directory: filepath.Join(t.TempDir(), "sdk"), Revision: strings.Repeat("a", 40), SourceDigest: strings.Repeat("b", 64),
	})
	require.NoError(t, err)
	published, err := devsdk.NewPublishedIdentity(devsdk.Published{
		Module: devsdk.Module, Version: "v0.16.0",
		ModuleSum: "h1:q3jMU47l+0APFGpEdbJ4d5NmAnwaloV+siwiu3G4OOU=", GoModSum: "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4=",
	})
	require.NoError(t, err)

	unmanaged := &goWatcherProcess{pluginID: "attest", pluginsRoot: root}
	require.NoError(t, unmanaged.attestBuild(), "an unmanaged build has no verified SDK to attest")

	environment := []string{"OMNIVIEW_WORKSPACE_ID=7595bdf8-c4e9-46fa-b233-ea2bf9d23eca"}
	for name, identity := range map[string]devsdk.Identity{"source": source, "published": published} {
		t.Run(name+" without resolved workspace", func(t *testing.T) {
			gw := &goWatcherProcess{pluginID: "attest", pluginsRoot: root, buildOpts: BuildOpts{Environment: environment}, sdk: identity}
			require.ErrorContains(t, gw.attestBuild(), "resolved workspace required")
		})
	}
	workspace := &devcontract.ResolvedWorkspace{}
	managedWithoutIdentity := &goWatcherProcess{pluginID: "attest", pluginsRoot: root, buildOpts: BuildOpts{Workspace: workspace}}
	require.Error(t, managedWithoutIdentity.attestBuild(), "a managed build without verified SDK evidence must never be attested")
	managedPublished := &goWatcherProcess{pluginID: "attest", pluginsRoot: root, buildOpts: BuildOpts{Workspace: workspace}, sdk: published}
	require.ErrorContains(t, managedPublished.attestBuild(), "records only selected source SDK identities",
		"a published identity must be refused, not skipped, while artifact schema 3 cannot record it")
}
