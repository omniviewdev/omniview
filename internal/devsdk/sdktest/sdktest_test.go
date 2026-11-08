package sdktest_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

func admit(t *testing.T, policy devsdk.Policy, release sdktest.Release) error {
	t.Helper()
	identity, err := devsdk.NewPublishedIdentity(release.Published())
	require.NoError(t, err)
	return policy.Admit(identity)
}

// The world's policy is the production policy plus the synthetic releases a test
// serves: the floor release (the real pinned SDK) is already a reviewed row.
func TestWorldPolicyExtendsTheProductionRulesWithTheServedReleases(t *testing.T) {
	table := devsdk.ReviewedReleases()
	world := sdktest.New(t)
	floor := world.PublishSDK(devsdk.FloorVersion, nil)
	newer := world.PublishSDK("v0.18.0", nil)
	uuid := world.PublishPinned("github.com/google/uuid")

	require.NoError(t, admit(t, world.Policy(), floor), "the floor release needs no extra row")
	require.NoError(t, admit(t, world.Policy(floor), floor), "naming the reviewed floor release again changes nothing")
	require.ErrorIs(t, admit(t, devsdk.ReleasePolicy(), newer), devsdk.ErrNotAccepted, "production does not know the synthetic release")
	require.ErrorIs(t, admit(t, world.Policy(), newer), devsdk.ErrNotAccepted, "a served release is reviewed only when the test says so")
	require.NoError(t, admit(t, world.Policy(newer), newer))
	require.NoError(t, admit(t, world.Policy(newer, uuid), newer), "releases of other modules are not SDK rows and are ignored")

	below := world.PublishSDK("v0.16.0", nil)
	require.ErrorIs(t, admit(t, world.Policy(below), below), devsdk.ErrNotAccepted, "a row never lowers the floor")
	require.Equal(t, table, devsdk.ReviewedReleases(), "the compiled-in table is not edited by a world")
}

func TestWorldServesAndRequiresReleases(t *testing.T) {
	world := sdktest.New(t)
	sdk := world.PublishSDK(devsdk.FloorVersion, nil)
	required := world.PublishRequiring("example.com/helper", "v1.0.0", sdk)
	require.Equal(t, "example.com/helper", required.Module)
	require.Equal(t, "v1.0.0", required.Version)
	require.NotEmpty(t, required.ModuleSum)
	require.NotEmpty(t, required.GoModSum)
	require.DirExists(t, world.Proxy+"/example.com/helper/@v")
}
