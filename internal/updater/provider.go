package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	wails "github.com/wailsapp/wails/v3/pkg/updater"
	"golang.org/x/mod/semver"
)

const feedBase = "https://updates.omniview.dev"
const maxEnvelope = 1 << 20
const defaultDownloadTimeout = 2 * time.Hour

var nightlyVersion = regexp.MustCompile(`^0\.0\.0-nightly\.[0-9]{8}\.[0-9]+\.[0-9]+$`)

type signature struct {
	KeyID     string `json:"keyId"`
	Algorithm string `json:"algorithm"`
	Signature string `json:"signature"`
}
type envelope struct {
	Schema     string      `json:"schema"`
	Payload    string      `json:"payload"`
	Signatures []signature `json:"signatures"`
}
type artifact struct {
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	Kind     string `json:"kind"`
	Filename string `json:"filename"`
	URL      string `json:"url"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
}
type manifest struct {
	Schema     string     `json:"schema"`
	Product    string     `json:"product"`
	Channel    string     `json:"channel"`
	Version    string     `json:"version"`
	IssuedAt   time.Time  `json:"issuedAt"`
	Notes      string     `json:"notes"`
	ReleaseURL string     `json:"releaseUrl"`
	Artifacts  []artifact `json:"artifacts"`
}

// Provider verifies the signed feed before handing its digest to Wails.
type Provider struct {
	channel, root, base string
	keys                []ed25519.PublicKey
	client              *http.Client
	logger              *log.Logger
	downloadTimeout     time.Duration
}

// NewProvider returns nil when this build is not configured for updates.
// stateRoot must be persistent and private to this installation.
func NewProvider(channel, stateRoot string, logger *log.Logger) (*Provider, error) {
	keys, err := trustedKeys()
	if err != nil {
		return nil, err
	}
	if channel == "local" || len(keys) == 0 {
		return nil, nil
	}
	if channel != "stable" && channel != "nightly" {
		return nil, fmt.Errorf("invalid update channel %q", channel)
	}
	if stateRoot == "" {
		return nil, fmt.Errorf("update state root is empty")
	}
	if logger == nil {
		logger = log.Default()
	}
	return &Provider{channel: channel, root: stateRoot, base: feedBase, keys: keys, client: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, logger: logger}, nil
}

func (p *Provider) Name() string { return "omniview" }

func (p *Provider) get(ctx context.Context, url string) (*http.Response, error) {
	if !strings.HasPrefix(url, p.base+"/") || !strings.HasPrefix(p.base, "https://") {
		return nil, fmt.Errorf("invalid update URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("update server returned %s", resp.Status)
	}
	return resp, nil
}

func validVersion(channel, v string) bool {
	if !semver.IsValid("v"+v) || semver.Canonical("v"+v) != "v"+strings.TrimSuffix(v, semver.Build("v"+v)) {
		return false
	}
	if channel == "nightly" {
		return nightlyVersion.MatchString(v)
	}
	return semver.Prerelease("v"+v) == ""
}

func (p *Provider) Check(ctx context.Context, req wails.CheckRequest) (*wails.Release, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := p.get(ctx, p.base+"/channels/"+p.channel+".json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxEnvelope+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxEnvelope {
		return nil, fmt.Errorf("update envelope too large")
	}
	var env envelope
	if err = json.Unmarshal(data, &env); err != nil || env.Schema != "omniview-update-envelope/v1" {
		return nil, fmt.Errorf("invalid update envelope")
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil {
		return nil, fmt.Errorf("invalid update payload: %w", err)
	}
	verified := false
	for _, key := range p.keys {
		hash := sha256.Sum256(key)
		id := hex.EncodeToString(hash[:8])
		for _, sig := range env.Signatures {
			if sig.KeyID != id || sig.Algorithm != "ed25519" {
				continue
			}
			decoded, err := base64.StdEncoding.Strict().DecodeString(sig.Signature)
			if err == nil && ed25519.Verify(key, payload, decoded) {
				verified = true
				break
			}
		}
	}
	if !verified {
		return nil, fmt.Errorf("no trusted update signature")
	}
	var m manifest
	if err = json.Unmarshal(payload, &m); err != nil {
		return nil, fmt.Errorf("invalid update manifest: %w", err)
	}
	if m.Schema != "omniview-update-manifest/v1" || m.Product != "omniview" || m.Channel != p.channel || !validVersion(p.channel, m.Version) {
		return nil, fmt.Errorf("invalid update manifest identity or version")
	}
	if err = checkpoint(ctx, p.root, p.channel, m.Version, false); err != nil {
		return nil, err
	}
	current := strings.TrimPrefix(req.CurrentVersion, "v")
	if !semver.IsValid("v" + current) {
		return nil, fmt.Errorf("invalid current version %q", req.CurrentVersion)
	}
	if semver.Compare("v"+m.Version, "v"+current) <= 0 {
		return nil, nil
	}
	arch := req.Arch
	switch req.Platform {
	case "darwin":
		arch = "universal"
	case "linux", "windows":
		if arch != "amd64" {
			p.logger.Printf("unsupported architecture: %s/%s", req.Platform, arch)
			return nil, nil
		}
	default:
		p.logger.Printf("unsupported architecture: %s/%s", req.Platform, arch)
		return nil, nil
	}
	filename := "Omniview_" + m.Version + "_" + req.Platform + "_" + arch
	if req.Platform == "darwin" {
		filename += ".zip"
	}
	if req.Platform == "windows" {
		filename += ".exe"
	}
	var selected *artifact
	for i := range m.Artifacts {
		a := &m.Artifacts[i]
		if a.Platform == req.Platform && a.Arch == arch && a.Kind == "update" {
			if selected != nil {
				return nil, fmt.Errorf("duplicate update artifact")
			}
			selected = a
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("missing update artifact")
	}
	if selected.Filename != filename || selected.URL != p.base+"/releases/"+p.channel+"/"+m.Version+"/"+filename || selected.Size <= 0 || selected.Size > 1<<30 {
		return nil, fmt.Errorf("invalid update artifact")
	}
	digest, err := hex.DecodeString(selected.SHA256)
	if err != nil || len(digest) != sha256.Size || selected.SHA256 != strings.ToLower(selected.SHA256) {
		return nil, fmt.Errorf("invalid update digest")
	}
	if err = checkpoint(ctx, p.root, p.channel, m.Version, true); err != nil {
		return nil, err
	}
	return &wails.Release{Version: m.Version, Channel: m.Channel, Name: "Omniview " + m.Version, Notes: m.Notes, PublishedAt: m.IssuedAt, Artifact: wails.Artifact{Filename: filename, Size: selected.Size, Platform: req.Platform, Arch: arch}, Verification: &wails.Verification{DigestAlgo: "sha256", Digest: digest}, Metadata: map[string]any{"releaseUrl": m.ReleaseURL}}, nil
}

func (p *Provider) Download(ctx context.Context, r *wails.Release, dst io.Writer, onProgress func(int64, int64)) error {
	if r == nil || r.Channel != p.channel || !validVersion(p.channel, r.Version) || r.Artifact.Size <= 0 || r.Artifact.Size > 1<<30 {
		return fmt.Errorf("invalid update release")
	}
	a := r.Artifact
	name := "Omniview_" + r.Version + "_" + a.Platform + "_" + a.Arch
	switch {
	case a.Platform == "darwin" && a.Arch == "universal":
		name += ".zip"
	case a.Platform == "windows" && a.Arch == "amd64":
		name += ".exe"
	case a.Platform == "linux" && a.Arch == "amd64":
	default:
		return fmt.Errorf("invalid update platform")
	}
	if a.Filename != name {
		return fmt.Errorf("invalid update filename")
	}
	timeout := p.downloadTimeout
	if timeout <= 0 {
		timeout = defaultDownloadTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	resp, err := p.get(ctx, p.base+"/releases/"+p.channel+"/"+r.Version+"/"+name)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	buf := make([]byte, 32*1024)
	var total int64
	for {
		n, readErr := resp.Body.Read(buf)
		if total+int64(n) > a.Size {
			return fmt.Errorf("update artifact exceeds declared size")
		}
		if n > 0 {
			written, err := dst.Write(buf[:n])
			total += int64(written)
			if err != nil {
				return err
			}
			if written != n {
				return io.ErrShortWrite
			}
			if onProgress != nil {
				onProgress(total, a.Size)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if total != a.Size {
		return fmt.Errorf("update artifact size mismatch")
	}
	return nil
}
