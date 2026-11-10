package telemetry

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHostProfileClientLabel(t *testing.T) {
	for _, clientID := range []string{"", "work-laptop"} {
		t.Run(clientID, func(t *testing.T) {
			profiles := make(chan string, 8)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/ingest" {
					select {
					case profiles <- r.URL.Query().Get("name"):
					default:
					}
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()
			t.Setenv("PYROSCOPE_ADHOC_SERVER_ADDRESS", server.URL)
			profiler, err := startProfiling("test", server.URL, clientID)
			require.NoError(t, err)
			require.NoError(t, profiler.Stop())
			select {
			case name := <-profiles:
				if clientID == "" {
					require.NotContains(t, name, "omniview_client_id=")
				} else {
					require.Contains(t, name, "omniview_client_id="+clientID)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("profile was not exported")
			}
		})
	}
}
