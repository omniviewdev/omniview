package resource

import (
	"context"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func hostFingerprint(scheme, id string, exclusive bool) resourcev2.EnvironmentIdentity {
	return resourcev2.EnvironmentIdentity{Scheme: scheme, ID: id, Strength: resourcev2.EnvironmentStrong, Exclusive: exclusive}
}

// hostEnvironment is what a caller can read of a cluster: its UID, its CA, both
// or neither.
func hostEnvironment(uid, ca string) []resourcev2.EnvironmentIdentity {
	var environment []resourcev2.EnvironmentIdentity
	if uid != "" {
		environment = append(environment, hostFingerprint("fixture.cluster-uid.v1", uid, true))
	}
	if ca != "" {
		environment = append(environment, hostFingerprint("fixture.root-ca.v1", ca, false))
	}
	return environment
}

func durableIdentityTestDescriptor(environment []resourcev2.EnvironmentIdentity) resourcev2.ResourceType {
	return resourcev2.ResourceType{Type: "objects", Environment: environment}
}

func durableIdentityTestReference(authority, id string, incarnation *string) resourcev2.ResourceReference {
	return resourcev2.ResourceReference{
		Address:     resourcev2.ResourceAddress{Provider: "native", Authority: authority, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: id},
		Incarnation: incarnation,
	}
}

func mustDurableIdentity(t *testing.T, pluginID string, environment []resourcev2.EnvironmentIdentity, reference resourcev2.ResourceReference) DurableIdentity {
	t.Helper()
	identity, ok, err := durableIdentity(pluginID, durableIdentityTestDescriptor(environment), reference)
	require.NoError(t, err)
	require.True(t, ok)
	return identity
}

func TestDurableIdentityIgnoresAuthorityAndIsNamespacedByPlugin(t *testing.T) {
	environment := hostEnvironment("uid-A", "ca-1")
	uid := "uid-1"
	first := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "record", &uid))

	// Another host-issued authority is what every stop, retargeting and restart yields.
	again := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:two", "record", &uid))
	require.Equal(t, first, again)
	require.True(t, first.SameObject(again))

	// A plugin can only ever name its own environments.
	otherPlugin := mustDurableIdentity(t, "p2", environment, durableIdentityTestReference("local:one", "record", &uid))
	require.False(t, first.SameObject(otherPlugin))
	keys, err := first.FingerprintKeys()
	require.NoError(t, err)
	otherKeys, err := otherPlugin.FingerprintKeys()
	require.NoError(t, err)
	require.Len(t, keys, 2)
	require.NotEqual(t, keys, otherKeys)

	// Another target, or another object, is another identity.
	otherCluster := mustDurableIdentity(t, "p1", hostEnvironment("uid-B", "ca-2"), durableIdentityTestReference("local:one", "record", &uid))
	otherObject := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "other", &uid))
	require.False(t, first.SameObject(otherCluster))
	require.False(t, first.SameObject(otherObject))

	// A recreate keeps the identity and changes the incarnation.
	recreated := "uid-2"
	next := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "record", &recreated))
	require.True(t, first.SameObject(next))
	require.NotEqual(t, first, next)
}

func TestDurableIdentityAcrossPermissionLevels(t *testing.T) {
	object := func(environment []resourcev2.EnvironmentIdentity) DurableIdentity {
		return mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "record", nil))
	}
	admin := object(hostEnvironment("uid-A", "ca-1"))
	viewer := object(hostEnvironment("", "ca-1"))
	uidOnly := object(hostEnvironment("uid-A", ""))
	require.True(t, admin.SameObject(viewer), "a viewer who reads only the CA is the same environment")
	require.True(t, admin.SameObject(uidOnly))
	require.False(t, viewer.SameObject(uidOnly), "two partial declarations share nothing; the store joins them through the administrator's")
	profileTwo := object(hostEnvironment("uid-B", "ca-1"))
	require.False(t, admin.SameObject(profileTwo), "a shared CA does not join clusters whose exclusive UIDs differ")
	require.True(t, viewer.SameObject(profileTwo), "when the UID is unreadable, only a detected collision can separate them")

	keys, err := viewer.FingerprintKeys()
	require.NoError(t, err)
	require.Len(t, keys, 1)
	adminKeys, err := admin.FingerprintKeys()
	require.NoError(t, err)
	require.Contains(t, adminKeys, keys[0], "the shared fingerprint keys the same environment record")
}

