package plugin

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devcontract"
	regclient "github.com/omniviewdev/registry"
)

const extensionTestManifest = `{"schemaVersion":1,"id":"flux","points":[],"offers":[{"id":"note","kind":"menu","label":"Note","protocol":"owner/actions@1","fields":{},"requests":[],"action":{"kind":"info"}},{"id":"peer-view","kind":"view","label":"View","protocol":"owner/view@1","fields":{},"requests":[]}],"bindings":[{"offer":"note","target":"owner/actions"},{"offer":"peer-view","target":"owner/sidebar"}]}`
const extensionTestFeatures = `System.register([], (function (ex) { 'use strict'; return {execute: (function () { ex('note', note); function note() { throw 1; } })}; }));`
const extensionTestViews = `System.register(['react/jsx-runtime','@omniviewdev/kit'], (function (ex) { 'use strict'; var jsx, Card; return {setters: [function(m){jsx=m.jsx;},function(m){Card=m.Card;}],execute: (function () { ex({'peer-view': Body}); function Body() { return jsx(Card, {}); } })}; }));`

func extensionPackage(t *testing.T, additional ...tarEntry) string {
	t.Helper()
	entries := []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: uiOnlyYaml},
		{name: "assets/extensions.v1.json", mode: 0644, body: extensionTestManifest},
		{name: "assets/extensions.js", mode: 0644, body: extensionTestFeatures},
		{name: "assets/views.js", mode: 0644, body: extensionTestViews},
	}
	return writeTestTarball(t, append(entries, additional...))
}

// Exercise the real registry signature/checksum verifier, ranged download,
// extraction, commit, ordinary plugin load and generated-service Go surface.
func installSignedExtension(t *testing.T, pm *pluginManager, archive string) string {
	t.Helper()
	return installSignedExtensionAs(t, pm, "flux", archive)
}

func installSignedExtensionAs(t *testing.T, pm *pluginManager, id, archive string) string {
	t.Helper()
	data, err := os.ReadFile(archive)
	require.NoError(t, err)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	require.NoError(t, regclient.AddPublicKey(hex.EncodeToString(pub)))
	digest := sha256.Sum256(data)
	sum := hex.EncodeToString(digest[:])
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(sum)))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/package":
			http.ServeContent(w, r, "plugin.tar.gz", time.Time{}, bytes.NewReader(data))
		case strings.Contains(r.URL.Path, "/download/"):
			http.Redirect(w, r, "http://"+r.Host+"/package", http.StatusFound)
		default:
			encodeErr := json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{
				"version": "1.0.0", "artifacts": map[string]any{regclient.CurrentPlatform(): map[string]any{
					"checksum": sum, "signature": signature, "size": len(data),
				}},
			}})
			if encodeErr != nil {
				t.Error(encodeErr)
			}
		}
	}))
	defer server.Close()
	pm.registryClient = registry.NewClient(server.URL)
	_, err = pm.InstallPluginVersion(id, "1.0.0")
	require.NoError(t, err)
	return "sha256:" + sum
}

type extensionEventFunc func(string, ...any)

func (f extensionEventFunc) Emit(event string, args ...any) { f(event, args...) }

