package resource

import (
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func authorityTestCatalog(provider string, hints map[string]*resourcev2.NativeAuthorityHint) resourcev2.Catalog {
	catalog := resourcev2.Catalog{Provider: provider, Revision: "coherent-observation", Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}, Types: []resourcev2.ResourceType{}}
	for resourceType, hint := range hints {
		catalog.Types = append(catalog.Types, resourcev2.ResourceType{Type: resourceType, DisplayName: resourceType, IdentityDimensions: []resourcev2.Dimension{}, QueryDimensions: []resourcev2.Dimension{}, Representations: []resourcev2.Representation{canonicalTestRepresentation()}, NativeAuthorityHint: hint})
	}
	sort.Slice(catalog.Types, func(i, j int) bool { return catalog.Types[i].Type < catalog.Types[j].Type })
	return catalog
}

func TestAuthorityCoherentHintsShareBackingOnlyWithinRouteAndPersist(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	hint := &resourcev2.NativeAuthorityHint{Scheme: "cluster-uid", ID: "opaque/雪", Continuity: resourcev2.ContinuityConnectionLocal}
	catalog := authorityTestCatalog("provider/x", map[string]*resourcev2.NativeAuthorityHint{"k8s:/pods": hint, "k8s:apps/deployments": hint, "helm:releases": hint, "unknown/one": nil, "unknown/two": nil})
	first, err := resolver.ObserveCatalog("plugin/雪", "connection/a", catalog)
	require.NoError(t, err)
	backing := first["k8s:/pods"].Authority
	require.NotEqual(t, hint.ID, backing)
	require.Equal(t, backing, first["k8s:apps/deployments"].Authority)
	require.Equal(t, backing, first["helm:releases"].Authority)
	require.NotEqual(t, backing, first["unknown/one"].Authority)
	require.NotEqual(t, first["unknown/one"].Authority, first["unknown/two"].Authority)
	for _, resolution := range first {
		require.Equal(t, resourcev2.ContinuityConnectionLocal, resolution.Continuity)
		require.NotEmpty(t, resolution.Limitations)
		require.False(t, resolution.Changed)
	}
	for _, route := range [][2]string{{"plugin/雪", "alias"}, {"other", "connection/a"}} {
		alias, err := resolver.ObserveCatalog(route[0], route[1], catalog)
		require.NoError(t, err)
		require.NotEqual(t, backing, alias["k8s:/pods"].Authority)
	}
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	same, err := restarted.ObserveCatalog("plugin/雪", "connection/a", catalog)
	require.NoError(t, err)
	for resourceType, resolution := range first {
		require.Equal(t, resolution.Authority, same[resourceType].Authority)
		require.False(t, same[resourceType].Changed)
		require.True(t, restarted.Matches("plugin/雪", "connection/a", catalog.Provider, resourceType, resolution.Authority))
	}
}

func TestAuthorityChangedTypeRejoinsStillActiveHintCohort(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	a := &resourcev2.NativeAuthorityHint{Scheme: "native", ID: "A", Continuity: resourcev2.ContinuityConnectionLocal}
	b := &resourcev2.NativeAuthorityHint{Scheme: "native", ID: "B", Continuity: resourcev2.ContinuityConnectionLocal}
	catalog := authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"opaque/type/雪": a, "opaque//type/雪": b, "peer": a})
	first, err := resolver.ObserveCatalog("p", "route", catalog)
	require.NoError(t, err)
	again, err := resolver.ObserveCatalog("p", "route", catalog)
	require.NoError(t, err)
	require.Equal(t, first, again, "independent descriptor hints must not alternate one route-global binding")
	catalog = authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"opaque/type/雪": b, "opaque//type/雪": b, "peer": a})
	changed, err := resolver.ObserveCatalog("p", "route", catalog)
	require.NoError(t, err)
	require.NotEqual(t, first["opaque/type/雪"].Authority, changed["opaque/type/雪"].Authority)
	require.Equal(t, changed["opaque/type/雪"].Authority, changed["opaque//type/雪"].Authority)
	require.Equal(t, first["peer"].Authority, changed["peer"].Authority)
	catalog = authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"opaque/type/雪": a, "opaque//type/雪": b, "peer": a})
	returned, err := resolver.ObserveCatalog("p", "route", catalog)
	require.NoError(t, err)
	require.Equal(t, first["opaque/type/雪"].Authority, returned["opaque/type/雪"].Authority, "a surviving peer justifies the still-active A cohort")
	require.Equal(t, returned["peer"].Authority, returned["opaque/type/雪"].Authority)
	require.True(t, resolver.Matches("p", "route", "provider", "opaque/type/雪", first["opaque/type/雪"].Authority))
}

