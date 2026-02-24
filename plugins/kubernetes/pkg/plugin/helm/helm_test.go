package helm

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/repo"
)

// ---------------------------------------------------------------------------
// chartVersionToMap
// ---------------------------------------------------------------------------

func TestChartVersionToMap_BasicFields(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:        "nginx",
			Description: "An NGINX chart",
			Version:     "1.2.3",
			AppVersion:  "1.25.0",
			Deprecated:  false,
			Type:        "application",
		},
	}

	m := chartVersionToMap("bitnami", cv)

	assert.Equal(t, "bitnami/nginx", m["id"])
	assert.Equal(t, "nginx", m["name"])
	assert.Equal(t, "An NGINX chart", m["description"])
	assert.Equal(t, "1.2.3", m["version"])
	assert.Equal(t, "1.25.0", m["appVersion"])
	assert.Equal(t, "bitnami", m["repository"])
	assert.Equal(t, false, m["deprecated"])
	assert.Equal(t, "application", m["type"])
}

func TestChartVersionToMap_IDFormat(t *testing.T) {
	tests := []struct {
		repoName  string
		chartName string
		wantID    string
	}{
		{"bitnami", "redis", "bitnami/redis"},
		{"stable", "grafana", "stable/grafana"},
		{"my-repo", "my-chart", "my-repo/my-chart"},
	}

	for _, tt := range tests {
		t.Run(tt.wantID, func(t *testing.T) {
			cv := &repo.ChartVersion{
				Metadata: &chart.Metadata{Name: tt.chartName},
			}
			m := chartVersionToMap(tt.repoName, cv)
			assert.Equal(t, tt.wantID, m["id"])
		})
	}
}

func TestChartVersionToMap_DeprecatedTrue(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:       "old-chart",
			Deprecated: true,
		},
	}

	m := chartVersionToMap("stable", cv)
	assert.Equal(t, true, m["deprecated"])
}

func TestChartVersionToMap_OptionalFieldsOmittedWhenEmpty(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:        "minimal",
			Icon:        "",
			Home:        "",
			KubeVersion: "",
			Keywords:    nil,
			Maintainers: nil,
		},
	}

	m := chartVersionToMap("repo", cv)

	_, hasIcon := m["icon"]
	_, hasHome := m["home"]
	_, hasKubeVersion := m["kubeVersion"]
	_, hasKeywords := m["keywords"]
	_, hasMaintainers := m["maintainers"]

	assert.False(t, hasIcon, "icon should be omitted when empty")
	assert.False(t, hasHome, "home should be omitted when empty")
	assert.False(t, hasKubeVersion, "kubeVersion should be omitted when empty")
	assert.False(t, hasKeywords, "keywords should be omitted when empty/nil")
	assert.False(t, hasMaintainers, "maintainers should be omitted when empty/nil")
}

func TestChartVersionToMap_OptionalFieldsPresentWhenSet(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:        "full-chart",
			Icon:        "https://example.com/icon.png",
			Home:        "https://example.com",
			KubeVersion: ">=1.20.0",
		},
	}

	m := chartVersionToMap("repo", cv)

	assert.Equal(t, "https://example.com/icon.png", m["icon"])
	assert.Equal(t, "https://example.com", m["home"])
	assert.Equal(t, ">=1.20.0", m["kubeVersion"])
}

func TestChartVersionToMap_KeywordsConvertedToInterfaceSlice(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:     "tagged",
			Keywords: []string{"web", "proxy", "nginx"},
		},
	}

	m := chartVersionToMap("repo", cv)

	keywords, ok := m["keywords"].([]interface{})
	require.True(t, ok, "keywords should be []interface{}")
	assert.Len(t, keywords, 3)
	assert.Equal(t, "web", keywords[0])
	assert.Equal(t, "proxy", keywords[1])
	assert.Equal(t, "nginx", keywords[2])
}

func TestChartVersionToMap_EmptyKeywordsOmitted(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:     "no-keywords",
			Keywords: []string{},
		},
	}

	m := chartVersionToMap("repo", cv)

	_, hasKeywords := m["keywords"]
	assert.False(t, hasKeywords, "empty keywords slice should be omitted")
}

func TestChartVersionToMap_MaintainersAllFields(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name: "maintained",
			Maintainers: []*chart.Maintainer{
				{
					Name:  "Alice",
					Email: "alice@example.com",
					URL:   "https://alice.dev",
				},
			},
		},
	}

	m := chartVersionToMap("repo", cv)

	maintainers, ok := m["maintainers"].([]interface{})
	require.True(t, ok, "maintainers should be []interface{}")
	require.Len(t, maintainers, 1)

	maint, ok := maintainers[0].(map[string]interface{})
	require.True(t, ok, "each maintainer should be map[string]interface{}")
	assert.Equal(t, "Alice", maint["name"])
	assert.Equal(t, "alice@example.com", maint["email"])
	assert.Equal(t, "https://alice.dev", maint["url"])
}

