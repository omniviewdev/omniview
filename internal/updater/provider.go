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
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/releasechannel"
	wails "github.com/wailsapp/wails/v3/pkg/updater"
	"golang.org/x/mod/semver"
)

const feedBase = "https://updates.omniview.dev"
const maxEnvelope = 1 << 20
const defaultDownloadTimeout = 2 * time.Hour

type IndexEntry struct {
	Channel        string `json:"channel"`
	Branch         string `json:"branch"`
	Status         string `json:"status"`
	DesktopVersion string `json:"desktopVersion"`
}

type ChannelIndex struct {
	Schema      string       `json:"schema"`
	GeneratedAt time.Time    `json:"generatedAt"`
	Channels    []IndexEntry `json:"channels"`
}

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
	mu                  sync.Mutex
	target              string
}

// NewProvider returns nil when this build is not configured for updates.
// stateRoot must be persistent and private to this installation.
func NewProvider(channel, stateRoot string, logger *log.Logger) (*Provider, error) {
	keys, err := trustedKeys()
	if err != nil {
		return nil, err
	}
	return NewProviderWithConfig(channel, stateRoot, logger, feedBase, keys, http.DefaultClient)
}

// NewProviderWithConfig constructs a provider using the supplied feed and trust configuration.
// stateRoot must be persistent and private to this installation.
func NewProviderWithConfig(channel, stateRoot string, logger *log.Logger, base string, keys []ed25519.PublicKey, client *http.Client) (*Provider, error) {
	if channel == "local" || len(keys) == 0 {
		return nil, nil
	}
	if !releasechannel.Valid(channel) {
		return nil, fmt.Errorf("invalid update channel %q", channel)
	}
	if stateRoot == "" {
		return nil, fmt.Errorf("update state root is empty")
	}
	if !strings.HasPrefix(base, "https://") || strings.HasSuffix(base, "/") || client == nil {
		return nil, fmt.Errorf("invalid update provider configuration")
	}
	for _, key := range keys {
		if len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("invalid update public key")
		}
	}
	if logger == nil {
		logger = log.Default()
	}
	httpClient := *client
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Provider{channel: channel, root: stateRoot, base: base, keys: keys, client: &httpClient, logger: logger}, nil
}

func (p *Provider) Name() string { return "omniview" }

// SetTarget selects a channel for the next check and download.
func (p *Provider) SetTarget(channel string) error {
	if channel != "" && !releasechannel.Valid(channel) {
		return fmt.Errorf("invalid update channel %q", channel)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if channel == p.channel {
		channel = ""
	}
	p.target = channel
	return nil
}

func (p *Provider) activeTarget() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.target != "" {
		return p.target
	}
	return p.channel
}

// FetchIndex retrieves the unsigned channel index. Individual feeds remain signed.
func (p *Provider) FetchIndex(ctx context.Context) (ChannelIndex, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := p.get(ctx, p.base+"/channels/index.json")
	if err != nil {
		return ChannelIndex{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxEnvelope+1))
	if err != nil {
		return ChannelIndex{}, err
	}
	if len(data) > maxEnvelope {
		return ChannelIndex{}, fmt.Errorf("channel index too large")
	}
	var index ChannelIndex
	if err := json.Unmarshal(data, &index); err != nil || index.Schema != "omniview-channel-index/v1" {
		return ChannelIndex{}, fmt.Errorf("invalid channel index")
	}
	return index, nil
}

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

func (p *Provider) Check(ctx context.Context, req wails.CheckRequest) (*wails.Release, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	target := p.activeTarget()
	resp, err := p.get(ctx, p.base+"/channels/"+target+".json")
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
	if m.Schema != "omniview-update-manifest/v1" || m.Product != "omniview" || m.Channel != target || !releasechannel.ValidVersion(target, m.Version) {
		return nil, fmt.Errorf("invalid update manifest identity or version")
	}
	if err = checkpoint(ctx, p.root, target, m.Version, false); err != nil {
		return nil, err
	}
	if target == p.channel {
		current := strings.TrimPrefix(req.CurrentVersion, "v")
		if !semver.IsValid("v" + current) {
			return nil, fmt.Errorf("invalid current version %q", req.CurrentVersion)
		}
		if semver.Compare("v"+m.Version, "v"+current) <= 0 {
			return nil, nil
		}
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
	if selected.Filename != filename || selected.URL != p.base+"/releases/"+target+"/"+m.Version+"/"+filename || selected.Size <= 0 || selected.Size > 1<<30 {
		return nil, fmt.Errorf("invalid update artifact")
	}
	digest, err := hex.DecodeString(selected.SHA256)
	if err != nil || len(digest) != sha256.Size || selected.SHA256 != strings.ToLower(selected.SHA256) {
		return nil, fmt.Errorf("invalid update digest")
	}
	if err = checkpoint(ctx, p.root, target, m.Version, true); err != nil {
		return nil, err
	}
	return &wails.Release{Version: m.Version, Channel: m.Channel, Name: "Omniview " + m.Version, Notes: m.Notes, PublishedAt: m.IssuedAt, Artifact: wails.Artifact{Filename: filename, Size: selected.Size, Platform: req.Platform, Arch: arch}, Verification: &wails.Verification{DigestAlgo: "sha256", Digest: digest}, Metadata: map[string]any{"releaseUrl": m.ReleaseURL}}, nil
}

func (p *Provider) Download(ctx context.Context, r *wails.Release, dst io.Writer, onProgress func(int64, int64)) error {
	target := p.activeTarget()
	if r == nil || r.Channel != target || !releasechannel.ValidVersion(target, r.Version) || r.Artifact.Size <= 0 || r.Artifact.Size > 1<<30 {
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
	const chunkSize int64 = 16 << 20
	url := p.base + "/releases/" + target + "/" + r.Version + "/" + name
	buf := make([]byte, 32*1024)
	var total int64
	for total < a.Size {
		start := total
		end := start + chunkSize - 1
		if end >= a.Size {
			end = a.Size - 1
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
		req.Header.Set("Accept-Encoding", "identity")
		resp, err := p.client.Do(req)
		if err != nil {
			return err
		}
		expected := fmt.Sprintf("bytes %d-%d/%d", start, end, a.Size)
		if resp.StatusCode != http.StatusPartialContent || resp.Header.Get("Content-Range") != expected {
			resp.Body.Close()
			return fmt.Errorf("invalid update range response")
		}
		for {
			n, readErr := resp.Body.Read(buf)
			if total+int64(n) > end+1 {
				resp.Body.Close()
				return fmt.Errorf("update artifact exceeds requested range")
			}
			if n > 0 {
				written, err := dst.Write(buf[:n])
				total += int64(written)
				if err != nil {
					resp.Body.Close()
					return err
				}
				if written != n {
					resp.Body.Close()
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
				resp.Body.Close()
				return readErr
			}
		}
		resp.Body.Close()
		if total != end+1 {
			if err := ctx.Err(); err != nil {
				return err
			}
			return fmt.Errorf("update artifact size mismatch")
		}
	}
	return nil
}
