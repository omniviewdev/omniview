package updater

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	wails "github.com/wailsapp/wails/v3/pkg/updater"
)

func TestSignatureVector(t *testing.T) {
	seed, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	key := ed25519.NewKeyFromSeed(seed)
	pub := key.Public().(ed25519.PublicKey)
	if hex.EncodeToString(pub) != "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8" { t.Fatal("public key mismatch") }
	h := sha256.Sum256(pub)
	if hex.EncodeToString(h[:8]) != "56475aa75463474c" { t.Fatal("key id mismatch") }
	payload := []byte(`{"schema":"omniview-update-manifest/v1","product":"omniview","channel":"nightly","version":"0.0.0-nightly.20261112.1.1","artifacts":[]}`)
	if base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)) != "tbxUPKBag/bumf/HzNRVzUgoOgUTL2AtTfylGBAV8vowq+qWFgHYC5vwH2iLTRQejzliGakO4yk7HwM2OOnsCg==" { t.Fatal("signature mismatch") }
}

func signed(t *testing.T, m manifest, key ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(m); if err != nil { t.Fatal(err) }
	h := sha256.Sum256(key.Public().(ed25519.PublicKey))
	e := envelope{Schema: "omniview-update-envelope/v1", Payload: base64.StdEncoding.EncodeToString(payload), Signatures: []signature{{KeyID: hex.EncodeToString(h[:8]), Algorithm: "ed25519", Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}}}
	b, err := json.Marshal(e); if err != nil { t.Fatal(err) }; return b
}

func TestProvider(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize); key := ed25519.NewKeyFromSeed(seed)
	other := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{1}, ed25519.SeedSize))
	body := []byte("test")
	hash := sha256.Sum256(body)
	version := "0.0.0-nightly.20261112.1.1"
	var response []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { if strings.HasPrefix(r.URL.Path, "/channels/") { w.Write(response) } else { w.Write(body) } }))
	defer srv.Close()
	p := &Provider{channel: "nightly", root: t.TempDir(), base: srv.URL, keys: []ed25519.PublicKey{key.Public().(ed25519.PublicKey)}, client: srv.Client(), logger: log.New(io.Discard, "", 0)}
	artifactFor := func(platform, arch, suffix string) artifact { name := "Omniview_"+version+"_"+platform+"_"+arch+suffix; return artifact{Platform: platform, Arch: arch, Kind: "update", Filename: name, URL: srv.URL+"/releases/nightly/"+version+"/"+name, Size: int64(len(body)), SHA256: hex.EncodeToString(hash[:])} }
	m := manifest{Schema: "omniview-update-manifest/v1", Product: "omniview", Channel: "nightly", Version: version, Artifacts: []artifact{artifactFor("darwin", "universal", ".zip"), artifactFor("linux", "amd64", ""), artifactFor("windows", "amd64", ".exe")}}
	req := wails.CheckRequest{CurrentVersion: "0.0.0-nightly.20261111", Platform: "linux", Arch: "amd64"}
	response = signed(t, m, key)
	r, err := p.Check(context.Background(), req); if err != nil || r == nil { t.Fatalf("trusted feed: %v", err) }
	var out bytes.Buffer
	if err := p.Download(context.Background(), r, &out, nil); err != nil || !bytes.Equal(out.Bytes(), body) { t.Fatalf("download: %v", err) }
	body = append(body, 'x'); if err := p.Download(context.Background(), r, io.Discard, nil); err == nil { t.Fatal("oversized download accepted") }; body = body[:4]
	for _, arch := range []string{"amd64", "arm64"} { req.Platform, req.Arch = "darwin", arch; r, err = p.Check(context.Background(), req); if err != nil || r == nil || r.Artifact.Arch != "universal" { t.Fatalf("darwin %s: %v", arch, err) } }
	req.Platform, req.Arch = "linux", "arm64"; r, err = p.Check(context.Background(), req); if err != nil || r != nil { t.Fatalf("unsupported arch: %v", err) }
	req.Arch = "amd64"
	response = signed(t, m, other); if _, err = p.Check(context.Background(), req); err == nil { t.Fatal("untrusted accepted") }
	response = signed(t, m, key); var e envelope; json.Unmarshal(response, &e); e.Payload = base64.StdEncoding.EncodeToString([]byte("tampered")); response, _ = json.Marshal(e); if _, err = p.Check(context.Background(), req); err == nil { t.Fatal("tampering accepted") }
	wrong := m; wrong.Channel = "stable"; response = signed(t, wrong, key); if _, err = p.Check(context.Background(), req); err == nil { t.Fatal("wrong channel accepted") }
	old := m; old.Version = "0.0.0-nightly.20261111.1.1"; response = signed(t, old, key); if _, err = p.Check(context.Background(), req); err == nil || !strings.Contains(err.Error(), "feed version older than last seen") { t.Fatalf("rollback: %v", err) }
	for _, field := range []string{"filename", "url"} { bad := m; bad.Artifacts = append([]artifact(nil), m.Artifacts...); if field == "filename" { bad.Artifacts[1].Filename = "evil" } else { bad.Artifacts[1].URL = "https://evil.example/file" }; response = signed(t, bad, key); if _, err = p.Check(context.Background(), req); err == nil { t.Fatalf("bad %s accepted", field) } }
}

func TestTrustConfiguration(t *testing.T) {
	old := trustedKeysHex; defer func(){ trustedKeysHex = old }()
	trustedKeysHex = ""; p, err := NewProvider("stable", t.TempDir(), nil); if err != nil || p != nil { t.Fatal("empty trust must disable provider") }
	trustedKeysHex = "bad"; if _, err = NewProvider("stable", t.TempDir(), nil); err == nil { t.Fatal("malformed key accepted") }
	trustedKeysHex = strings.Repeat("00", 32); p, err = NewProvider("local", t.TempDir(), nil); if err != nil || p != nil { t.Fatal("local channel must disable provider") }
}

func TestCheckpointPersistsPerChannel(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	if err := checkpoint(ctx, root, "stable", "2.0.0"); err != nil { t.Fatal(err) }
	if err := checkpoint(ctx, root, "nightly", "0.0.0-nightly.20261112.1.1"); err != nil { t.Fatal(err) }
	if err := checkpoint(ctx, root, "stable", "1.0.0"); err == nil || !strings.Contains(err.Error(), "feed version older than last seen") { t.Fatalf("rollback: %v", err) }
	if err := checkpoint(ctx, root, "stable", "2.0.0"); err != nil { t.Fatal(err) }
}
