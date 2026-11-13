package updater

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/releasechannel"
	wails "github.com/wailsapp/wails/v3/pkg/updater"
)

func TestSignatureVector(t *testing.T) {
	seed, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	key := ed25519.NewKeyFromSeed(seed)
	pub := key.Public().(ed25519.PublicKey)
	if hex.EncodeToString(pub) != "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8" {
		t.Fatal("public key mismatch")
	}
	h := sha256.Sum256(pub)
	if hex.EncodeToString(h[:8]) != "56475aa75463474c" {
		t.Fatal("key id mismatch")
	}
	payload := []byte(`{"schema":"omniview-update-manifest/v1","product":"omniview","channel":"nightly","version":"0.0.0-nightly.20261112.1.1","artifacts":[]}`)
	if base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)) != "tbxUPKBag/bumf/HzNRVzUgoOgUTL2AtTfylGBAV8vowq+qWFgHYC5vwH2iLTRQejzliGakO4yk7HwM2OOnsCg==" {
		t.Fatal("signature mismatch")
	}
}

func signed(t *testing.T, m manifest, key ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(key.Public().(ed25519.PublicKey))
	e := envelope{Schema: "omniview-update-envelope/v1", Payload: base64.StdEncoding.EncodeToString(payload), Signatures: []signature{{KeyID: hex.EncodeToString(h[:8]), Algorithm: "ed25519", Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}}}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestProvider(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	key := ed25519.NewKeyFromSeed(seed)
	other := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{1}, ed25519.SeedSize))
	body := []byte("test")
	hash := sha256.Sum256(body)
	version := "0.0.0-nightly.20261112.1.1"
	var response []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/channels/") {
			w.Write(response)
		} else {
			http.ServeContent(w, r, "artifact", time.Time{}, bytes.NewReader(body))
		}
	}))
	defer srv.Close()
	p := &Provider{channel: "nightly", root: t.TempDir(), base: srv.URL, keys: []ed25519.PublicKey{key.Public().(ed25519.PublicKey)}, client: srv.Client(), logger: log.New(io.Discard, "", 0)}
	artifactFor := func(platform, arch, suffix string) artifact {
		name := "Omniview_" + version + "_" + platform + "_" + arch + suffix
		return artifact{Platform: platform, Arch: arch, Kind: "update", Filename: name, URL: srv.URL + "/releases/nightly/" + version + "/" + name, Size: int64(len(body)), SHA256: hex.EncodeToString(hash[:])}
	}
	m := manifest{Schema: "omniview-update-manifest/v1", Product: "omniview", Channel: "nightly", Version: version, Artifacts: []artifact{artifactFor("darwin", "universal", ".zip"), artifactFor("linux", "amd64", ""), artifactFor("windows", "amd64", ".exe")}}
	req := wails.CheckRequest{CurrentVersion: "0.0.0-nightly.20261111", Platform: "linux", Arch: "amd64"}
	response = signed(t, m, key)
	r, err := p.Check(context.Background(), req)
	if err != nil || r == nil {
		t.Fatalf("trusted feed: %v", err)
	}
	var out bytes.Buffer
	if err := p.Download(context.Background(), r, &out, nil); err != nil || !bytes.Equal(out.Bytes(), body) {
		t.Fatalf("download: %v", err)
	}
	body = append(body, 'x')
	if err := p.Download(context.Background(), r, io.Discard, nil); err == nil {
		t.Fatal("oversized download accepted")
	}
	body = body[:4]
	for _, arch := range []string{"amd64", "arm64"} {
		req.Platform, req.Arch = "darwin", arch
		r, err = p.Check(context.Background(), req)
		if err != nil || r == nil || r.Artifact.Arch != "universal" {
			t.Fatalf("darwin %s: %v", arch, err)
		}
	}
	req.Platform, req.Arch = "linux", "arm64"
	r, err = p.Check(context.Background(), req)
	if err != nil || r != nil {
		t.Fatalf("unsupported arch: %v", err)
	}
	req.Arch = "amd64"
	response = signed(t, m, other)
	if _, err = p.Check(context.Background(), req); err == nil {
		t.Fatal("untrusted accepted")
	}
	response = signed(t, m, key)
	var e envelope
	json.Unmarshal(response, &e)
	e.Payload = base64.StdEncoding.EncodeToString([]byte("tampered"))
	response, _ = json.Marshal(e)
	if _, err = p.Check(context.Background(), req); err == nil {
		t.Fatal("tampering accepted")
	}
	wrong := m
	wrong.Channel = "stable"
	response = signed(t, wrong, key)
	if _, err = p.Check(context.Background(), req); err == nil {
		t.Fatal("wrong channel accepted")
	}
	old := m
	old.Version = "0.0.0-nightly.20261111.1.1"
	response = signed(t, old, key)
	if _, err = p.Check(context.Background(), req); err == nil || !strings.Contains(err.Error(), "feed version older than last seen") {
		t.Fatalf("rollback: %v", err)
	}
	for _, field := range []string{"filename", "url"} {
		bad := m
		bad.Artifacts = append([]artifact(nil), m.Artifacts...)
		if field == "filename" {
			bad.Artifacts[1].Filename = "evil"
		} else {
			bad.Artifacts[1].URL = "https://evil.example/file"
		}
		response = signed(t, bad, key)
		if _, err = p.Check(context.Background(), req); err == nil {
			t.Fatalf("bad %s accepted", field)
		}
	}
}