func TestChartVersionToMap_MaintainersOptionalFields(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name: "maintained",
			Maintainers: []*chart.Maintainer{
				{Name: "Bob"},
				{Name: "Carol", Email: "carol@example.com"},
				{Name: "Dave", URL: "https://dave.dev"},
			},
		},
	}

	m := chartVersionToMap("repo", cv)

	maintainers, ok := m["maintainers"].([]interface{})
	require.True(t, ok)
	require.Len(t, maintainers, 3)

	bob := maintainers[0].(map[string]interface{})
	assert.Equal(t, "Bob", bob["name"])
	_, hasEmail := bob["email"]
	_, hasURL := bob["url"]
	assert.False(t, hasEmail, "email should be omitted for Bob")
	assert.False(t, hasURL, "url should be omitted for Bob")

	carol := maintainers[1].(map[string]interface{})
	assert.Equal(t, "Carol", carol["name"])
	assert.Equal(t, "carol@example.com", carol["email"])
	_, hasURL = carol["url"]
	assert.False(t, hasURL, "url should be omitted for Carol")

	dave := maintainers[2].(map[string]interface{})
	assert.Equal(t, "Dave", dave["name"])
	assert.Equal(t, "https://dave.dev", dave["url"])
	_, hasEmail = dave["email"]
	assert.False(t, hasEmail, "email should be omitted for Dave")
}

func TestChartVersionToMap_EmptyMaintainersOmitted(t *testing.T) {
	cv := &repo.ChartVersion{
		Metadata: &chart.Metadata{
			Name:        "no-maintainers",
			Maintainers: []*chart.Maintainer{},
		},
	}

	m := chartVersionToMap("repo", cv)

	_, hasMaintainers := m["maintainers"]
	assert.False(t, hasMaintainers, "empty maintainers slice should be omitted")
}

// ---------------------------------------------------------------------------
// repoEntryToMap
// ---------------------------------------------------------------------------

func TestRepoEntryToMap_HTTPRepo(t *testing.T) {
	entry := &repo.Entry{
		Name:                  "bitnami",
		URL:                   "https://charts.bitnami.com/bitnami",
		Username:              "user",
		CertFile:              "/path/to/cert",
		KeyFile:               "/path/to/key",
		CAFile:                "/path/to/ca",
		InsecureSkipTLSverify: false,
		PassCredentialsAll:    true,
	}

	m := repoEntryToMap(entry)

	assert.Equal(t, "bitnami", m["name"])
	assert.Equal(t, "https://charts.bitnami.com/bitnami", m["url"])
	assert.Equal(t, "default", m["type"], "HTTP URL should produce type 'default'")
	assert.Equal(t, "user", m["username"])
	assert.Equal(t, "/path/to/cert", m["certFile"])
	assert.Equal(t, "/path/to/key", m["keyFile"])
	assert.Equal(t, "/path/to/ca", m["caFile"])
	assert.Equal(t, false, m["insecure_skip_tls_verify"])
	assert.Equal(t, true, m["pass_credentials_all"])
}

func TestRepoEntryToMap_OCIRepo(t *testing.T) {
	entry := &repo.Entry{
		Name: "ghcr",
		URL:  "oci://ghcr.io/my-org/charts",
	}

	m := repoEntryToMap(entry)

	assert.Equal(t, "ghcr", m["name"])
	assert.Equal(t, "oci://ghcr.io/my-org/charts", m["url"])
	assert.Equal(t, "oci", m["type"], "OCI URL should produce type 'oci'")
}

func TestRepoEntryToMap_AllFieldsPresent(t *testing.T) {
	entry := &repo.Entry{
		Name: "test",
		URL:  "https://example.com",
	}

	m := repoEntryToMap(entry)

	expectedKeys := []string{
		"name", "url", "type", "username",
		"certFile", "keyFile", "caFile",
		"insecure_skip_tls_verify", "pass_credentials_all",
	}
	for _, key := range expectedKeys {
		_, exists := m[key]
		assert.True(t, exists, "key %q should always be present in result map", key)
	}
}

func TestRepoEntryToMap_EmptyOptionalFields(t *testing.T) {
	entry := &repo.Entry{
		Name: "minimal",
		URL:  "https://example.com",
	}

	m := repoEntryToMap(entry)

	assert.Equal(t, "", m["username"])
	assert.Equal(t, "", m["certFile"])
	assert.Equal(t, "", m["keyFile"])
	assert.Equal(t, "", m["caFile"])
	assert.Equal(t, false, m["insecure_skip_tls_verify"])
	assert.Equal(t, false, m["pass_credentials_all"])
}

func TestRepoEntryToMap_InsecureSkipTLS(t *testing.T) {
	entry := &repo.Entry{
		Name:                  "insecure",
		URL:                   "https://internal.example.com",
		InsecureSkipTLSverify: true,
	}

	m := repoEntryToMap(entry)
	assert.Equal(t, true, m["insecure_skip_tls_verify"])
}

