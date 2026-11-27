package plugin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/extensionpolicy"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	"github.com/omniviewdev/omniview/internal/devsession"
)

const readTestOwner = `{"schemaVersion":1,"id":"owner","points":[{"id":"slot","label":"Inspect","kind":"view","placement":"detail-tab","protocol":"owner/view@1","fields":{"rank":"number","kind":"string","flavor":"string"},"optional":["kind","flavor"],"read":{"id":"owner/near@2","row":{"num":"number","name":"string"}},"contract":{"package":"@example/points","version":"1.4.0-rc.1+dev.003","export":"slot"}}],"offers":[],"bindings":[]}`
const readTestPeer = `{"schemaVersion":1,"id":"peer","points":[],"offers":[{"id":"peer-view","label":"Inspect","kind":"view","protocol":"owner/view@1","fields":{"kind":"string","flavor":"string","rank":"number"},"optional":["flavor","kind"],"read":{"id":"owner/near@2","row":{"name":"string","num":"number"}},"requests":["flavor","rank","kind"],"requestRead":true}],"bindings":[{"offer":"peer-view","target":"owner/slot","when":[{"field":"kind","equals":"object"},{"field":"rank","equals":0}]}]}`

// Literal JSON.stringify tuples from extensionContract.ts, not the native
// encoder under test. Both source manifests deliberately permute map order.
const goldenReadTuple = `["owner/near@2",[["name","string"],["num","number"]]]`
const goldenPointTuple = `["detail-tab","owner/view@1","view",[["flavor","string"],["kind","string"],["rank","number"]],["flavor","kind"],null,` + goldenReadTuple + `]`

func goldenReadHash(tuple string) string {
	sum := sha256.Sum256([]byte(tuple))
	return hex.EncodeToString(sum[:])
}

func installConsentSource(t *testing.T, pm *pluginManager, id, manifest string, page bool) string {
	t.Helper()
	entries := []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: strings.Replace(uiOnlyYaml, "id: flux", "id: "+id, 1)},
		{name: "assets/extensions.v1.json", mode: 0644, body: manifest},
	}
	if page {
		entries = append(entries, tarEntry{name: "assets/entry.js", mode: 0644, body: "System.register([],function(){return {execute:function(){}}})"})
	} else {
		entries = append(entries, tarEntry{name: "assets/views.js", mode: 0644, body: extensionTestViews})
	}
	return installSignedExtensionAs(t, pm, id, writeTestTarball(t, entries))
}

func consentFixture(t *testing.T, peer string) (*pluginManager, *extensionpolicy.Store, extensionread.Binding, []byte) {
	t.Helper()
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	pm := newTestManager(t)
	ownerPin := installConsentSource(t, pm, "owner", readTestOwner, true)
	peerPin := installConsentSource(t, pm, "peer", peer, false)
	owner, err := pm.GetPlugin("owner")
	require.NoError(t, err)
	contributor, err := pm.GetPlugin("peer")
	require.NoError(t, err)
	require.NotNil(t, owner.Extension)
	require.NotNil(t, contributor.Extension)
	root, err := devsession.EnsurePrivateDirectory(t.TempDir())
	require.NoError(t, err)
	store, err := extensionpolicy.Open(root, func(extensionpolicy.Change) {})
	require.NoError(t, err)
	t.Cleanup(store.Close)
	read := goldenReadHash(goldenReadTuple)
	policy := fmt.Appendf(nil, `{"schemaVersion":1,"grants":[{"point":"owner/slot","offer":"peer/peer-view","ownerPin":%q,"contributorPin":%q,"contract":%q,"read":%q,"fields":["kind","rank"]}]}`,
		ownerPin, peerPin, goldenReadHash(goldenPointTuple), read)
	require.NoError(t, store.Replace(policy))
	return pm, store, extensionread.Binding{Point: "owner/slot", Offer: "peer/peer-view", OwnerPin: ownerPin, ContributorPin: peerPin,
		OwnerGeneration: owner.Extension.Generation, ContributorGeneration: contributor.Extension.Generation,
		Read: read, Continuity: store.Snapshot().Grants[0].Continuity}, policy
}