func TestExtensionInventorySignedLifetime(t *testing.T) {
	pm := newTestManager(t)
	svc := &ServiceWrapper{Mgr: pm}
	var provisional, committed int
	pm.emitter = extensionEventFunc(func(event string, data ...any) {
		switch event {
		case EventStateChange:
			if change, ok := data[0].(StateChangePayload); ok && change.To == lifecycle.PhaseRunning {
				pm.recordsMu.RLock()
				pending := pm.extensionInstalls["flux"]
				current := pm.extensionCurrentLocked("flux", pending)
				pm.recordsMu.RUnlock()
				require.False(t, current, "Running alone cannot publish an in-progress install")
				provisional++
			}
		case EventInventoryChanged:
			require.Equal(t, []any{InventoryChangedPayload{PluginID: "flux"}}, data)
			rows := svc.ListPlugins()
			require.Len(t, rows, 1)
			require.NotNil(t, rows[0].Extension)
			committed++
		}
	})
	archive := extensionPackage(t)
	pin := installSignedExtension(t, pm, archive)
	require.Equal(t, 1, provisional)
	require.Equal(t, 1, committed)
	pm.emitter = testNoopEmitter{}
	row, err := svc.GetPlugin("flux")
	require.NoError(t, err)
	require.NotNil(t, row.HasPage)
	require.False(t, *row.HasPage)
	s := row.Extension
	require.NotNil(t, s)
	require.Equal(t, pin, s.Pin)
	require.NotEmpty(t, s.Generation)
	require.Empty(t, s.PageDigest)
	if s.Manifest != extensionTestManifest {
		require.JSONEq(t, extensionTestManifest, s.Manifest)
		t.Fatal("inventory re-encoded the signed manifest")
	}
	require.Equal(t, []string{"note"}, s.Features)
	require.Equal(t, []string{"peer-view"}, s.Views)
	for role, want := range map[string]string{"features": extensionTestFeatures, "views": extensionTestViews} {
		got, readErr := svc.ReadExtensionAsset("flux", pin, s.Generation, role)
		require.NoError(t, readErr)
		require.Equal(t, want, got)
	}
	for _, args := range [][4]string{
		{"flux", pin, s.Generation, "../assets/views.js"}, {"flux", pin, s.Generation, "entry"},
		{"other", pin, s.Generation, "views"}, {"flux", "1.0.0", s.Generation, "views"}, {"flux", pin, "old", "views"},
	} {
		_, readErr := svc.ReadExtensionAsset(args[0], args[1], args[2], args[3])
		require.ErrorIs(t, readErr, errExtensionUnavailable)
	}
	_, err = pm.ReloadPlugin("flux")
	require.NoError(t, err)
	fresh, err := pm.GetPlugin("flux")
	require.NoError(t, err)
	require.NotNil(t, fresh.Extension)
	require.Equal(t, pin, fresh.Extension.Pin)
	require.NotEqual(t, s.Generation, fresh.Extension.Generation)
	_, err = svc.ReadExtensionAsset("flux", pin, s.Generation, "views")
	require.ErrorIs(t, err, errExtensionUnavailable)
	_, err = pm.SetPluginEnabled("flux", false)
	require.NoError(t, err)
	_, err = svc.ReadExtensionAsset("flux", pin, fresh.Extension.Generation, "views")
	require.ErrorIs(t, err, errExtensionUnavailable)
	_, err = pm.SetPluginEnabled("flux", true)
	require.NoError(t, err)
	require.Nil(t, svc.ListPlugins()[0].Extension, "enable alone is not a new Running generation")
	// Another host sees the private completed receipt, not the old generation.
	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	_, err = restarted.LoadPlugin("flux", nil)
	require.NoError(t, err)
	next := restarted.ListPlugins()[0].Extension
	require.NotNil(t, next)
	require.Equal(t, pin, next.Pin)
	require.NotEqual(t, fresh.Extension.Generation, next.Generation)
	require.NoError(t, restarted.UnloadPlugin("flux"))
	_, err = restarted.ReadExtensionAsset("flux", pin, next.Generation, "features")
	require.ErrorIs(t, err, errExtensionUnavailable)
}

func TestExtensionInventoryUnsignedAndIncompleteSources(t *testing.T) {
	pm := newTestManager(t)
	archive := extensionPackage(t)
	_, err := pm.InstallPluginFromPath(archive)
	require.NoError(t, err)
	row, err := pm.GetPlugin("flux")
	require.NoError(t, err)
	require.False(t, *row.HasPage)
	require.True(t, row.ExtensionRefused)
	require.Nil(t, row.Extension)
	// Even a marketplace ID and version on the private transaction are not
	// signature evidence. A path swapped after download must fail the real hash.
	lock := pm.installOpsLock("flux")
	lock.Lock()
	_, err = pm.installPluginArchive(context.Background(), archive, "flux", "1.0.0", "", strings.Repeat("a", 64))
	lock.Unlock()
	require.ErrorContains(t, err, "does not match the verified download")
	require.Nil(t, pm.ListPlugins()[0].Extension)
	require.NoError(t, pm.stateRoot.Remove(receiptName("flux")))
	_, err = pm.ReloadPlugin("flux")
	require.NoError(t, err)
	legacy := pm.ListPlugins()[0]
	require.Nil(t, legacy.Extension, "no signature evidence reconstructed from installed files")
	require.Nil(t, legacy.HasPage)
}