// ---------------------------------------------------------------------------
// releaseToMap
// ---------------------------------------------------------------------------

func TestReleaseToMap_BasicRelease(t *testing.T) {
	rel := &release.Release{
		Name:      "my-release",
		Namespace: "default",
		Version:   3,
		Info: &release.Info{
			Status: release.StatusDeployed,
		},
	}

	m := releaseToMap(rel)

	assert.Equal(t, "my-release", m["name"])
	assert.Equal(t, "default", m["namespace"])

	// Version comes through JSON round-trip as float64.
	version, ok := m["version"].(float64)
	require.True(t, ok, "version should be a float64 after JSON round-trip")
	assert.Equal(t, float64(3), version)
}

func TestReleaseToMap_PreservesNestedInfo(t *testing.T) {
	rel := &release.Release{
		Name:      "test",
		Namespace: "kube-system",
		Info: &release.Info{
			Status:      release.StatusDeployed,
			Description: "Install complete",
			Notes:       "Access via port 8080",
		},
		Config: map[string]interface{}{
			"replicaCount": 3,
			"image": map[string]interface{}{
				"repository": "nginx",
				"tag":        "latest",
			},
		},
	}

	m := releaseToMap(rel)

	// Info is nested.
	info, ok := m["info"].(map[string]interface{})
	require.True(t, ok, "info should be a nested map")
	assert.Equal(t, "deployed", info["status"])
	assert.Equal(t, "Install complete", info["description"])
	assert.Equal(t, "Access via port 8080", info["notes"])

	// Config is nested.
	config, ok := m["config"].(map[string]interface{})
	require.True(t, ok, "config should be a nested map")
	assert.Equal(t, float64(3), config["replicaCount"])

	image, ok := config["image"].(map[string]interface{})
	require.True(t, ok, "config.image should be a nested map")
	assert.Equal(t, "nginx", image["repository"])
	assert.Equal(t, "latest", image["tag"])
}

func TestReleaseToMap_NilInfoHandled(t *testing.T) {
	rel := &release.Release{
		Name:      "bare",
		Namespace: "test-ns",
		Info:      nil,
	}

	m := releaseToMap(rel)

	// Should not panic and should contain basic fields.
	assert.Equal(t, "bare", m["name"])
	assert.Equal(t, "test-ns", m["namespace"])
}

func TestReleaseToMap_NilChartHandled(t *testing.T) {
	rel := &release.Release{
		Name:      "no-chart",
		Namespace: "default",
		Chart:     nil,
		Info: &release.Info{
			Status: release.StatusDeployed,
		},
	}

	m := releaseToMap(rel)

	assert.Equal(t, "no-chart", m["name"])
	assert.Equal(t, "default", m["namespace"])
}

func TestReleaseToMap_WithChartMetadata(t *testing.T) {
	rel := &release.Release{
		Name:      "with-chart",
		Namespace: "default",
		Version:   1,
		Info: &release.Info{
			Status: release.StatusDeployed,
		},
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Name:        "nginx",
				Version:     "15.0.0",
				Description: "NGINX Open Source",
				AppVersion:  "1.25.0",
			},
		},
	}

	m := releaseToMap(rel)

	assert.Equal(t, "with-chart", m["name"])

	// Chart metadata should survive the JSON round-trip.
	ch, ok := m["chart"].(map[string]interface{})
	require.True(t, ok, "chart should be a nested map")

	metadata, ok := ch["metadata"].(map[string]interface{})
	require.True(t, ok, "chart.metadata should be a nested map")
	assert.Equal(t, "nginx", metadata["name"])
	assert.Equal(t, "15.0.0", metadata["version"])
}

func TestReleaseToMap_EmptyConfig(t *testing.T) {
	rel := &release.Release{
		Name:      "empty-config",
		Namespace: "default",
		Info: &release.Info{
			Status: release.StatusDeployed,
		},
		Config: map[string]interface{}{},
	}

	m := releaseToMap(rel)

	// The Release.Config field has `json:"config,omitempty"`, so an empty map
	// is omitted during the JSON marshal/unmarshal round-trip.
	_, hasConfig := m["config"]
	assert.False(t, hasConfig, "empty config should be omitted due to json omitempty tag")
}

func TestReleaseToMap_PopulatedConfig(t *testing.T) {
	rel := &release.Release{
		Name:      "with-config",
		Namespace: "default",
		Info: &release.Info{
			Status: release.StatusDeployed,
		},
		Config: map[string]interface{}{
			"replicaCount": 2,
		},
	}

	m := releaseToMap(rel)

	config, ok := m["config"].(map[string]interface{})
	require.True(t, ok, "non-empty config should be present as a map")
	assert.Equal(t, float64(2), config["replicaCount"])
}
