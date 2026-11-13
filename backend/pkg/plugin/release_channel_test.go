package plugin

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	regclient "github.com/omniviewdev/registry"
	"github.com/stretchr/testify/require"
)

func TestPluginReleaseChannelPersistenceAndSelection(t *testing.T) {
	pm := newTestManager(t)
	pm.registryClient = registry.NewClient("").WithHostReleaseChannel("feature-abc")
	record := plugintypes.NewPluginRecord("sample", config.PluginMeta{ID: "sample"}, lifecycle.PhaseInstalled)
	pm.records[record.ID] = record
	require.Equal(t, "feature-abc", pm.effectiveReleaseChannel("sample"))
	require.Equal(t, "feature-abc", pm.effectiveReleaseChannel("missing"))
	record.ReleaseChannel = "stable"
	require.Equal(t, "stable", pm.effectiveReleaseChannel("sample"))
	require.Equal(t, "stable", record.ToInfo().ReleaseChannel)
	require.NoError(t, pm.writePluginStateJSON())
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, states, 1)
	require.Equal(t, "stable", states[0].ReleaseChannel)
	restored := plugintypes.NewPluginRecord("sample", config.PluginMeta{}, lifecycle.PhaseInstalled)
	restoreArchiveRecordFields(restored, &states[0])
	require.Equal(t, "stable", restored.ReleaseChannel)
}

func TestPluginChannelVersionValidation(t *testing.T) {
	pm := newTestManager(t)
	for _, pair := range [][2]string{{"nightly", "1.0.0"}, {"feature-abc", "1.0.0"}, {"feature-abc", "1.0.0-feature-other.1.1"}, {"stable", "1.0.0-feature-abc.1.1"}} {
		_, err := pm.InstallPluginChannelVersion("sample", pair[0], pair[1])
		require.EqualError(t, err, "invalid channel or version")
	}
}

func TestHostChannelSyncSkipsExplicitAndRetriesFailures(t *testing.T) {
	fail := true
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if fail { http.Error(w, "unavailable", http.StatusInternalServerError); return }
		if strings.HasSuffix(r.URL.Path, "/channels") {
			_, _ = w.Write([]byte(`{"success":true,"data":[{"channel":"feature-abc","status":"active"}]}`))
			return
		}
		require.Equal(t, "feature-abc", r.URL.Query().Get("channel"))
		_, _ = w.Write([]byte(`{"success":true,"data":[{"version":"1.0.1-feature-abc.1.1","channel":"feature-abc"}]}`))
	}))
	defer server.Close()
	pm := newTestManager(t)
	pm.registryClient = registry.NewClient(server.URL).WithHostReleaseChannel("feature-abc")
	pm.records["follow"] = plugintypes.NewPluginRecord("follow", config.PluginMeta{ID: "follow", Version: "1.0.1-feature-abc.1.1"}, lifecycle.PhaseInstalled)
	pm.records["explicit"] = plugintypes.NewPluginRecord("explicit", config.PluginMeta{ID: "explicit", Version: "1.0.0"}, lifecycle.PhaseInstalled)
	pm.records["explicit"].ReleaseChannel = "stable"
	pm.syncHostChannelPlugins(context.Background())
	_, err := os.Stat(pm.stateRoot.ResolvePath("plugin-channel-sync.json"))
	require.True(t, os.IsNotExist(err))
	fail = false
	paths = nil
	pm.syncHostChannelPlugins(context.Background())
	require.FileExists(t, pm.stateRoot.ResolvePath("plugin-channel-sync.json"))
	require.Len(t, paths, 2)
	for _, path := range paths { require.Contains(t, path, "/follow/") }
	paths = nil
	pm.syncHostChannelPlugins(context.Background())
	require.Empty(t, paths)
}

func TestHostChannelSyncInstallsSignedFeatureArchive(t *testing.T) {
	const version = "1.0.1-feature-abc.1.1"
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 1.0.0\ncapabilities: [ui]\n"},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "feature bundle"},
	})
	data, err := os.ReadFile(archive)
	require.NoError(t, err)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	require.NoError(t, regclient.AddPublicKey(hex.EncodeToString(publicKey)))
	hash := sha256.Sum256(data)
	checksum := hex.EncodeToString(hash[:])
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(checksum)))

	var server *httptest.Server
	var explicitRequests int
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/explicit/") {
			explicitRequests++
			http.Error(w, "explicit plugin must not be queried", http.StatusInternalServerError)
			return
		}
		switch {
		case r.URL.Path == "/artifact":
			_, _ = w.Write(data)
		case strings.Contains(r.URL.Path, "/download/"):
			http.Redirect(w, r, server.URL+"/artifact", http.StatusFound)
		case strings.HasSuffix(r.URL.Path, "/channels"):
			_, _ = w.Write([]byte(`{"success":true,"data":[{"channel":"feature-abc","status":"active"}]}`))
		case strings.HasSuffix(r.URL.Path, "/versions"):
			require.Equal(t, "feature-abc", r.URL.Query().Get("channel"))
			_, _ = w.Write([]byte(`{"success":true,"data":[{"version":"` + version + `","channel":"feature-abc"}]}`))
		default:
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"data": map[string]any{
					"version": version,
					"artifacts": map[string]any{
						regclient.CurrentPlatform(): map[string]string{"checksum": checksum, "signature": signature},
					},
				},
			}))
		}
	}))
	defer server.Close()

	pm := newTestManager(t)
	pm.registryClient = registry.NewClient(server.URL).WithHostReleaseChannel("feature-abc")
	for _, id := range []string{"flux", "explicit"} {
		installPluginFixture(t, pm, id, []string{"ui"}, false)
		require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath(id+"/assets"), 0755))
		_, err = pm.LoadPlugin(id, nil)
		require.NoError(t, err)
	}
	pm.records["explicit"].ReleaseChannel = "stable"
	previousVersion := pm.records["explicit"].Metadata.Version
	require.NoError(t, pm.writePluginStateJSON())
	pm.syncHostChannelPlugins(context.Background())

	require.Equal(t, version, pm.records["flux"].Metadata.Version)
	require.Empty(t, pm.records["flux"].ReleaseChannel)
	require.Equal(t, previousVersion, pm.records["explicit"].Metadata.Version)
	require.Equal(t, "stable", pm.records["explicit"].ReleaseChannel)
	require.Zero(t, explicitRequests)
	bundle, err := os.ReadFile(pm.pluginsRoot.ResolvePath("flux/assets/entry.js"))
	require.NoError(t, err)
	require.Equal(t, "feature bundle", string(bundle))
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	for _, state := range states {
		if state.ID == "flux" {
			require.Equal(t, version, state.Metadata.Version)
			require.Empty(t, state.ReleaseChannel)
		}
	}
	require.FileExists(t, pm.stateRoot.ResolvePath("plugin-channel-sync.json"))
}
