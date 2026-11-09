package devworkspace

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// statusConsumer returns the status entry of one repository, failing when the
// status has none.
func statusConsumer(t *testing.T, s *workspaceSupervisor, repository string) SDKConsumer {
	t.Helper()
	status := s.snapshot().SDK
	require.NotNil(t, status)
	for _, consumer := range status.Consumers {
		if consumer.RepositoryID == repository {
			return consumer
		}
	}
	t.Fatalf("no SDK status for %s in %+v", repository, status.Consumers)
	return SDKConsumer{}
}

// verifiedStatusFixture is a published-selection graph whose verifier answers
// with the identity in current (or its refusal), wired to a real supervisor's
// observer and downgrade hooks exactly like the production launch wires them.
type verifiedStatusFixture struct {
	g          *BuildGraph
	supervisor *workspaceSupervisor
	current    *devsdk.Identity
	refusal    *error
	observed   *[]devsdk.Identity
}

func newVerifiedStatusFixture(t *testing.T) verifiedStatusFixture {
	t.Helper()
	g := graphFixture(t)
	g.plan.SDK = devsdk.PublishedSelection()
	w := g.workspace
	w.Manifest.Links.SDKRepositoryID = nil
	current := publishedTuple(t, devsdk.FloorVersion)
	var refusal error
	var observed []devsdk.Identity
	g.options.VerifySDK = func(context.Context, devsdk.Request) (devsdk.Identity, error) {
		if refusal != nil {
			return devsdk.Identity{}, refusal
		}
		return current, nil
	}
	supervisor := &workspaceSupervisor{workspace: w, status: Status{Workspace: w, SDK: workspaceSDKStatus(context.Background(), w)}}
	g.options.ObserveSDK = func(consumer string, identity devsdk.Identity) {
		observed = append(observed, identity)
		supervisor.observeSDK(consumer, identity)
	}
	g.options.DowngradeSDK = supervisor.downgradeSDK
	return verifiedStatusFixture{g: g, supervisor: supervisor, current: &current, refusal: &refusal, observed: &observed}
}

func (f verifiedStatusFixture) plugin() string { return filepath.Join(f.g.workspace.Root, "plugin") }