func TestAuthorityMissingTypesAndProviderReplacementRetireAssignments(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	hint := &resourcev2.NativeAuthorityHint{Scheme: "native", ID: "same", Continuity: resourcev2.ContinuityStableNative}
	both := authorityTestCatalog("one", map[string]*resourcev2.NativeAuthorityHint{"one": hint, "two": hint})
	first, err := resolver.ObserveCatalog("p", "c", both)
	require.NoError(t, err)
	_, err = resolver.ObserveCatalog("p", "c", authorityTestCatalog("one", map[string]*resourcev2.NativeAuthorityHint{"two": hint}))
	require.NoError(t, err)
	require.False(t, resolver.Matches("p", "c", "one", "one", first["one"].Authority))
	returned, err := resolver.ObserveCatalog("p", "c", both)
	require.NoError(t, err)
	require.Equal(t, first["one"].Authority, returned["one"].Authority, "returning Type rejoins the surviving cohort without rekeying peers")
	require.Equal(t, resourcev2.ContinuityConnectionLocal, returned["one"].Continuity, "provider stableNative claim cannot upgrade host continuity")
	_, err = resolver.ObserveCatalog("p", "c", authorityTestCatalog("two", map[string]*resourcev2.NativeAuthorityHint{"one": hint}))
	require.NoError(t, err)
	require.False(t, resolver.Matches("p", "c", "one", "two", returned["two"].Authority))
	_, err = resolver.ObserveCatalog("p", "c", authorityTestCatalog("two", nil))
	require.NoError(t, err)
	require.Empty(t, resolver.bindings)
}

func TestAuthorityExplicitRetargetAndPersistenceFailure(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	catalog := authorityTestCatalog("native", map[string]*resourcev2.NativeAuthorityHint{"one": nil, "two": nil})
	first, err := resolver.ObserveCatalog("p", "c", catalog)
	require.NoError(t, err)
	other, err := resolver.ObserveCatalog("p", "other", catalog)
	require.NoError(t, err)
	require.NoError(t, resolver.InvalidateConnection("p", "c"))
	for resourceType, resolution := range first {
		require.False(t, resolver.Matches("p", "c", "native", resourceType, resolution.Authority))
	}
	require.True(t, resolver.Matches("p", "other", "native", "one", other["one"].Authority))
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	next, err := restarted.ObserveCatalog("p", "c", catalog)
	require.NoError(t, err)
	require.NotEqual(t, first["one"].Authority, next["one"].Authority)
	require.NoError(t, store.Remove(authorityStoreName))
	require.NoError(t, store.MkdirAll(authorityStoreName, 0o700))
	require.Error(t, restarted.InvalidateConnection("p", "c"))
	require.True(t, restarted.Matches("p", "c", "native", "one", next["one"].Authority))
	_, err = restarted.ObserveCatalog("p", "c", authorityTestCatalog("native", map[string]*resourcev2.NativeAuthorityHint{"replacement": nil}))
	require.Error(t, err)
	require.True(t, restarted.Matches("p", "c", "native", "one", next["one"].Authority))
	require.False(t, restarted.Matches("p", "c", "native", "one", ""))
}

func TestAuthorityRejectsMalformedHintsAndRoutesWithoutMutation(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	valid := authorityTestCatalog("native", map[string]*resourcev2.NativeAuthorityHint{"type": nil})
	first, err := resolver.ObserveCatalog("p", "c", valid)
	require.NoError(t, err)
	for _, hint := range []*resourcev2.NativeAuthorityHint{
		{}, {Scheme: "s", ID: "i", Continuity: "unknown"}, {Scheme: "s", ID: string([]byte{0xff}), Continuity: resourcev2.ContinuityConnectionLocal},
	} {
		_, err := resolver.ObserveCatalog("p", "c", authorityTestCatalog("native", map[string]*resourcev2.NativeAuthorityHint{"type": hint}))
		require.Error(t, err, "malformed nonnil hints must never become isolated success")
		require.True(t, resolver.Matches("p", "c", "native", "type", first["type"].Authority))
	}
	_, err = resolver.ObserveCatalog("", "c", valid)
	require.Error(t, err)
	_, err = resolver.ObserveCatalog("p", string([]byte{0xff}), valid)
	require.Error(t, err)
}

