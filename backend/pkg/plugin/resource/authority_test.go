package resource

import (
	"os"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestAuthorityConnectionIsolationHintChangesAndRestart(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	hint := &resourcev2.NativeAuthorityHint{Scheme: "unreviewed/native", ID: "opaque/雪", Continuity: resourcev2.ContinuityStableNative}
	first, err := resolver.Resolve("plugin/雪", "connection/a", "provider/x", hint)
	require.NoError(t, err)
	require.NotEqual(t, hint.ID, first.Authority)
	require.Equal(t, resourcev2.ContinuityConnectionLocal, first.Continuity)
	require.NotEmpty(t, first.Limitations)
	require.False(t, first.Changed)
	for _, route := range [][3]string{{"plugin/雪", "alias", "provider/x"}, {"other", "connection/a", "provider/x"}, {"plugin/雪", "connection/a", "provider/y"}} {
		alias, err := resolver.Resolve(route[0], route[1], route[2], hint)
		require.NoError(t, err)
		require.NotEqual(t, first.Authority, alias.Authority)
	}
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	same, err := restarted.Resolve("plugin/雪", "connection/a", "provider/x", hint)
	require.NoError(t, err)
	require.Equal(t, first.Authority, same.Authority)
	require.False(t, same.Changed)
	changedHint := *hint
	changedHint.ID = "other/native"
	changed, err := restarted.Resolve("plugin/雪", "connection/a", "provider/x", &changedHint)
	require.NoError(t, err)
	require.True(t, changed.Changed)
	require.NotEqual(t, first.Authority, changed.Authority)
	returned, err := restarted.Resolve("plugin/雪", "connection/a", "provider/x", hint)
	require.NoError(t, err)
	require.True(t, returned.Changed)
	require.NotEqual(t, first.Authority, returned.Authority)
	unknown, err := restarted.Resolve("plugin/雪", "connection/a", "provider/x", nil)
	require.NoError(t, err)
	require.True(t, unknown.Changed)
	unknownAgain, err := restarted.Resolve("plugin/雪", "connection/a", "provider/x", nil)
	require.NoError(t, err)
	require.Equal(t, unknown.Authority, unknownAgain.Authority)
}

func TestAuthorityCanonicalAddressOpaqueTuple(t *testing.T) {
	address := resourcev2.ResourceAddress{Provider: "p/雪", Authority: "a/b", Type: "group/type", ID: "opaque/id<>&\u2028\u2029\"\\\n", Scope: []resourcev2.ScopeEntry{{Dimension: "雪", Value: "x/y"}, {Dimension: "a", Value: "é"}}}
	key, err := registry.CanonicalAddressKey(address)
	require.NoError(t, err)
	require.Equal(t, `["omniview.address.v1","p/雪","a/b","group/type",[["a","é"],["雪","x/y"]],"opaque/id<>&\u2028\u2029\"\\\n"]`, key)
	require.Equal(t, "雪", address.Scope[0].Dimension, "canonicalization must not mutate caller scope")
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
	require.Error(t, err, "duplicate dimensions must fail")
	address.Scope = nil
	empty, err := registry.CanonicalAddressKey(address)
	require.NoError(t, err)
	require.Contains(t, empty, `,[],`)
}

func TestAuthorityUnknownIsolationAndPersistenceFailure(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	one, err := resolver.Resolve("p", "one", "provider", nil)
	require.NoError(t, err)
	two, err := resolver.Resolve("p", "two", "provider", nil)
	require.NoError(t, err)
	require.NotEqual(t, one.Authority, two.Authority)
	_, err = resolver.Resolve("", "one", "provider", nil)
	require.Error(t, err)
	// Replacing the store path with a directory makes atomic replacement fail.
	require.NoError(t, store.Remove(authorityStoreName))
	require.NoError(t, store.MkdirAll(authorityStoreName, 0o700))
	_, err = resolver.Resolve("p", "one", "provider", &resourcev2.NativeAuthorityHint{ID: "new"})
	require.Error(t, err)
	same, err := resolver.Resolve("p", "one", "provider", nil)
	require.NoError(t, err)
	require.Equal(t, one.Authority, same.Authority, "failed persistence must not change live binding")
}

func TestAuthorityStoreRejectsUntrustedDiskState(t *testing.T) {
	const entry = `{"plugin":"p","connection":"c","provider":"native","authority":"local:opaque"}`
	cases := []struct {
		name, data string
		message    string
	}{
		{"duplicate route", "[" + entry + "," + entry + "]", "duplicate persisted route"},
		{"duplicate field", `[{"plugin":"p","plugin":"other","connection":"c","provider":"native","authority":"local:opaque"}]`, "invalid store JSON"},
		{"unknown field", `[{"plugin":"p","connection":"c","provider":"native","authority":"local:opaque","extra":true}]`, "unknown field"},
		{"unknown hint field", `[{"plugin":"p","connection":"c","provider":"native","authority":"local:opaque","hint":{"scheme":"s","id":"i","continuity":"connectionLocal","extra":true}}]`, "unknown field"},
		{"missing authority", `[{"plugin":"p","connection":"c","provider":"native"}]`, "invalid persisted binding"},
		{"null root", `null`, "entry sequence"},
		{"object root", `{}`, "entry sequence"},
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
			require.ErrorContains(t, err, tc.message)
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

func TestAuthorityRejectsInvalidUTF8WithoutChangingBinding(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	first, err := resolver.Resolve("p", "c", "native", nil)
	require.NoError(t, err)
	_, err = resolver.Resolve("p", "c", "native", &resourcev2.NativeAuthorityHint{ID: string([]byte{0xff})})
	require.Error(t, err)
	_, err = resolver.Resolve("p", string([]byte{0xff}), "native", nil)
	require.Error(t, err)
	same, err := resolver.Resolve("p", "c", "native", nil)
	require.NoError(t, err)
	require.Equal(t, first.Authority, same.Authority)
}

func TestAuthorityExplicitRetargetInvalidatesAllProvidersAndPersists(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	hint := &resourcev2.NativeAuthorityHint{Scheme: "native", ID: "same-reported-hint", Continuity: resourcev2.ContinuityConnectionLocal}
	first, err := resolver.Resolve("p", "changed/雪", "one", hint)
	require.NoError(t, err)
	second, err := resolver.Resolve("p", "changed/雪", "two", hint)
	require.NoError(t, err)
	untouched, err := resolver.Resolve("p", "other", "one", hint)
	require.NoError(t, err)
	require.True(t, resolver.Matches("p", "changed/雪", "one", first.Authority))
	require.False(t, resolver.Matches("p", "changed/雪", "one", second.Authority))
	require.NoError(t, resolver.InvalidateConnection("p", "changed/雪"))
	require.False(t, resolver.Matches("p", "changed/雪", "one", first.Authority))
	require.False(t, resolver.Matches("p", "changed/雪", "two", second.Authority))
	require.True(t, resolver.Matches("p", "other", "one", untouched.Authority))
	restarted, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	require.False(t, restarted.Matches("p", "changed/雪", "one", first.Authority))
	next, err := restarted.Resolve("p", "changed/雪", "one", hint)
	require.NoError(t, err)
	require.NotEqual(t, first.Authority, next.Authority, "equal hints after explicit retarget must not resurrect identity")
}

func TestAuthorityRetargetInvalidationFailureRestoresBinding(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	resolver, err := NewAuthorityResolver(store)
	require.NoError(t, err)
	first, err := resolver.Resolve("p", "c", "native", nil)
	require.NoError(t, err)
	require.NoError(t, store.Remove(authorityStoreName))
	require.NoError(t, store.MkdirAll(authorityStoreName, 0o700))
	require.Error(t, resolver.InvalidateConnection("p", "c"))
	require.True(t, resolver.Matches("p", "c", "native", first.Authority))
	require.False(t, resolver.Matches("p", "c", "native", ""))
}