// A verification alone is not evidence: the consumer is labelled verified only
// once the identity passed the build's before/after comparison.
func TestSDKStatusIsVerifiedOnlyAfterTheBeforeAfterComparisonPasses(t *testing.T) {
	f := newVerifiedStatusFixture(t)
	ctx := context.Background()

	before, err := f.g.verifySDK(ctx, f.plugin())
	require.NoError(t, err)
	require.Empty(t, *f.observed, "the first observation of a build must not be reported as verified")
	if status := f.supervisor.snapshot().SDK; status != nil {
		for _, consumer := range status.Consumers {
			require.NotEqual(t, SDKVerified, consumer.Verification)
		}
	}

	require.NoError(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	require.Equal(t, []devsdk.Identity{before}, *f.observed)
	require.Equal(t, SDKConsumer{
		RepositoryID: "plugin", RequiredVersion: devsdk.FloorVersion, ResolvedVersion: devsdk.FloorVersion,
		ModuleSum: fixtureModuleSum, GoModSum: fixtureGoModSum, Verification: SDKVerified,
	}, statusConsumer(t, f.supervisor, "plugin"))
}

// An identity that changed during the build is never reported, and a consumer
// that was verified before is downgraded: its resolved version and sums are
// cleared, never relabelled with the changed identity.
func TestSDKStatusDowngradesAVerifiedConsumerWhenTheSDKChangesDuringABuild(t *testing.T) {
	f := newVerifiedStatusFixture(t)
	ctx := context.Background()
	original := *f.current
	before, err := f.g.verifySDK(ctx, f.plugin())
	require.NoError(t, err)
	require.NoError(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	require.Equal(t, SDKVerified, statusConsumer(t, f.supervisor, "plugin").Verification)

	changed := publishedTuple(t, "v0.99.0")
	*f.current = changed
	err = f.g.verifyUnchangedSDK(ctx, f.plugin(), before)
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, devsdk.CodeIdentityChanged, failure.Code)

	require.Equal(t, []devsdk.Identity{original}, *f.observed, "the changed identity was never reported as verified")
	require.Equal(t, SDKConsumer{RepositoryID: "plugin", RequiredVersion: devsdk.FloorVersion, Verification: SDKUnresolved}, statusConsumer(t, f.supervisor, "plugin"))
}

// A refused verification withdraws what the consumer had earned, with the typed
// refusal intact.
func TestSDKStatusDowngradesAVerifiedConsumerWhenAVerificationIsRefused(t *testing.T) {
	f := newVerifiedStatusFixture(t)
	ctx := context.Background()
	before, err := f.g.verifySDK(ctx, f.plugin())
	require.NoError(t, err)
	require.NoError(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	require.Equal(t, SDKVerified, statusConsumer(t, f.supervisor, "plugin").Verification)

	*f.refusal = devsdk.IdentityChanged("plugin", "refused by the fixture verifier")
	_, err = f.g.verifySDK(ctx, f.plugin())
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, devsdk.CodeIdentityChanged, failure.Code)
	consumer := statusConsumer(t, f.supervisor, "plugin")
	require.Equal(t, SDKUnresolved, consumer.Verification)
	require.Empty(t, consumer.ResolvedVersion)
	require.Empty(t, consumer.ModuleSum)
	require.Empty(t, consumer.GoModSum)

	// The comparison of a build whose second observation is refused is the same.
	*f.refusal = nil
	require.NoError(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	require.Equal(t, SDKVerified, statusConsumer(t, f.supervisor, "plugin").Verification)
	*f.refusal = errors.New("go list failed")
	require.Error(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	require.Equal(t, SDKUnresolved, statusConsumer(t, f.supervisor, "plugin").Verification)
}

// The host node: a build that errors after the before/after comparison passed
// (here a bindings node verified the host first) leaves no verified claim, and
// a build during which the SDK moved never ends verified at the moved identity.
func TestSDKStatusOfTheHostFollowsItsBuildOutcome(t *testing.T) {
	f := newVerifiedStatusFixture(t)
	ctx := context.Background()
	host := outputGraphNode(t, f.g, "host-backend")
	original := *f.current

	f.g.options.HostBuild = func(context.Context, HostBuildRequest) error { return nil }
	require.NoError(t, f.g.buildNode(ctx, host))
	require.Equal(t, SDKVerified, statusConsumer(t, f.supervisor, "omniview").Verification)

	f.g.options.HostBuild = func(context.Context, HostBuildRequest) error { return errors.New("compile failed") }
	require.Error(t, f.g.buildNode(ctx, host))
	require.Equal(t, SDKUnresolved, statusConsumer(t, f.supervisor, "omniview").Verification, "a failed build leaves no verified claim")

	moved := publishedTuple(t, "v0.99.0")
	f.g.options.HostBuild = func(context.Context, HostBuildRequest) error {
		*f.current = moved // the SDK moves while the host compiles
		return nil
	}
	err := f.g.buildNode(ctx, host)
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, devsdk.CodeIdentityChanged, failure.Code)
	consumer := statusConsumer(t, f.supervisor, "omniview")
	require.Equal(t, SDKUnresolved, consumer.Verification)
	require.Empty(t, consumer.ResolvedVersion)
	for _, identity := range *f.observed {
		require.Equal(t, original, identity, "only the identity that passed a comparison may ever be reported")
	}
}

// historicalSDKStatus keeps its meaning: it relabels verified entries only, so
// an entry downgraded while the launch ran is not resurrected as historical
// evidence.
func TestHistoricalSDKStatusDoesNotResurrectADowngradedConsumer(t *testing.T) {
	f := newVerifiedStatusFixture(t)
	ctx := context.Background()
	before, err := f.g.verifySDK(ctx, f.plugin())
	require.NoError(t, err)
	require.NoError(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	require.Equal(t, SDKHistorical, historicalSDKStatus(f.supervisor.snapshot().SDK).Consumers[0].Verification)

	*f.current = publishedTuple(t, "v0.99.0")
	require.Error(t, f.g.verifyUnchangedSDK(ctx, f.plugin(), before))
	history := historicalSDKStatus(f.supervisor.snapshot().SDK)
	require.Equal(t, SDKUnresolved, history.Consumers[0].Verification)
	require.Empty(t, history.Consumers[0].ResolvedVersion)
}