func TestAuthorityCanonicalAddressOpaqueTuple(t *testing.T) {
	address := resourcev2.ResourceAddress{Provider: "p/雪", Authority: "a/b", Type: "group/type", ID: "opaque/id<>&\u2028\u2029\"\\\n", Scope: []resourcev2.ScopeEntry{{Dimension: "雪", Value: "x/y"}, {Dimension: "a", Value: "é"}}}
	key, err := registry.CanonicalAddressKey(address)
	require.NoError(t, err)
	require.Equal(t, `["omniview.address.v1","p/雪","a/b","group/type",[["a","é"],["雪","x/y"]],"opaque/id<>&\u2028\u2029\"\\\n"]`, key)
	require.Equal(t, "雪", address.Scope[0].Dimension)
	address.Scope[0], address.Scope[1] = address.Scope[1], address.Scope[0]
	reordered, err := registry.CanonicalAddressKey(address)
	require.NoError(t, err)
	require.Equal(t, key, reordered)
	address.ID = strings.ReplaceAll(address.ID, "/", "//")
	different, err := registry.CanonicalAddressKey(address)
	require.NoError(t, err)
	require.NotEqual(t, key, different)
	address.Scope = append(address.Scope, address.Scope[0])
	_, err = registry.CanonicalAddressKey(address)
	require.Error(t, err)
	address.Scope = nil
	empty, err := registry.CanonicalAddressKey(address)
	require.NoError(t, err)
	require.Contains(t, empty, `,[],`)
}

func TestAuthorityStoreRejectsUntrustedDiskState(t *testing.T) {
	const entry = `{"plugin":"p","connection":"c","provider":"native","resourceType":"opaque/type","authority":"local:opaque"}`
	cases := []struct{ name, data, message string }{
		{"duplicate route", "[" + entry + "," + entry + "]", "duplicate persisted route"},
		{"duplicate field", `[{"plugin":"p","plugin":"other","connection":"c","provider":"native","resourceType":"opaque/type","authority":"local:opaque"}]`, "invalid store JSON"},
		{"unknown field", `[{"plugin":"p","connection":"c","provider":"native","resourceType":"opaque/type","authority":"local:opaque","extra":true}]`, ""},
		{"unknown hint field", `[{"plugin":"p","connection":"c","provider":"native","resourceType":"opaque/type","authority":"local:opaque","hint":{"scheme":"s","id":"i","continuity":"connectionLocal","extra":true}}]`, ""},
		{"missing authority", `[{"plugin":"p","connection":"c","provider":"native","resourceType":"opaque/type"}]`, "invalid persisted binding"},
		{"missing resource type", `[{"plugin":"p","connection":"c","provider":"native","authority":"local:opaque"}]`, "invalid persisted binding"},
		{"null root", `null`, "entry sequence"}, {"object root", `{}`, "entry sequence"},
		{"trailing input", "[" + entry + "][]", "invalid store JSON"},
		{"invalid UTF-8", "[\"" + string([]byte{0xff}) + "\"]", "invalid store JSON"},
		{"invalid surrogate", `["\ud800"]`, "invalid store JSON"},
		{"depth limit", strings.Repeat("[", 66) + "0" + strings.Repeat("]", 66), "invalid store JSON"},
		{"node limit", "[" + strings.Repeat("0,", resourcev2.MaxValueNodes) + "0]", "invalid store JSON"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store, err := appstate.NewTestService(t).PluginStore("test")
			require.NoError(t, err)
			require.NoError(t, store.WriteFile(authorityStoreName, []byte(tc.data), 0o600))
			_, err = NewAuthorityResolver(store)
			require.Error(t, err)
			if tc.message != "" {
				require.ErrorContains(t, err, tc.message)
			}
		})
	}
}

