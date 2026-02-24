package registry

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// Constants for the CDN
const (
	BaseURL    = "https://cdn.plugins.omniview.dev"
	UserAgent  = "Omniview-Plugin-Client/1.0"
	TimeoutSec = 15
)

var client = &http.Client{Timeout: TimeoutSec * time.Second}

type PluginRegistry struct {
	Plugins []Plugin `json:"plugins"`
}

type Plugin struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Icon          string        `json:"icon"`
	Description   string        `json:"description"`
	Official      bool          `json:"official"`
	LatestVersion PluginVersion `json:"latest_version"`
}

type PluginVersions struct {
	Latest   string
	Versions []string
}

type PluginIndex struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Icon          string          `json:"icon"`
	Description   string          `json:"description"`
	Official      bool            `json:"official"`
	LatestVersion PluginVersion   `json:"latest_version"`
	Versions      []PluginVersion `json:"versions"`

	expires time.Time
}

type PluginVersion struct {
	Metadata      config.PluginMeta         `json:"metadata"`
	Version       string                    `json:"version"`
	Architectures map[string]PluginArtifact `json:"architectures"`
	Created       time.Time                 `json:"created"`
	Updated       time.Time                 `json:"updated"`
}

type Maintainer struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type PluginTheme struct {
	Colors map[string]string `json:"colors"`
}

type PluginArtifact struct {
	Checksum    string `json:"checksum"`
	Signature   string `json:"signature"`
	DownloadURL string `json:"download_url"`
	Size        int64  `json:"size"`
}

// --- Public API ---

type RegistryClient struct {
	baseURL   string
	indexURL  string
	userAgent string
	timeout   time.Duration

	index         *PluginRegistry
	pluginIndexes map[string]*PluginIndex
	indexExpires  time.Time
}

func NewRegistryClient() *RegistryClient {
	return &RegistryClient{
		baseURL:       BaseURL,
		indexURL:      BaseURL + "/index.json",
		userAgent:     UserAgent,
		timeout:       time.Second * 15,
		pluginIndexes: make(map[string]*PluginIndex),
	}
}

func (rc *RegistryClient) getPluginArtifact(
	pluginID string,
	version string,
) (PluginArtifact, error) {
	// check the index to see if we have it
	plugin, ok := rc.pluginIndexes[pluginID]
	if !ok {
		index, err := rc.GetPluginIndex(pluginID)
		if err != nil {
			return PluginArtifact{}, err
		}
		plugin = index
		rc.pluginIndexes[pluginID] = index
	}

	platform := rc.getCurrentPlatform()
	// check the index
	for _, v := range plugin.Versions {
		if v.Version == version {
			// check architectures to make sure compatible
			artifact, ok := v.Architectures[platform]
			if !ok {
				return PluginArtifact{}, apperror.New(apperror.TypePluginInstallFailed, 404, "Platform not supported", fmt.Sprintf("Plugin version does not have a build for platform '%s'.", platform))
			}

			// we have a successful artifact
			return artifact, nil
		}
	}

	// if we've gotten here, no version found
	return PluginArtifact{}, apperror.New(apperror.TypePluginInstallFailed, 404, "Plugin artifact not found", fmt.Sprintf("No artifact found for plugin '%s' version '%s'.", pluginID, version))
}

func (rc *RegistryClient) ListPlugins() ([]Plugin, error) {
	if rc.index != nil && rc.indexExpires.After(time.Now()) {
		return rc.index.Plugins, nil
	}

	resp, err := rc.get(rc.indexURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var registry PluginRegistry
	if err := json.NewDecoder(resp.Body).Decode(&registry); err != nil {
		return nil, err
	}

	rc.index = &registry
	rc.indexExpires = time.Now().Add(time.Minute * 1)
	return registry.Plugins, nil
}

func (rc *RegistryClient) GetPluginVersions(pluginID string) PluginVersions {
	var versions PluginVersions

	index, err := rc.GetPluginIndex(pluginID)
	if err != nil {
		return versions
	}

	// go through index and get latest
	versions.Latest = index.LatestVersion.Version
	versions.Versions = make([]string, 0, len(index.Versions))
	for _, version := range index.Versions {
		versions.Versions = append(versions.Versions, version.Version)
	}

	return versions
}

func (rc *RegistryClient) GetPluginIndex(pluginID string) (*PluginIndex, error) {
	i, ok := rc.pluginIndexes[pluginID]
	if ok && i != nil && i.expires.After(time.Now()) {
		return i, nil
	}

	resp, err := rc.get(fmt.Sprintf("%s/%s/index.json", rc.baseURL, pluginID))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var index PluginIndex
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		return nil, err
	}

	index.expires = time.Now().Add(time.Minute * 2)
	return &index, nil
}

// GetCurrentPlatform returns a normalized platform_arch string used in plugin metadata keys
func (rc *RegistryClient) getCurrentPlatform() string {
	platform := runtime.GOOS
	arch := runtime.GOARCH

	// normalize (e.g. amd64 vs x86_64 or arm64 vs aarch64)
	switch arch {
	case "amd64":
		arch = "amd64"
	case "arm64":
		arch = "arm64"
	default:
		// fallback, but these are the only supported ones in the plugin registry so far
		arch = runtime.GOARCH
	}

	return fmt.Sprintf("%s_%s", platform, arch)
}

func (rc *RegistryClient) DownloadAndPrepare(
	pluginID, version string,
) (string, error) {
	artifact, err := rc.getPluginArtifact(pluginID, version)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("%s/%s", rc.baseURL, artifact.DownloadURL)
	resp, err := rc.get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	tmpFile, err := os.CreateTemp("", "plugin-*.tar.gz")
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()

	hasher := sha256.New()
	multi := io.MultiWriter(tmpFile, hasher)

	if _, err := io.Copy(multi, resp.Body); err != nil {
		return "", err
	}

	actual := hex.EncodeToString(hasher.Sum(nil))
	if actual != artifact.Checksum {
		return "", apperror.New(apperror.TypeValidation, 422, "Checksum mismatch", fmt.Sprintf("Downloaded file checksum '%s' does not match expected '%s'. The file may be corrupted.", actual, artifact.Checksum))
	}

	if err := VerifyArtifactSignature(artifact.Checksum, artifact.Signature); err != nil {
		if errors.Is(err, ErrUnsignedArtifact) {
			return "", apperror.New(apperror.TypeValidation, 422, "Plugin not signed", fmt.Sprintf("Plugin '%s@%s' is not signed.", pluginID, version))
		}
		return "", apperror.WrapWithDetail(err, apperror.TypeValidation, 422, "Signature verification failed", fmt.Sprintf("Signature verification failed for plugin '%s@%s'.", pluginID, version))
	}

	if _, err := tmpFile.Seek(0, io.SeekStart); err != nil {
		return "", err
	}

	return tmpFile.Name(), nil
}

// --- Internal helpers ---

func (rc *RegistryClient) get(url string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", UserAgent)
	return client.Do(req)
}
