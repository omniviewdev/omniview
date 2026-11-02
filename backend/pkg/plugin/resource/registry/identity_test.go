package registry

import (
	"encoding/json"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestCanonicalAddressKeyCollisionCorpus(t *testing.T) {
	base := resourcev2.ResourceAddress{Provider: "provider", Authority: "authority", Type: "opaque/type", ID: "same"}
	cases := []struct {
		name      string
		provider  string
		authority string
		typeID    string
		scope     []resourcev2.ScopeEntry
		id        string
	}{
		{name: "global", id: "same"},
		{name: "scope one", scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "one"}}, id: "same"},
		{name: "scope two", scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "two"}}, id: "same"},
		{name: "slash ID", id: "a/b"},
		{name: "double colon ID", id: "a::b"},
		{name: "pipe ID", id: "a|b"},
		{name: "unicode ID", id: "雪/é::🚀|"},
		{name: "unicode normalization remains opaque", id: "雪/e\u0301::🚀|"},
		{name: "node one VM", provider: "proxmox", typeID: "qemu", scope: []resourcev2.ScopeEntry{{Dimension: "node", Value: "pve-one"}}, id: "100"},
		{name: "node two VM", provider: "proxmox", typeID: "qemu", scope: []resourcev2.ScopeEntry{{Dimension: "node", Value: "pve-two"}}, id: "100"},
		{name: "second provider", provider: "other", id: "same"},
		{name: "second authority", authority: "other", id: "same"},
		{name: "second type", typeID: "other/type", id: "same"},
		{name: "delimiter dimension", scope: []resourcev2.ScopeEntry{{Dimension: "a|b", Value: "c/d::雪"}}, id: "same"},
		{name: "delimiter value", scope: []resourcev2.ScopeEntry{{Dimension: "a", Value: "b|c/d::雪"}}, id: "same"},
	}
	keys := make(map[string]string, len(cases))
	store := NewMemoryStore()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			address := base
			if tc.provider != "" {
				address.Provider = tc.provider
			}
			if tc.authority != "" {
				address.Authority = tc.authority
			}
			if tc.typeID != "" {
				address.Type = tc.typeID
			}
			address.Scope, address.ID = tc.scope, tc.id
			key, err := CanonicalAddressKey(address)
			require.NoError(t, err)
			previous, exists := keys[key]
			require.False(t, exists, "address collides with %s", previous)
			keys[key] = tc.name
			equalKey, err := CanonicalAddressKey(address)
			require.NoError(t, err)
			require.Equal(t, key, equalKey)

			// There is no public key parser. Roundtrip the structured reference instead.
			data, err := json.Marshal(resourcev2.ResourceReference{Address: address})
			require.NoError(t, err)
			var reference resourcev2.ResourceReference
			require.NoError(t, json.Unmarshal(data, &reference))
			roundtripKey, err := CanonicalAddressKey(reference.Address)
			require.NoError(t, err)
			require.Equal(t, key, roundtripKey)
			entry := ResourceEntry{PluginID: "plugin", Route: resourcev2.AccessRoute{Connection: "route"}, Reference: reference, Labels: map[string]string{"case": tc.name}}
			_, replaced := store.Put(entry)
			require.False(t, replaced)
			got, ok := store.Get(entry.PluginID, reference, entry.Route)
			require.True(t, ok)
			require.Equal(t, tc.name, got.Labels["case"])
			require.Equal(t, key, got.EntryKey())
		})
	}
	require.Len(t, keys, len(cases))
}

func TestCanonicalAddressKeyScopeOrderAndIncarnation(t *testing.T) {
	address := resourcev2.ResourceAddress{Provider: "provider", Authority: "authority", Type: "opaque/type", ID: "same", Scope: []resourcev2.ScopeEntry{{Dimension: "zone", Value: "a/b"}, {Dimension: "node", Value: "雪::|"}}}
	key, err := CanonicalAddressKey(address)
	require.NoError(t, err)
	reordered := address
	reordered.Scope = []resourcev2.ScopeEntry{address.Scope[1], address.Scope[0]}
	reorderedKey, err := CanonicalAddressKey(reordered)
	require.NoError(t, err)
	require.Equal(t, key, reorderedKey)
	require.Equal(t, "zone", address.Scope[0].Dimension, "key construction must not mutate the caller's scope")

	for _, incarnation := range []*string{nil, new("first/::|雪"), new("second")} {
		reference := resourcev2.ResourceReference{Address: address, Incarnation: incarnation}
		data, err := json.Marshal(reference)
		require.NoError(t, err)
		var roundtrip resourcev2.ResourceReference
		require.NoError(t, json.Unmarshal(data, &roundtrip))
		// SDK JSON canonicalizes the scope order without changing address identity.
		require.Equal(t, resourcev2.ResourceReference{Address: reordered, Incarnation: incarnation}, roundtrip)
		addressKey, err := CanonicalAddressKey(roundtrip.Address)
		require.NoError(t, err)
		// Incarnation guards a reference; it is not part of logical address equality.
		require.Equal(t, key, addressKey)
	}
}

func TestMemoryStoreRecreationWithoutIncarnationIsNotDetected(t *testing.T) {
	store := NewMemoryStore()
	entry := makeEntry("plugin", "route", "qemu", "node-one", "100", map[string]string{"observation": "first"})
	require.Nil(t, entry.Reference.Incarnation)
	store.Put(entry)
	recreated := entry
	recreated.Labels = map[string]string{"observation": "recreated"}
	previous, replaced := store.Put(recreated)
	require.True(t, replaced, "without an incarnation the store has only logical address identity")
	require.Equal(t, "first", previous.Labels["observation"])
	got, exists := store.Get(entry.PluginID, entry.Reference, entry.Route)
	require.True(t, exists)
	require.Equal(t, "recreated", got.Labels["observation"])
	require.Equal(t, entry.EntryKey(), got.EntryKey())
}
