package plugin

import (
	"os"
	"path/filepath"
	"testing"

	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// Exercise the public archive transaction with the same cached capabilities
// retained by data and resource controllers, including a nested authority root.
func TestInstallPluginFromPath_RetainsLiveStorageCapabilities(t *testing.T) {
	for _, outcome := range []string{"commit", "rollback", "reserved-data", "reserved-store"} {
		t.Run(outcome, func(t *testing.T) {
			pm := newTestManager(t)
			installPluginFixture(t, pm, "flux", []string{"ui"}, false)
			require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
			_, err := pm.LoadPlugin("flux", nil)
			require.NoError(t, err)
			require.NoError(t, pm.writePluginStateJSON())
			state, err := appstate.New(appstate.WithRoot(pm.stateRoot.ResolvePath("")), appstate.WithFlock(false))
			require.NoError(t, err)
			defer state.Close()
			data, err := state.PluginData("flux")
			require.NoError(t, err)
			store, err := state.PluginStore("flux")
			require.NoError(t, err)
			resolver, err := hostresource.NewAuthorityResolver(store)
			require.NoError(t, err)
			catalog := resourcev2.Catalog{
				Provider: "native", Revision: "r1",
				Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}},
				Types: []resourcev2.ResourceType{{
					Type: "objects", DisplayName: "Objects",
					IdentityDimensions: []resourcev2.Dimension{}, QueryDimensions: []resourcev2.Dimension{},
					Representations: []resourcev2.Representation{{ID: "native", Revision: "r1", Schema: resourcev2.SchemaBinding{State: "absent"}}},
				}},
			}
			_, err = resolver.ObserveCatalog("flux", "before", catalog)
			require.NoError(t, err)
			require.NoError(t, store.MkdirAll("nested", 0700))
			authority, err := os.OpenRoot(store.ResolvePath("nested"))
			require.NoError(t, err)
			defer authority.Close()
			for _, root := range []*appstate.ScopedRoot{data, store} {
				require.NoError(t, root.WriteFile("retained", []byte("before"), 0600))
			}
			entries := []tarEntry{
				{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"},
				{name: "assets/", mode: 0755, dir: true},
				{name: "assets/entry.js", mode: 0644, body: "candidate"},
			}
			if outcome == "rollback" {
				require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
			}
			if outcome == "reserved-data" || outcome == "reserved-store" {
				name := outcome[len("reserved-"):]
				entries = append(entries, tarEntry{name: name + "/", mode: 0700, dir: true})
			}
			_, err = pm.InstallPluginFromPath(writeTestTarball(t, entries))
			if outcome == "commit" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			for name, root := range map[string]*appstate.ScopedRoot{"data": data, "store": store} {
				cached, lookupErr := map[string]func(string) (*appstate.ScopedRoot, error){"data": state.PluginData, "store": state.PluginStore}[name]("flux")
				require.NoError(t, lookupErr)
				require.Same(t, root, cached)
				retained, readErr := root.ReadFile("retained")
				require.NoError(t, readErr)
				require.Equal(t, "before", string(retained))
				require.NoError(t, root.WriteFile("after", []byte(outcome), 0600))
				live, readErr := os.ReadFile(pm.pluginsRoot.ResolvePath(filepath.Join("flux", name, "after")))
				require.NoError(t, readErr)
				require.Equal(t, outcome, string(live))
			}
			require.NoError(t, authority.WriteFile("after", []byte(outcome), 0600))
			live, err := pm.pluginsRoot.ReadFile("flux/store/nested/after")
			require.NoError(t, err)
			require.Equal(t, outcome, string(live))
			observed, err := resolver.ObserveCatalog("flux", "after", catalog)
			require.NoError(t, err)
			reloaded, err := hostresource.NewAuthorityResolver(store)
			require.NoError(t, err)
			require.True(t, reloaded.Matches("flux", "after", "native", "objects", observed["objects"].Authority))
			// Unloading a runtime does not own or invalidate appstate capabilities.
			require.NoError(t, pm.UnloadPlugin("flux"))
			require.NoError(t, data.WriteFile("unloaded", []byte("live"), 0600))
			require.NoError(t, store.WriteFile("unloaded", []byte("live"), 0600))
		})
	}
}
