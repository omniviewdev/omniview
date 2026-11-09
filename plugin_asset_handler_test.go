package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/require"
)

func TestPluginAssetUpgradeDoesNotCacheStableChunkNames(t *testing.T) {
	state := appstate.NewTestService(t)
	root := state.RootDir()
	require.NoError(t, root.MkdirAll("plugins/kubernetes/assets", 0755))
	handler := NewPluginAssetHandler(logging.NewNop(), root)
	for _, asset := range []string{"entry.js", "entry2.js", "ResourceView.js", "styles.css"} {
		t.Run(asset, func(t *testing.T) {
			filename := "plugins/kubernetes/assets/" + asset
			for _, generation := range []string{"old generation", "new generation"} {
				require.NoError(t, root.WriteFile(filename, []byte(generation), 0644))
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/_/"+filename, nil))
				require.Equal(t, http.StatusOK, response.Code)
				require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
				require.Equal(t, generation, response.Body.String())
			}
		})
	}
}
