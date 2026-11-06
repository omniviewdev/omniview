package registry

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/version"
	regclient "github.com/omniviewdev/registry"
	"golang.org/x/mod/semver"
)

func TestRegistryBaseURLChange(t *testing.T) {
	serve := func(prefix string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != prefix+"/v1/plugins" {
				t.Errorf("wrong API target: %s", r.URL)
			}
			if _, err := w.Write([]byte(`{"success":true,"data":[]}`)); err != nil {
				t.Errorf("writing plugin list: %v", err)
			}
		}))
	}
	first, second := serve(""), serve("/registry")
	defer first.Close()
	defer second.Close()
	client := NewClient(first.URL)
	if _, err := client.ListPlugins(context.Background()); err != nil {
		t.Fatal(err)
	}
	client.SetBaseURL(second.URL + "/registry")
	if _, err := client.ListPlugins(context.Background()); err != nil {
		t.Fatal(err)
	}
	client.SetBaseURL(second.URL + "/registry")
	if _, err := client.ListPlugins(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestConnectionMetadataPluginRemainsDiscoverable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		plugins := []map[string]string{}
		if semver.Compare("v"+r.URL.Query().Get("ide_version"), "v0.13.0") >= 0 {
			plugins = append(plugins, map[string]string{"id": "kubernetes", "latest_version": "0.10.0"})
		}
		if err := json.NewEncoder(w).Encode(map[string]any{"success": true, "data": plugins}); err != nil {
			t.Errorf("writing compatible plugin list: %v", err)
		}
	}))
	defer server.Close()

	plugins, err := NewClient(server.URL).ListPlugins(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(plugins) != 1 || plugins[0].ID != "kubernetes" || plugins[0].LatestVer != "0.10.0" {
		t.Fatalf("connection-metadata plugin hidden by advertised host compatibility: %v", plugins)
	}
}

func TestCompatibilityTransportPreservesRequestAndNonAPIURLs(t *testing.T) {
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.RawQuery
		if r.Header.Get("Authorization") != "Bearer unchanged" {
			t.Error("lost auth")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	base, _ := url.Parse(server.URL + "/registry")
	transport := &compatibilityTransport{base: base, next: http.DefaultTransport}
	for _, path := range []string{"/registry/v1/plugins?search=a%20b&tag=one&tag=two", "/registry/artifacts/archive?sig=a%2Fb%20c", "/registry-other/v1/plugins?sig=keep", "/v1/plugins?sig=keep"} {
		req, _ := http.NewRequest(http.MethodGet, server.URL+path, nil)
		req.Header.Set("Authorization", "Bearer unchanged")
		before := req.URL.String()
		resp, err := transport.RoundTrip(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if req.URL.String() != before {
			t.Fatalf("mutated caller URL: %s", req.URL)
		}
		if strings.HasPrefix(path, "/registry/v1/") {
			q, _ := url.ParseQuery(got)
			if q.Get("search") != "a b" || len(q["tag"]) != 2 {
				t.Fatalf("lost API query: %s", got)
			}
		} else if got != req.URL.RawQuery {
			t.Fatalf("changed signed query: %s", got)
		}
	}
	// Same API path on a different origin must not receive the version either.
	foreign, _ := url.Parse("https://different.example")
	transport.base = foreign
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/plugins?sig=keep", nil)
	req.Header.Set("Authorization", "Bearer unchanged")
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if got != "sig=keep" {
		t.Fatalf("decorated foreign origin: %s", got)
	}
}

func TestDownloadLeavesSignedArtifactURLUnchanged(t *testing.T) {
	var server *httptest.Server
	artifactSeen := false
	// Deliberately put the signed artifact inside the API namespace.
	const artifactPath = "/v1/artifacts/plugin?sig=a%2Fb%20c&token=x"
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/artifacts/plugin" {
			artifactSeen = true
			if r.URL.RequestURI() != artifactPath {
				t.Errorf("changed signed URL: %s", r.URL)
			}
			if _, err := w.Write([]byte("artifact bytes")); err != nil {
				t.Errorf("writing artifact: %v", err)
			}
			return
		}
		if strings.Contains(r.URL.Path, "/download/") {
			http.Redirect(w, r, server.URL+artifactPath, http.StatusFound)
			return
		}
		if err := json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"version": "0.9.0", "artifacts": map[string]any{regclient.CurrentPlatform(): map[string]string{"checksum": strings.Repeat("0", 64)}}}}); err != nil {
			t.Errorf("writing version metadata: %v", err)
		}
	}))
	defer server.Close()
	_, err := NewClient(server.URL).DownloadPlugin(context.Background(), "plugin", "0.9.0")
	if !artifactSeen || !errors.Is(err, regclient.ErrChecksumMismatch) {
		t.Fatalf("artifactSeen=%v err=%v", artifactSeen, err)
	}
}