func TestResolveExtensionReadSignedConsent(t *testing.T) {
	pm, store, key, policy := consentFixture(t, readTestPeer)
	resolve := func(key extensionread.Binding) extensionread.Contract {
		t.Helper()
		c, ok := pm.ResolveExtensionRead(store, key)
		require.True(t, ok)
		require.Equal(t, "owner/near@2", c.Operation)
		require.Equal(t, map[string]string{"name": "string", "num": "number"}, c.Row)
		require.NoError(t, c.OwnerLife.Err())
		require.NoError(t, c.ContributorLife.Err())
		return c
	}
	deny := func(key extensionread.Binding) {
		t.Helper()
		c, ok := pm.ResolveExtensionRead(store, key)
		require.False(t, ok)
		require.Equal(t, extensionread.Contract{}, c)
	}
	before := resolve(key) // both comparisons granted; unrelated request "flavor" need not be granted
	ownerCache := pm.pinnedInstall("owner", key.OwnerPin, key.OwnerGeneration).reads
	index := ownerCache.index
	resolve(key)
	require.Same(t, index, ownerCache.index, "rechecking current bytes does not decode a new index")
	require.NoError(t, pm.beginArchivePersistence("peer"))
	require.ErrorIs(t, before.ContributorLife.Err(), context.Canceled)
	deny(key)
	pm.endArchivePersistence("peer")
	fresh := resolve(key) // preparation aborted before the runtime was replaced
	require.ErrorIs(t, before.ContributorLife.Err(), context.Canceled)
	require.Same(t, before.OwnerLife, fresh.OwnerLife)
	before = fresh
	for _, forge := range []func(*extensionread.Binding){
		func(k *extensionread.Binding) { k.Read = "owner/near@2" }, func(k *extensionread.Binding) { k.Read = goldenReadHash(goldenPointTuple) },
		func(k *extensionread.Binding) { k.OwnerPin = k.ContributorPin }, func(k *extensionread.Binding) { k.ContributorPin = k.OwnerPin },
		func(k *extensionread.Binding) { k.OwnerGeneration = k.ContributorGeneration }, func(k *extensionread.Binding) { k.ContributorGeneration = k.OwnerGeneration },
		func(k *extensionread.Binding) { k.Point = "owner/other" }, func(k *extensionread.Binding) { k.Offer = "owner/peer-view" },
		func(k *extensionread.Binding) { k.Continuity = "" },
	} {
		forged := key
		forge(&forged)
		deny(forged)
	}

	require.NoError(t, store.Replace([]byte(strings.Replace(string(policy), `"fields":["kind","rank"]`, `"fields":["rank"]`, 1))))
	key.Continuity = store.Snapshot().Grants[0].Continuity
	deny(key) // not even a current issuance for a partial match grant
	require.NoError(t, store.Replace(policy))
	deny(key) // reissuing the same signed pair cannot revive old work
	key.Continuity = store.Snapshot().Grants[0].Continuity
	resolve(key)
	_, err := pm.ReloadPlugin("peer")
	require.NoError(t, err)
	require.ErrorIs(t, before.ContributorLife.Err(), context.Canceled, "route-less contributor reload cancels blocked reads")
	require.NoError(t, before.OwnerLife.Err())
	deny(key)
	peer, err := pm.GetPlugin("peer")
	require.NoError(t, err)
	require.NotNil(t, peer.Extension)
	require.Equal(t, key.ContributorPin, peer.Extension.Pin)
	key.ContributorGeneration = peer.Extension.Generation
	after := resolve(key)

	// Warm admission cannot survive altered bytes under the same size/mtime.
	const file = "owner/assets/extensions.v1.json"
	stat, err := pm.pluginsRoot.Stat(file)
	require.NoError(t, err)
	require.NoError(t, pm.pluginsRoot.WriteFile(file, []byte(strings.Replace(readTestOwner, "Inspect", "Damaged", 1)), 0644))
	require.NoError(t, os.Chtimes(pm.pluginsRoot.ResolvePath(file), stat.ModTime(), stat.ModTime()))
	deny(key)
	require.ErrorIs(t, after.OwnerLife.Err(), context.Canceled)
	require.NoError(t, after.ContributorLife.Err())

	// A different manager reader can discover the bad member while the broker
	// is blocked. It must cancel the contributor without a broker recheck.
	require.NoError(t, pm.pluginsRoot.WriteFile("peer/assets/views.js", []byte("changed"), 0644))
	_, err = pm.ReadExtensionAsset("peer", key.ContributorPin, key.ContributorGeneration, "views")
	require.ErrorIs(t, err, errExtensionUnavailable)
	require.ErrorIs(t, after.ContributorLife.Err(), context.Canceled)
}