func TestTrustConfiguration(t *testing.T) {
	old := trustedKeysHex
	defer func() { trustedKeysHex = old }()
	trustedKeysHex = ""
	p, err := NewProvider("stable", t.TempDir(), nil)
	if err != nil || p != nil {
		t.Fatal("empty trust must disable provider")
	}
	trustedKeysHex = "bad"
	if _, err = NewProvider("stable", t.TempDir(), nil); err == nil {
		t.Fatal("malformed key accepted")
	}
	trustedKeysHex = strings.Repeat("00", 32)
	p, err = NewProvider("local", t.TempDir(), nil)
	if err != nil || p != nil {
		t.Fatal("local channel must disable provider")
	}
}

func TestCheckpointPersistsPerChannel(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	if err := checkpoint(ctx, root, "stable", "2.0.0", true); err != nil {
		t.Fatal(err)
	}
	if err := checkpoint(ctx, root, "nightly", "0.0.0-nightly.20261112.1.1", true); err != nil {
		t.Fatal(err)
	}
	if err := checkpoint(ctx, root, "stable", "1.0.0", true); err == nil || !strings.Contains(err.Error(), "feed version older than last seen") {
		t.Fatalf("rollback: %v", err)
	}
	if err := checkpoint(ctx, root, "stable", "2.0.0", true); err != nil {
		t.Fatal(err)
	}
}

func TestStableVersionBuildMetadata(t *testing.T) {
	for _, v := range []string{"1.2.3", "1.2.3+ci.1"} {
		if !releasechannel.ValidVersion("stable", v) {
			t.Fatalf("valid stable version rejected: %s", v)
		}
	}
	for _, v := range []string{"1.2", "1.2.3-rc.1", "1.2.3+ci..1", "01.2.3"} {
		if releasechannel.ValidVersion("stable", v) {
			t.Fatalf("invalid stable version accepted: %s", v)
		}
	}
}

func TestCheckpointAdvancesOnlyAfterArtifactValidation(t *testing.T) {
	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	var response []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(response)
	}))
	defer srv.Close()
	p := &Provider{channel: "stable", root: t.TempDir(), base: srv.URL, keys: []ed25519.PublicKey{key.Public().(ed25519.PublicKey)}, client: srv.Client(), logger: log.New(io.Discard, "", 0)}
	req := wails.CheckRequest{CurrentVersion: "1.0.0", Platform: "linux", Arch: "amd64"}
	makeManifest := func(version string) manifest {
		name := "Omniview_" + version + "_linux_amd64"
		return manifest{Schema: "omniview-update-manifest/v1", Product: "omniview", Channel: "stable", Version: version, Artifacts: []artifact{{Platform: "linux", Arch: "amd64", Kind: "update", Filename: name, URL: srv.URL + "/releases/stable/" + version + "/" + name, Size: 1, SHA256: strings.Repeat("a", 64)}}}
	}
	for _, invalid := range []string{"missing", "digest"} {
		bad := makeManifest("3.0.0")
		if invalid == "missing" {
			bad.Artifacts = nil
		} else {
			bad.Artifacts[0].SHA256 = "bad"
		}
		response = signed(t, bad, key)
		if _, err := p.Check(context.Background(), req); err == nil {
			t.Fatalf("%s artifact accepted", invalid)
		}
	}
	response = signed(t, makeManifest("2.0.0+ci.1"), key)
	release, err := p.Check(context.Background(), req)
	if err != nil || release == nil || release.Version != "2.0.0+ci.1" {
		t.Fatalf("valid stable release after invalid feed: %v, %v", release, err)
	}
	response = signed(t, makeManifest("1.5.0"), key)
	if _, err := p.Check(context.Background(), req); err == nil || !strings.Contains(err.Error(), "feed version older than last seen") {
		t.Fatalf("rollback: %v", err)
	}
}

func TestDownloadDeadlineCancelsStalledBody(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-0/1")
		w.WriteHeader(http.StatusPartialContent)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer srv.Close()
	p := &Provider{channel: "stable", base: srv.URL, client: srv.Client(), downloadTimeout: 50 * time.Millisecond}
	r := &wails.Release{Channel: "stable", Version: "1.0.0", Artifact: wails.Artifact{Platform: "linux", Arch: "amd64", Filename: "Omniview_1.0.0_linux_amd64", Size: 1}}
	if err := p.Download(context.Background(), r, io.Discard, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("stalled download: %v", err)
	}
}

