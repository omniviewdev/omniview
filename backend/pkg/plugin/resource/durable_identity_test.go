package resource

import (
	"context"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func durableIdentityTestDescriptor(environment *resourcev2.EnvironmentIdentity) resourcev2.ResourceType {
	return resourcev2.ResourceType{Type: "objects", Environment: environment}
}

func durableIdentityTestReference(authority, id string, incarnation *string) resourcev2.ResourceReference {
	return resourcev2.ResourceReference{
		Address:     resourcev2.ResourceAddress{Provider: "native", Authority: authority, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: id},
		Incarnation: incarnation,
	}
}

func mustDurableIdentity(t *testing.T, pluginID string, environment *resourcev2.EnvironmentIdentity, reference resourcev2.ResourceReference) (DurableIdentity, string) {
	t.Helper()
	identity, ok, err := durableIdentity(pluginID, durableIdentityTestDescriptor(environment), reference)
	require.NoError(t, err)
	require.True(t, ok)
	key, err := identity.Key()
	require.NoError(t, err)
	return identity, key
}

func TestDurableIdentityIgnoresAuthorityAndIsNamespacedByPlugin(t *testing.T) {
	environment := &resourcev2.EnvironmentIdentity{Scheme: "fixture.cluster.v1", ID: "cluster-A"}
	uid := "uid-1"
	first, firstKey := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "record", &uid))

	// Another host-issued authority is what every stop, retargeting and restart yields.
	again, againKey := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:two", "record", &uid))
	require.Equal(t, first, again)
	require.Equal(t, firstKey, againKey)

	// A plugin can only ever name its own environments.
	_, otherPluginKey := mustDurableIdentity(t, "p2", environment, durableIdentityTestReference("local:one", "record", &uid))
	require.NotEqual(t, firstKey, otherPluginKey)

	// Another target, or another object, is another identity.
	_, otherClusterKey := mustDurableIdentity(t, "p1", &resourcev2.EnvironmentIdentity{Scheme: "fixture.cluster.v1", ID: "cluster-B"}, durableIdentityTestReference("local:one", "record", &uid))
	_, otherObjectKey := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "other", &uid))
	require.NotEqual(t, firstKey, otherClusterKey)
	require.NotEqual(t, firstKey, otherObjectKey)

	// A recreate keeps the identity and changes the incarnation.
	recreated := "uid-2"
	next, nextKey := mustDurableIdentity(t, "p1", environment, durableIdentityTestReference("local:one", "record", &recreated))
	require.Equal(t, firstKey, nextKey)
	require.NotEqual(t, first, next)
}

func TestDurableIdentityIsAbsentWithoutADeclaredEnvironment(t *testing.T) {
	identity, ok, err := durableIdentity("p1", durableIdentityTestDescriptor(nil), durableIdentityTestReference("local:one", "record", nil))
	require.NoError(t, err)
	require.False(t, ok, "a type without an environment has no durable identity")
	require.Equal(t, DurableIdentity{}, identity)
}

func TestDurableIdentityRejectsMismatchedOrUnstampedInput(t *testing.T) {
	environment := &resourcev2.EnvironmentIdentity{Scheme: "fixture.cluster.v1", ID: "cluster-A"}
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
		"key without plugin": func() error {
			_, err := DurableIdentity{}.Key()
			return err
		},
	} {
		t.Run(name, func(t *testing.T) { require.Error(t, call()) })
	}
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
			base := p.mockProvider.CatalogFunc
			p.mockProvider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				catalog, err := base(ctx, request)
				if err == nil && declared {
					catalog.Types[0].Environment = &resourcev2.EnvironmentIdentity{Scheme: "fixture.cluster.v1", ID: "cluster-A"}
				}
				return catalog, err
			}
		})
		view := sourceTestOpen(t, ctrl, target)
		open := sourceNextOpen(t, provider)
		record := sourceTestRecord(target.Target, "pod", "pod-uid-1")
		sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
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
				require.Equal(t, resourcev2.EnvironmentIdentity{Scheme: "fixture.cluster.v1", ID: "cluster-A"}, identity.Reference.Address.Environment)
				require.Equal(t, "pod", identity.Reference.Address.ID)
				require.Equal(t, "pod-uid-1", *identity.Reference.Incarnation)
				_, err = identity.Key()
				require.NoError(t, err)
			}
		}
		session.mu.Unlock()
		require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
	}
}
