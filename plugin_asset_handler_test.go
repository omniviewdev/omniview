package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
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

func TestPinnedPageDoesNotFallBackToOrdinaryChunks(t *testing.T) {
	root := appstate.NewTestService(t).RootDir()
	require.NoError(t, root.MkdirAll("plugins/owner/assets", 0755))
	require.NoError(t, root.WriteFile("plugins/owner/assets/chunk.js", []byte("mutable"), 0644))
	handler := NewPluginAssetHandler(logging.NewNop(), root)
	handler.readPinnedPage = func(id, pin, generation, name string) ([]byte, error) {
		if id == "owner" && pin == "pin" && generation == "running" && name == "assets/chunk.js" {
			return []byte("verified"), nil
		}
		return nil, http.ErrMissingFile
	}
	for generation, status := range map[string]int{"running": http.StatusOK, "retired": http.StatusNotFound} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/_/plugins/owner/verified/pin/"+generation+"/assets/chunk.js", nil))
		require.Equal(t, status, response.Code)
		require.NotContains(t, response.Body.String(), "mutable")
		if status == http.StatusOK {
			require.Equal(t, "verified", response.Body.String())
			require.Equal(t, "application/javascript", response.Header().Get("Content-Type"))
			require.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
		}
	}
}