func TestAuthorityStoreByteLimitBeforeDecode(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	file, err := store.OpenFile(authorityStoreName, os.O_CREATE|os.O_RDWR, 0o600)
	require.NoError(t, err)
	require.NoError(t, file.Truncate(maxAuthorityStoreBytes+1))
	require.NoError(t, file.Close())
	_, err = NewAuthorityResolver(store)
	require.ErrorContains(t, err, "store exceeds byte limit")
}

func TestAuthorityCatalogMembershipChangesPreserveActiveCohort(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	hint := &resourcev2.NativeAuthorityHint{Scheme: "cluster", ID: "stable-observation", Continuity: resourcev2.ContinuityConnectionLocal}
	base := authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"pods": hint})
	first, err := resolver.ObserveCatalog("p", "c", base)
	require.NoError(t, err)
	joinedCatalog := authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"pods": hint, "new/crd": hint})
	joined, err := resolver.ObserveCatalog("p", "c", joinedCatalog)
	require.NoError(t, err)
	require.Equal(t, first["pods"].Authority, joined["pods"].Authority)
	require.Equal(t, first["pods"].Authority, joined["new/crd"].Authority)
	require.False(t, joined["pods"].Changed)
	remaining, err := resolver.ObserveCatalog("p", "c", base)
	require.NoError(t, err)
	require.Equal(t, first["pods"].Authority, remaining["pods"].Authority)
	require.False(t, resolver.Matches("p", "c", "provider", "new/crd", joined["new/crd"].Authority))
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	returned, err := restarted.ObserveCatalog("p", "c", joinedCatalog)
	require.NoError(t, err)
	require.Equal(t, first["pods"].Authority, returned["pods"].Authority)
	require.Equal(t, first["pods"].Authority, returned["new/crd"].Authority)
}

func TestAuthorityFullyRetiredHintCohortsNeverResurrect(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	a := &resourcev2.NativeAuthorityHint{Scheme: "cluster", ID: "A", Continuity: resourcev2.ContinuityConnectionLocal}
	b := &resourcev2.NativeAuthorityHint{Scheme: "cluster", ID: "B", Continuity: resourcev2.ContinuityConnectionLocal}
	catalogA := authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"pods": a, "deployments": a})
	catalogB := authorityTestCatalog("provider", map[string]*resourcev2.NativeAuthorityHint{"pods": b, "deployments": b})
	first, err := resolver.ObserveCatalog("p", "c", catalogA)
	require.NoError(t, err)
	changed, err := resolver.ObserveCatalog("p", "c", catalogB)
	require.NoError(t, err)
	require.NotEqual(t, first["pods"].Authority, changed["pods"].Authority)
	returned, err := resolver.ObserveCatalog("p", "c", catalogA)
	require.NoError(t, err)
	require.NotEqual(t, first["pods"].Authority, returned["pods"].Authority)
	require.Equal(t, returned["pods"].Authority, returned["deployments"].Authority)
	_, err = resolver.ObserveCatalog("p", "c", authorityTestCatalog("provider", nil))
	require.NoError(t, err)
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	afterAbsent, err := restarted.ObserveCatalog("p", "c", catalogA)
	require.NoError(t, err)
	require.NotEqual(t, returned["pods"].Authority, afterAbsent["pods"].Authority)
	require.Equal(t, afterAbsent["pods"].Authority, afterAbsent["deployments"].Authority)
}

func TestAuthorityRestartProofRequiresMoreThanPersistedHints(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("restart-proof")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	require.False(t, resolver.hasUnprovenRestartBindings("p", "route"))
	catalog := authorityTestCatalog("native", map[string]*resourcev2.NativeAuthorityHint{
		"unknown":        nil,
		"claimed-stable": {Scheme: "cluster", ID: "same", Continuity: resourcev2.ContinuityStableNative},
	})
	_, err = resolver.ObserveCatalog("p", "route", catalog)
	require.NoError(t, err)
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	require.True(t, restarted.hasUnprovenRestartBindings("p", "route"))
	require.False(t, restarted.hasUnprovenRestartBindings("other-plugin", "route"))
	require.False(t, restarted.hasUnprovenRestartBindings("p", "other-route"))
	require.NoError(t, restarted.InvalidateConnection("p", "route"))
	require.False(t, restarted.hasUnprovenRestartBindings("p", "route"))
}