func TestExtensionInventoryPageAndTamperIsolation(t *testing.T) {
	pm := newTestManager(t)
	archive := extensionPackage(t,
		tarEntry{name: "assets/entry.js", mode: 0644, body: "System.register([], function(){});"},
		tarEntry{name: "assets/chunks/shared.js", mode: 0644, body: "shared"},
		tarEntry{name: "assets/media/icon.png", mode: 0644, body: "\x89PNG\xff"},
	)
	pin := installSignedExtension(t, pm, archive)
	s := pm.ListPlugins()[0].Extension
	require.NotNil(t, s)
	entry, err := pm.ReadPinnedPageFile("flux", pin, s.Generation, "assets/entry.js")
	require.NoError(t, err)
	digest := sha256.Sum256(entry)
	require.Equal(t, "sha256:"+hex.EncodeToString(digest[:]), s.PageDigest)
	for member, want := range map[string]string{"assets/chunks/shared.js": "shared", "assets/media/icon.png": "\x89PNG\xff"} {
		data, readErr := pm.ReadPinnedPageFile("flux", pin, s.Generation, member)
		require.NoError(t, readErr)
		require.Equal(t, want, string(data))
	}
	for _, member := range []string{"assets/../plugin.yaml", "assets/views.js", "assets/extensions.js", "assets/new.js", "/assets/entry.js", `assets\entry.js`} {
		_, readErr := pm.ReadPinnedPageFile("flux", pin, s.Generation, member)
		require.ErrorIs(t, readErr, errExtensionUnavailable)
	}
	changed := 0
	pm.emitter = extensionEventFunc(func(event string, data ...any) {
		if event == EventInventoryChanged {
			require.Equal(t, []any{InventoryChangedPayload{PluginID: "flux"}}, data)
			changed++
		}
	})
	stat, err := pm.pluginsRoot.Stat("flux/assets/extensions.js")
	require.NoError(t, err)
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/extensions.js", []byte(strings.Replace(extensionTestFeatures, "throw 1", "throw 2", 1)), 0644))
	require.NoError(t, os.Chtimes(pm.pluginsRoot.ResolvePath("flux/assets/extensions.js"), stat.ModTime(), stat.ModTime()))
	_, err = pm.ReadExtensionAsset("flux", pin, s.Generation, "features")
	require.ErrorIs(t, err, errExtensionUnavailable)
	_, err = pm.ReadExtensionAsset("flux", pin, s.Generation, "views")
	require.ErrorIs(t, err, errExtensionUnavailable, "a bad replacement retires the whole source")
	row := pm.ListPlugins()[0]
	require.True(t, row.ExtensionRefused)
	require.Nil(t, row.Extension)
	require.True(t, *row.HasPage, "ordinary page remains independently discoverable")
	require.Equal(t, 1, changed)
	pm.emitter = testNoopEmitter{}
	_, err = pm.UninstallPlugin("flux")
	require.NoError(t, err)
	_, err = pm.stateRoot.Stat(receiptName("flux"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestExtensionInventoryRefusesRedirectedMember(t *testing.T) {
	pm := newTestManager(t)
	pin := installSignedExtension(t, pm, extensionPackage(t))
	s := pm.ListPlugins()[0].Extension
	require.NotNil(t, s)
	assets := pm.pluginsRoot.ResolvePath("flux/assets")
	require.NoError(t, os.Rename(assets, assets+"-other"))
	if err := os.Symlink(filepath.Base(assets)+"-other", assets); err != nil {
		t.Skipf("cannot create directory symlink here: %v", err)
	}
	_, err := pm.ReadExtensionAsset("flux", pin, s.Generation, "views")
	require.ErrorIs(t, err, errExtensionUnavailable, "even identical bytes through an in-root symlink are refused")
	require.Nil(t, pm.ListPlugins()[0].Extension)
}

func TestExtensionInventoryInvalidReplacementKeepsPage(t *testing.T) {
	pm := newTestManager(t)
	installSignedExtension(t, pm, extensionPackage(t))
	old := pm.ListPlugins()[0].Extension
	require.NotNil(t, old)
	installSignedExtension(t, pm, extensionPackage(t,
		tarEntry{name: "assets/entry.js", mode: 0644, body: "valid ordinary entry"},
		tarEntry{name: "assets/./extensions.js", mode: 0644, body: extensionTestFeatures},
	))
	row := pm.ListPlugins()[0]
	require.True(t, *row.HasPage)
	require.True(t, row.ExtensionRefused)
	require.Nil(t, row.Extension)
	_, err := pm.ReadExtensionAsset("flux", old.Pin, old.Generation, "features")
	require.ErrorIs(t, err, errExtensionUnavailable)
}

func TestExtensionInventoryKillSwitchAndStaleRead(t *testing.T) {
	pm := newTestManager(t)
	pin := installSignedExtension(t, pm, extensionPackage(t))
	s := pm.ListPlugins()[0].Extension
	require.NotNil(t, s)
	original := pm.pinnedInstall("flux", pin, s.Generation)
	require.NotNil(t, original)
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "1")
	disabled := newTestManager(t)
	disabled.stateRoot, disabled.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	_, err := disabled.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.Nil(t, disabled.ListPlugins()[0].Extension)
	_, err = disabled.ReadExtensionAsset("flux", pin, s.Generation, "features")
	require.ErrorIs(t, err, errExtensionUnavailable)
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	require.Nil(t, disabled.ListPlugins()[0].Extension, "a startup override cannot be cleared in this process")
	_, err = pm.ReloadPlugin("flux")
	require.NoError(t, err)
	require.False(t, pm.finishExtensionRead("flux", original, nil))
	require.False(t, pm.finishExtensionRead("flux", original, errExtensionUnavailable))
	fresh := pm.ListPlugins()[0].Extension
	require.NotNil(t, fresh, "an obsolete failure cannot withdraw the replacement")
	require.NotEqual(t, s.Generation, fresh.Generation)
}

func TestExtensionInventoryRolePreflight(t *testing.T) {
	for _, tt := range []struct {
		name, text string
		views      bool
		want       []string
	}{
		{"feature", extensionTestFeatures, false, []string{"note"}},
		{"view", extensionTestViews, true, []string{"peer-view"}},
		{"named arrow", `System.register([], function(ex){return {execute:function(){ const f=ex('f', () => 42); }}});`, false, []string{"f"}},
		{"named module", strings.Replace(extensionTestFeatures, "register([],", "register('plugin', [],", 1), false, nil},
		{"surplus module", extensionTestFeatures + extensionTestFeatures, false, nil},
		{"normal page dependency", strings.Replace(extensionTestViews, "@omniviewdev/kit", "@omniviewdev/runtime/ui/v1", 1), true, nil},
		{"feature dependency", extensionTestViews, false, nil},
		{"development runtime", strings.Replace(extensionTestViews, "react/jsx-runtime", "react/jsx-dev-runtime", 1), true, nil},
		{"dynamic import", strings.Replace(extensionTestFeatures, "throw 1", "return import('x')", 1), false, nil},
		{"noncallable", strings.Replace(extensionTestFeatures, ", note)", ", 1)", 1), false, nil},
		{"computed export", strings.Replace(extensionTestFeatures, "ex('note',", "ex(String('note'),", 1), false, nil},
		{"publisher escape", strings.Replace(extensionTestFeatures, "ex('note',", "const fn=ex; fn('note',", 1), false, nil},
		{"late extra export", strings.Replace(extensionTestFeatures, "throw 1", "ex('extra', note)", 1), false, nil},
		{"spread", strings.Replace(extensionTestViews, "'peer-view': Body", "...another", 1), true, nil},
		{"async component", strings.Replace(extensionTestViews, "function Body", "async function Body", 1), true, nil},
		{"uninitialized export", `System.register([], function(ex){return {execute:function(){ ex('f', f); const f=() => 42; }}});`, false, nil},
		{"top-level registration", strings.Replace(extensionTestFeatures, "ex('note',", "register(); ex('note',", 1), false, nil},
		{"eager initializer", strings.Replace(extensionTestFeatures, "ex('note',", "const x=register(); ex('note',", 1), false, nil},
		{"effectful setter", strings.Replace(extensionTestViews, "jsx=m.jsx;", "register(); jsx=m.jsx;", 1), true, nil},
		{"duplicate export", strings.Replace(extensionTestFeatures, "ex('note', note);", "ex('note', note); ex('note', note);", 1), false, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := extensionModuleExports([]byte(tt.text), tt.views)
			require.Equal(t, tt.want != nil, ok)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestExtensionInventoryPointsOnlyOwner(t *testing.T) {
	const manifest = `{"schemaVersion":1,"id":"flux","points":[{"id":"sidebar","label":"Sidebar","kind":"view","placement":"sidebar","protocol":"flux/side@1","fields":{},"contract":{"package":"@example/points","version":"1.0.0","export":"sidebar"}}],"offers":[],"bindings":[]}`
	pm := newTestManager(t)
	pin := installSignedExtension(t, pm, writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: uiOnlyYaml},
		{name: "assets/extensions.v1.json", mode: 0644, body: manifest},
		{name: "assets/entry.js", mode: 0644, body: "ordinary page"},
	}))
	s := pm.ListPlugins()[0].Extension
	require.NotNil(t, s)
	require.Equal(t, []string{}, s.Features)
	require.Equal(t, []string{}, s.Views)
	for _, role := range []string{"features", "views"} {
		_, err := pm.ReadExtensionAsset("flux", pin, s.Generation, role)
		require.ErrorIs(t, err, errExtensionUnavailable)
	}
	page, err := pm.ReadPinnedPageFile("flux", pin, s.Generation, "assets/entry.js")
	require.NoError(t, err)
	require.Equal(t, "ordinary page", string(page))
	// A request between two inventory reads must not reuse stale metadata.
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/extensions.v1.json", []byte(strings.Replace(manifest, "flux/side@1", "flux/side@2", 1)), 0644))
	_, err = pm.ReadPinnedPageFile("flux", pin, s.Generation, "assets/entry.js")
	require.ErrorIs(t, err, errExtensionUnavailable)
	require.True(t, pm.ListPlugins()[0].ExtensionRefused)
}

func TestExtensionInventoryRefusesCopiedInstallation(t *testing.T) {
	pm := newTestManager(t)
	pin := installSignedExtension(t, pm, extensionPackage(t))
	original := pm.ListPlugins()[0].Extension
	require.NotNil(t, original)
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", "previous"))
	require.NoError(t, os.CopyFS(pm.pluginsRoot.ResolvePath("flux"), os.DirFS(pm.pluginsRoot.ResolvePath("previous"))))
	_, err := pm.ReadExtensionAsset("flux", pin, original.Generation, "features")
	require.ErrorIs(t, err, errExtensionUnavailable, "copied bytes do not carry the directory's install identity")
	require.NoError(t, pm.UnloadPlugin("flux"))
	_, err = pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.Nil(t, pm.ListPlugins()[0].Extension)
}

func TestExtensionInventoryRefusesReplacedAssetTree(t *testing.T) {
	pm := newTestManager(t)
	pin := installSignedExtension(t, pm, extensionPackage(t))
	s := pm.ListPlugins()[0].Extension
	require.NotNil(t, s)
	root := pm.pluginsRoot
	require.NoError(t, root.RenameDirectoryNoReplace("flux/assets", "flux/prior"))
	require.NoError(t, root.MkdirAll("flux/assets", 0700))
	for _, name := range []string{extensionManifestFile, extensionFeaturesFile, extensionViewsFile} {
		require.NoError(t, root.Rename("flux/prior/"+name, "flux/assets/"+name))
	}
	_, err := pm.ReadExtensionAsset("flux", pin, s.Generation, "views")
	require.ErrorIs(t, err, errExtensionUnavailable, "even the original files moved into a different asset tree are not current")
}

func TestExtensionInventoryNeverTrustsDevelopmentLoad(t *testing.T) {
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	pm := newTestManager(t)
	installSignedExtension(t, pm, extensionPackage(t))
	require.NotNil(t, pm.ListPlugins()[0].Extension)
	require.NoError(t, pm.UnloadPlugin("flux"))
	_, err := pm.LoadPlugin("flux", &LoadPluginOptions{DevMode: true, DevModePath: pm.pluginsRoot.ResolvePath("flux")})
	require.NoError(t, err)
	row := pm.ListPlugins()[0]
	require.True(t, row.DevMode)
	require.Nil(t, row.Extension)
}

func TestExtensionInventoryBoundedMetadataAndExportSets(t *testing.T) {
	limit := strings.Repeat(" ", extensionManifestLimit-len(extensionTestManifest)) + extensionTestManifest
	_, _, ok := declaredModuleRoles("flux", []byte(limit))
	require.True(t, ok)
	for _, data := range []string{
		limit + " ",
		strings.Replace(extensionTestManifest, `"id":"flux"`, `"id":"flux","id":"flux"`, 1),
		strings.Replace(extensionTestManifest, `"kind":"info"`, `"kind":"info","kind":"info"`, 1),
		strings.Replace(extensionTestManifest, `"id":"flux"`, `"id":"foreign"`, 1),
		strings.Replace(extensionTestManifest, `"points":[]`, `"points":[],"url":"file:///x"`, 1),
		extensionTestManifest + `{}`, strings.Replace(extensionTestManifest, `"points":[]`, `"points":[`+strings.Repeat(`{},`, extensionListLimit)+`{}]`, 1),
	} {
		_, _, ok = declaredModuleRoles("flux", []byte(data))
		require.False(t, ok)
	}
	for _, tc := range []struct{ name, manifest, features, oversized string }{
		{"missing export", extensionTestManifest, "", ""},
		{"surplus export", extensionTestManifest, strings.Replace(extensionTestFeatures, "ex('note', note);", "ex('note', note); ex('extra', note);", 1), ""},
		{"surplus asset", `{"schemaVersion":1,"id":"flux","points":[],"offers":[],"bindings":[]}`, extensionTestFeatures, ""},
		{"oversize manifest", extensionTestManifest, extensionTestFeatures, extensionManifestFile},
		{"oversize module", extensionTestManifest, extensionTestFeatures, extensionFeaturesFile},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requireRefusedModuleSet(t, tc.manifest, tc.features, tc.oversized)
		})
	}
}