func TestTrailingSlashRegistryBaseURL(t *testing.T) {
	for _, changeBase := range []bool{false, true} {
		name := "new-client"
		if changeBase {
			name = "set-base-url"
		}
		t.Run(name, func(t *testing.T) {
			var server *httptest.Server
			const signedPath = "/registry/v1/artifacts/plugin?sig=a%2Fb%20c"
			artifactSeen := false
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/registry/v1/artifacts/plugin" {
					artifactSeen = true
					if r.URL.RequestURI() != signedPath {
						t.Errorf("changed signed URL: %s", r.URL)
					}
					if _, err := w.Write([]byte("artifact bytes")); err != nil {
						t.Errorf("writing artifact: %v", err)
					}
					return
				}
				if strings.Contains(r.URL.Path, "/download/") {
					http.Redirect(w, r, server.URL+signedPath, http.StatusFound)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/versions/0.9.0") {
					if err := json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"version": "0.9.0", "artifacts": map[string]any{regclient.CurrentPlatform(): map[string]string{"checksum": strings.Repeat("0", 64)}}}}); err != nil {
						t.Errorf("writing version metadata: %v", err)
					}
					return
				}
				if r.URL.Query().Get("q") != "logs & metrics" {
					t.Errorf("lost search: %s", r.URL)
				}
				if _, err := w.Write([]byte(`{"success":true,"data":[{"id":"plugin","latest_version":"0.9.0"}]}`)); err != nil {
					t.Errorf("writing plugin list: %v", err)
				}
			}))
			defer server.Close()
			client := NewClient(server.URL + "/registry/")
			if changeBase {
				client = NewClient("https://unused.example")
				client.SetBaseURL(server.URL + "/registry/")
			}
			plugins, err := client.SearchPlugins(context.Background(), "logs & metrics", "", "")
			if err != nil || len(plugins) != 1 || plugins[0].LatestVer != "0.9.0" {
				t.Fatalf("search: plugins=%v err=%v", plugins, err)
			}
			_, err = client.DownloadPlugin(context.Background(), "plugin", "0.9.0")
			if !artifactSeen || !errors.Is(err, regclient.ErrChecksumMismatch) {
				t.Fatalf("artifactSeen=%v err=%v", artifactSeen, err)
			}
		})
	}
}

func TestVersionDiscoveryPaginatesAndExplainsCompatibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("include_incompatible") != "true" {
			t.Errorf("missing truthful discovery context: %s", r.URL)
		}
		w.Header().Set("X-Omniview-Incompatible-Versions", "true")
		body := `{"success":true,"data":[{"version":"0.9.0","min_ide_version":"0.20.0"}],"pagination":{"page":1,"total_pages":2}}`
		if r.URL.Query().Get("page") == "2" {
			body = `{"success":true,"data":[{"version":"0.15.0","min_ide_version":"999.0.0"},{"version":"0.14.0","min_ide_version":"0.24.0"}],"pagination":{"page":2,"total_pages":2}}`
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	versions, err := NewClient(server.URL).GetPluginVersions(context.Background(), "kubernetes")
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 3 || versions[0].Version != "0.15.0" || versions[1].Version != "0.14.0" {
		t.Fatalf("lost semantic order or pages: %#v", versions)
	}
	if versions[0].Compatible || !versions[1].Compatible || !versions[1].DiscoverySupported {
		t.Fatalf("incorrect compatibility evidence: %#v", versions)
	}
}

func TestVersionDiscoveryDoesNotClaimOlderAPISupport(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte(`{"success":true,"data":[{"version":"0.14.0","min_ide_version":"0.24.0"}]}`)); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	versions, err := NewClient(server.URL).GetPluginVersions(context.Background(), "kubernetes")
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || !versions[0].Compatible || versions[0].DiscoverySupported {
		t.Fatalf("older API claimed full discovery: %#v", versions)
	}
}

func TestCompatibilityBoundsFailClosed(t *testing.T) {
	for _, bounds := range [][2]string{{"bad", ""}, {"0.25.0", "0.24.0"}, {"", "0.0.1"}, {"999.0.0", ""}} {
		if compatibilityReason(bounds[0], bounds[1]) == "" {
			t.Fatalf("accepted incompatible bounds: %v", bounds)
		}
	}
	if reason := compatibilityReason(version.CompatibilityVersion(), version.CompatibilityVersion()); reason != "" {
		t.Fatalf("rejected inclusive boundary: %s", reason)
	}
}

func TestRegistryReplacementKeepsPaginationOnOneOrigin(t *testing.T) {
	var client *Client
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("in-flight listing changed registry origin")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer second.Close()
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client.SetBaseURL(second.URL)
		body := `{"success":true,"data":[{"id":"first"}],"pagination":{"page":1,"total_pages":2}}`
		if r.URL.Query().Get("page") == "2" {
			body = `{"success":true,"data":[{"id":"second"}],"pagination":{"page":2,"total_pages":2}}`
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Error(err)
		}
	}))
	defer first.Close()
	client = NewClient(first.URL)
	plugins, err := client.ListPlugins(context.Background())
	if err != nil || len(plugins) != 2 || client.BaseURL() != second.URL {
		t.Fatalf("registry replacement lost request snapshot: %v, %#v", err, plugins)
	}
}

func TestDiscoveryDoesNotRelaxExactInstallLookup(t *testing.T) {
	exactRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/versions") {
			w.Header().Set("X-Omniview-Incompatible-Versions", "true")
			if _, err := w.Write([]byte(`{"success":true,"data":[{"version":"0.15.0","min_ide_version":"999.0.0"}]}`)); err != nil {
				t.Error(err)
			}
			return
		}
		exactRequests++
		if r.URL.Query().Has("include_incompatible") {
			t.Errorf("install lookup bypassed compatibility: %s", r.URL)
		}
		http.Error(w, "incompatible version", http.StatusNotFound)
	}))
	defer server.Close()
	client := NewClient(server.URL)
	if _, err := client.GetPluginVersions(context.Background(), "kubernetes"); err != nil {
		t.Fatal(err)
	}
	if path, err := client.DownloadPlugin(context.Background(), "kubernetes", "0.15.0"); err == nil || path != "" {
		t.Fatalf("incompatible install succeeded: %q, %v", path, err)
	}
	if exactRequests != 1 {
		t.Fatalf("unexpected install requests: %d", exactRequests)
	}
}