func TestDurableIdentityIsAbsentWithoutAStrongFingerprint(t *testing.T) {
	weakOnly := []resourcev2.EnvironmentIdentity{{Scheme: "aws.eks-cluster-arn.v1", ID: "arn:aws:eks:us-east-1:111122223333:cluster/prod", Strength: resourcev2.EnvironmentWeak}}
	for name, environment := range map[string][]resourcev2.EnvironmentIdentity{"nothing declared": nil, "only a hint": weakOnly} {
		t.Run(name, func(t *testing.T) {
			identity, ok, err := durableIdentity("p1", durableIdentityTestDescriptor(environment), durableIdentityTestReference("local:one", "record", nil))
			require.NoError(t, err)
			require.False(t, ok, "a type without a strong fingerprint has no durable identity")
			require.Equal(t, DurableIdentity{}, identity)
		})
	}
}

func TestDurableIdentityRejectsMismatchedOrUnstampedInput(t *testing.T) {
	environment := hostEnvironment("uid-A", "ca-1")
	other := durableIdentityTestReference("local:one", "record", nil)
	other.Address.Type = "another-type"
	for name, call := range map[string]func() error{
		"reference of another type": func() error {
			_, _, err := durableIdentity("p1", durableIdentityTestDescriptor(environment), other)
			return err
		},
		"unstamped plugin": func() error {
			_, _, err := durableIdentity("", durableIdentityTestDescriptor(environment), durableIdentityTestReference("local:one", "record", nil))
			return err
		},
		"fingerprint keys without plugin": func() error {
			_, err := DurableIdentity{}.FingerprintKeys()
			return err
		},
	} {
		t.Run(name, func(t *testing.T) { require.Error(t, call()) })
	}
	require.False(t, DurableIdentity{}.SameObject(DurableIdentity{}), "an invalid identity is the same as nothing")
}

func durableIdentityTestSession(t *testing.T, ctrl *controller) *sourceSession {
	t.Helper()
	ctrl.sources.mu.Lock()
	defer ctrl.sources.mu.Unlock()
	require.Len(t, ctrl.sources.sessions, 1)
	for _, session := range ctrl.sources.sessions {
		return session
	}
	return nil
}

// TestSourceSessionCarriesDurableIdentityToCommittedMembers follows the declared
// environment from the catalog through the real source session to the point where
// a graph ingest hook reads committed members, and checks the guardrail identity
// the same members carry is untouched.
func TestSourceSessionCarriesDurableIdentityToCommittedMembers(t *testing.T) {
	for _, declared := range []bool{true, false} {
		ctrl, _, provider, target := sourceTestFixture(t, func(p *scriptedSourceProvider) {
			base := p.CatalogFunc
			p.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				catalog, err := base(ctx, request)
				if err == nil && declared {
					catalog.Types[0].Environment = hostEnvironment("uid-A", "ca-1")
				}
				return catalog, err
			}
		})
		view := sourceTestOpen(t, ctrl, target)
		open := sourceNextOpen(t, provider)
		record := sourceTestRecord(target.Target, "pod", "pod-uid-1")
		observation := resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
		sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{observation}}})
		sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
		require.Eventually(t, func() bool {
			states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
			state := states.Types[target.Target.Type].State
			return err == nil && (state == "following" || state == "finished")
		}, 5*time.Second, time.Millisecond)

		session := durableIdentityTestSession(t, ctrl)
		session.mu.Lock()
		require.Len(t, session.members, 1)
		for _, member := range session.members {
			require.Equal(t, target.Target.Authority, member.header.reference.Address.Authority, "the guardrail identity is the host-issued authority")
			identity, ok, err := session.durableIdentity(member.header.reference)
			require.NoError(t, err)
			require.Equal(t, declared, ok)
			if declared {
				require.Equal(t, "p1", identity.PluginID)
				require.Equal(t, hostEnvironment("uid-A", "ca-1"), identity.Reference.Environment)
				require.Equal(t, "pod", identity.Reference.Address.ID)
				require.Equal(t, "pod-uid-1", *identity.Reference.Incarnation)
				_, err = identity.ObjectKey()
				require.NoError(t, err)
				keys, err := identity.FingerprintKeys()
				require.NoError(t, err)
				require.Len(t, keys, 2)
			}
		}
		session.mu.Unlock()
		require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
	}
}