func TestProviderSwitchTarget(t *testing.T) {
	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	var response []byte
	var requestedPath string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		_, _ = w.Write(response)
	}))
	defer srv.Close()
	p := &Provider{channel: "stable", root: t.TempDir(), base: srv.URL, keys: []ed25519.PublicKey{key.Public().(ed25519.PublicKey)}, client: srv.Client(), logger: log.New(io.Discard, "", 0)}
	req := wails.CheckRequest{CurrentVersion: "9.0.0", Platform: "linux", Arch: "amd64"}
	feed := func(channel, version string) manifest {
		name := "Omniview_" + version + "_linux_amd64"
		return manifest{Schema: "omniview-update-manifest/v1", Product: "omniview", Channel: channel, Version: version, Artifacts: []artifact{{Platform: "linux", Arch: "amd64", Kind: "update", Filename: name, URL: srv.URL + "/releases/" + channel + "/" + version + "/" + name, Size: 1, SHA256: strings.Repeat("a", 64)}}}
	}
	if err := p.SetTarget("nightly"); err != nil {
		t.Fatal(err)
	}
	response = signed(t, feed("nightly", "0.0.0-nightly.20261112.1.1"), key)
	r, err := p.Check(context.Background(), req)
	if err != nil || r == nil || requestedPath != "/channels/nightly.json" {
		t.Fatalf("nightly switch: release=%v path=%s err=%v", r, requestedPath, err)
	}
	if err := p.Download(context.Background(), &wails.Release{Channel: "stable", Version: "1.0.0"}, io.Discard, nil); err == nil {
		t.Fatal("download accepted non-target channel")
	}
	if err := p.SetTarget("feature-abc"); err != nil {
		t.Fatal(err)
	}
	for _, m := range []manifest{
		feed("nightly", "0.0.0-nightly.20261112.1.1"),
		feed("feature-abc", "1.0.0-feature-def.1.1"),
	} {
		response = signed(t, m, key)
		if _, err := p.Check(context.Background(), req); err == nil {
			t.Fatalf("accepted mismatched feed: %+v", m)
		}
	}
	response = signed(t, feed("feature-abc", "1.0.0-feature-abc.2.1"), key)
	if r, err := p.Check(context.Background(), req); err != nil || r == nil {
		t.Fatalf("feature switch: %v, %v", r, err)
	}
	response = signed(t, feed("feature-abc", "1.0.0-feature-abc.1.1"), key)
	if _, err := p.Check(context.Background(), req); err == nil || !strings.Contains(err.Error(), "feed version older than last seen") {
		t.Fatalf("target rollback: %v", err)
	}
	if err := p.SetTarget("feature-x"); err == nil {
		t.Fatal("invalid target accepted")
	}
	if err := p.SetTarget(""); err != nil || p.activeTarget() != "stable" {
		t.Fatalf("clearing target: %v", err)
	}
	if err := p.SetTarget("stable"); err != nil || p.activeTarget() != "stable" {
		t.Fatalf("own target: %v", err)
	}
}

func TestFetchChannelIndex(t *testing.T) {
	response := `{"schema":"omniview-channel-index/v1","generatedAt":"2026-11-13T00:00:00Z","channels":[{"channel":"feature-abc","branch":"feature/abc","status":"active","desktopVersion":"1.0.0-feature-abc.1.1"}]}`
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/channels/index.json" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, response)
	}))
	defer srv.Close()
	p := &Provider{base: srv.URL, client: srv.Client()}
	index, err := p.FetchIndex(context.Background())
	if err != nil || len(index.Channels) != 1 || index.Channels[0].Channel != "feature-abc" {
		t.Fatalf("index: %+v, %v", index, err)
	}
	response = `{"schema":"wrong"}`
	if _, err := p.FetchIndex(context.Background()); err == nil {
		t.Fatal("wrong schema accepted")
	}
	response = strings.Repeat("a", maxEnvelope+1)
	if _, err := p.FetchIndex(context.Background()); err == nil {
		t.Fatal("oversized index accepted")
	}
}

func TestDownloadRanges(t *testing.T) {
	body := bytes.Repeat([]byte("x"), (16<<20)+3)
	var ranges []string
	invalid := false
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ranges = append(ranges, r.Header.Get("Range"))
		if invalid {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.ServeContent(w, r, "artifact", time.Time{}, bytes.NewReader(body))
	}))
	defer srv.Close()
	p := &Provider{channel: "stable", base: srv.URL, client: srv.Client()}
	r := &wails.Release{Channel: "stable", Version: "1.2.3", Artifact: wails.Artifact{Platform: "linux", Arch: "amd64", Filename: "Omniview_1.2.3_linux_amd64", Size: int64(len(body))}}
	var out bytes.Buffer
	if err := p.Download(context.Background(), r, &out, nil); err != nil || !bytes.Equal(out.Bytes(), body) {
		t.Fatalf("range download: %v", err)
	}
	if len(ranges) != 2 || ranges[0] != "bytes=0-16777215" || ranges[1] != "bytes=16777216-16777218" {
		t.Fatalf("unexpected ranges: %v", ranges)
	}
	invalid = true
	if err := p.Download(context.Background(), r, io.Discard, nil); err == nil {
		t.Fatal("server ignoring Range accepted")
	}
}
