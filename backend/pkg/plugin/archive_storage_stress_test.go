package plugin

import (
	"fmt"
	"sync"
	"testing"

	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// TestArchiveReplacementConcurrentAuthorityAccess exercises real archive publication
// while a retained authority resolver continues durable resource observations.
func TestArchiveReplacementConcurrentAuthorityAccess(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	state, err := appstate.New(appstate.WithRoot(pm.stateRoot.ResolvePath("")), appstate.WithFlock(false))
	require.NoError(t, err)
	defer state.Close()
	store, err := state.PluginStore("flux")
	require.NoError(t, err)
	resolver, err := hostresource.NewAuthorityResolver(store)
	require.NoError(t, err)
	catalog := resourcev2.Catalog{Provider: "native", Revision: "r1", Coverage: resourcev2.Coverage{Kind: "complete"}, Types: []resourcev2.ResourceType{{Type: "objects", DisplayName: "Objects", Representations: []resourcev2.Representation{{ID: "native", Revision: "r1"}}}}}
	_, err = resolver.ObserveCatalog("flux", "live", catalog)
	require.NoError(t, err)
	archive := writeTestTarball(t, []tarEntry{{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"}, {name: "assets/", mode: 0755, dir: true}, {name: "assets/entry.js", mode: 0644, body: "candidate"}})
	start := make(chan struct{})
	errs := make(chan error, 5)
	var workers sync.WaitGroup
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for range 10 {
				if _, err := pm.InstallPluginFromPath(archive); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	workers.Add(1)
	go func() {
		defer workers.Done()
		<-start
		for iteration := range 400 {
			if _, err := resolver.ObserveCatalog("flux", fmt.Sprintf("live-%d", iteration), catalog); err != nil {
				errs <- err
				return
			}
		}
	}()
	close(start)
	workers.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	// A new resolver models reopening durable authority state after publication.
	reopened, err := hostresource.NewAuthorityResolver(store)
	require.NoError(t, err)
	observed, err := resolver.ObserveCatalog("flux", "live-399", catalog)
	require.NoError(t, err)
	require.True(t, reopened.Matches("flux", "live-399", "native", "objects", observed["objects"].Authority))
}