func requireRefusedModuleSet(t *testing.T, manifest, features, oversized string) {
	t.Helper()
	a := archiveExtensionInventory{id: "flux", digest: strings.Repeat("1", 64)}
	for _, member := range [...]struct {
		name, data string
		limit      int64
	}{
		{extensionManifestFile, manifest, extensionManifestLimit},
		{extensionFeaturesFile, features, extensionModuleLimit},
		{extensionViewsFile, extensionTestViews, extensionModuleLimit},
	} {
		if member.data == "" {
			continue
		}
		h := &tar.Header{Name: "assets/" + member.name, Typeflag: tar.TypeReg, Size: int64(len(member.data))}
		if member.name == oversized {
			h.Size = member.limit + 1
		}
		reader := strings.NewReader(member.data)
		out, err := a.observe(h, reader)
		require.NoError(t, err)
		if h.Size > int64(len(member.data)) {
			require.Same(t, reader, out, "do not buffer a byte of an oversized member")
		}
		_, err = io.Copy(io.Discard, out)
		require.NoError(t, err)
	}
	require.True(t, a.receipt(extensionReceipt{}.Directory).Refused)
}

var _ interface {
	ListPlugins() []plugintypes.PluginInfo
	ReadExtensionAsset(string, string, string, string) (string, error)
} = (*ServiceWrapper)(nil)