func TestResolveExtensionReadIndependentSignedShapeMismatch(t *testing.T) {
	for name, peer := range map[string]string{
		"row type":    strings.Replace(readTestPeer, `"num":"number"`, `"num":"string"`, 1),
		"optionality": strings.Replace(readTestPeer, `"optional":["flavor","kind"]`, `"optional":["kind"]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			// Both installed declarations are valid, target the same point and
			// request the same operation. Check the complete definition.
			pm, store, key, _ := consentFixture(t, peer)
			_, ok := pm.ResolveExtensionRead(store, key)
			require.False(t, ok)
		})
	}
}

func TestResolveExtensionReadStartupOverrideAndDisable(t *testing.T) {
	pm, store, key, _ := consentFixture(t, readTestPeer)
	c, ok := pm.ResolveExtensionRead(store, key)
	require.True(t, ok)
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "1")
	off := newTestManager(t)
	off.stateRoot, off.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	for _, id := range []string{"owner", "peer"} {
		_, err := off.LoadPlugin(id, nil)
		require.NoError(t, err)
	}
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	// Use the disabled manager's *own* two generations and the live policy.
	// A mismatched nonce from the other manager would not test the switch.
	current := key
	current.OwnerGeneration = off.extensionInstalls["owner"].generation
	current.ContributorGeneration = off.extensionInstalls["peer"].generation
	require.NotEmpty(t, current.OwnerGeneration)
	require.NotEmpty(t, current.ContributorGeneration)
	_, ok = off.ResolveExtensionRead(store, current)
	require.False(t, ok)

	notified := false
	pm.emitter = extensionEventFunc(func(event string, _ ...any) {
		if event == "plugin/enablement_changed" {
			notified = true
			require.ErrorIs(t, c.ContributorLife.Err(), context.Canceled, "fence before notifying or tearing down")
		}
	})
	_, err := pm.SetPluginEnabled("peer", false)
	require.NoError(t, err)
	require.True(t, notified)
	require.NoError(t, c.OwnerLife.Err())
	_, ok = pm.ResolveExtensionRead(store, key)
	require.False(t, ok)
}

func TestReadManifestAtomicAdmission(t *testing.T) {
	owner := &extensionReceipt{ID: "owner"}
	peer := &extensionReceipt{ID: "peer", Views: &extensionFile{Exports: []string{"peer-view"}}}
	a := admitReadManifest(owner, []byte(readTestOwner))
	require.NotNil(t, a)
	point := a.points["slot"]
	require.NotNil(t, point)
	require.Equal(t, goldenReadHash(goldenPointTuple), point.contract)
	require.Equal(t, goldenReadHash(goldenReadTuple), point.read)
	for _, bad := range []string{
		strings.Replace(readTestOwner, `"placement":"detail-tab"`, `"placement":"sidebar"`, 1),
		strings.Replace(readTestOwner, `"owner/near@2"`, `"foreign/near@2"`, 1),
		strings.Replace(readTestOwner, `"flavor":"string"`, `"flavor":"string","flavor":"number"`, 1),
		strings.Replace(readTestOwner, `"optional":["kind","flavor"]`, `"optional":null`, 1),
		strings.Replace(readTestOwner, `"offers":[]`, `"offers":[{"id":"ignored"}]`, 1),
		strings.Replace(readTestOwner, `"num":"number"`, `"num":"boolean"`, 1),
		strings.Replace(readTestOwner, `"read":{`, `"read":{"load":"ambient",`, 1),
	} {
		require.Nil(t, admitReadManifest(owner, []byte(bad)))
	}
	for _, bad := range []string{
		strings.Replace(readTestPeer, `"field":"kind"`, `"field":"flavorless"`, 1),
		strings.Replace(readTestPeer, `"field":"rank"`, `"field":"kind"`, 1),
		strings.Replace(readTestPeer, `"equals":0`, `"equals":"0"`, 1),
		strings.Replace(readTestPeer, `"requestRead":true`, `"requestRead":false`, 1),
		strings.Replace(readTestPeer, `"owner/slot"`, `"foreign/slot"`, 1),
	} {
		require.Nil(t, admitReadManifest(peer, []byte(bad)))
	}
	for _, validButNotThisRead := range []string{
		strings.Replace(readTestPeer, `,"requestRead":true`, "", 1),
		strings.Replace(readTestPeer, `"owner/slot"`, `"owner/other"`, 1),
	} {
		p := admitReadManifest(peer, []byte(validButNotThisRead))
		require.NotNil(t, p)
		require.NotContains(t, p.edges, readTarget{point: "owner/slot", localOffer: "peer-view"})
	}
}

func TestReadManifestEmptyContextAndRowBounds(t *testing.T) {
	owner := &extensionReceipt{ID: "owner"}
	const fields = `"fields":{"rank":"number","kind":"string","flavor":"string"},"optional":["kind","flavor"]`
	minimal := strings.Replace(readTestOwner, fields, `"fields":{}`, 1)
	p := admitReadManifest(owner, []byte(minimal))
	require.NotNil(t, p)
	require.Equal(t, goldenReadHash(`["detail-tab","owner/view@1","view",[],[],null,`+goldenReadTuple+`]`), p.points["slot"].contract)
	const row = `"row":{"num":"number","name":"string"}`
	keys := make([]string, 65)
	for i := range keys {
		keys[i] = fmt.Sprintf(`"n%d":"number"`, i)
	}
	for _, n := range []int{0, 1, 64, 65} {
		src := strings.Replace(minimal, row, `"row":{`+strings.Join(keys[:n], ",")+`}`, 1)
		require.Equal(t, n > 0 && n <= 64, admitReadManifest(owner, []byte(src)) != nil, "row width %d", n)
	}
}
