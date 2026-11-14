package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/releasechannel"
	feed "github.com/omniviewdev/omniview/internal/updater"
	wailsupdater "github.com/wailsapp/wails/v3/pkg/updater"
)

type updateTestHost struct{}

func (updateTestHost) Emit(string, ...any) bool                                        { return false }
func (updateTestHost) OnEvent(string, func(any)) func()                                { return func() {} }
func (updateTestHost) OpenWindow(wailsupdater.WindowOptions) wailsupdater.WindowHandle { return nil }
func (updateTestHost) Quit()                                                           {}

func TestUpdateServiceUnconfigured(t *testing.T) {
	u := wailsupdater.New(updateTestHost{})
	s := &UpdateService{updater: u, channel: releasechannel.Stable}
	if err := s.SwitchChannel(releasechannel.Nightly, false); err == nil || err.Error() != "updater is not configured" {
		t.Fatalf("SwitchChannel: %v", err)
	}
	list := s.ListChannels()
	if list.Current != releasechannel.Stable || len(list.Options) != 2 {
		t.Fatalf("ListChannels: %+v", list)
	}
	if got := s.Status(); got.Channel != releasechannel.Stable || got.SwitchTarget != "" {
		t.Fatalf("Status: %+v", got)
	}
}

func TestUpdateServiceListCurrentRetired(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.Mkdir(filepath.Join(home, releasechannel.StateLabel("feature-abc")), 0700); err != nil {
		t.Fatal(err)
	}
	s := &UpdateService{channel: "feature-abc"}
	list := s.ListChannels()
	if len(list.Options) != 3 || list.Options[2].Status != "archived" || !list.Options[2].StateExists {
		t.Fatalf("ListChannels: %+v", list)
	}
	if list.Options[2].StatePath != filepath.Join(home, ".omniview-feature-abc") {
		t.Fatalf("channel path: %q", list.Options[2].StatePath)
	}
}

func TestUpdateServiceListCurrentCustomRoot(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	root := t.TempDir()
	s := &UpdateService{channel: releasechannel.Stable, root: root}
	list := s.ListChannels()
	if list.Options[0].StatePath != root || !list.Options[0].StateExists {
		t.Fatalf("current channel: %+v", list.Options[0])
	}
	if want := filepath.Join(home, ".omniview-nightly"); list.Options[1].StatePath != want || list.Options[1].StateExists {
		t.Fatalf("other channel: %+v", list.Options[1])
	}
}

func TestUpdateServiceProfileMetadata(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	root := filepath.Join(home, ".omniview")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "settings.db"), []byte("settings"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &UpdateService{channel: releasechannel.Stable, root: root}
	option := s.ListChannels().Options[0]
	if option.StateInUse != "in-use" || option.StateModifiedAt == "" || option.StateFileModifiedAt["settings.db"] == "" {
		t.Fatalf("profile metadata: %+v", option)
	}
	if _, ok := option.StateFileModifiedAt["plugin_state.json"]; ok {
		t.Fatalf("reported missing file: %+v", option.StateFileModifiedAt)
	}
}

func TestSwitchChannelDownloadsAndSeeds(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	root := filepath.Join(home, ".omniview")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	public := key.Public().(ed25519.PublicKey)
	body := []byte("nightly binary")
	digest := sha256.Sum256(body)
	version := "0.0.0-nightly.20261112.1.1"
	filename := "Omniview_" + version + "_linux_amd64"
	var createTargetDuringCheck atomic.Bool
	var failDownload atomic.Bool
	var base string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/channels/index.json":
			fmt.Fprint(w, `{"schema":"omniview-channel-index/v1","channels":[{"channel":"feature-abc","branch":"feature/abc","status":"active","desktopVersion":"1.0.1-feature-abc.1.1"}]}`)
		case "/channels/nightly.json":
			if createTargetDuringCheck.Load() {
				if err := os.Mkdir(filepath.Join(home, ".omniview-nightly"), 0700); err != nil {
					t.Error(err)
				}
			}
			payload, err := json.Marshal(map[string]any{
				"schema": "omniview-update-manifest/v1", "product": "omniview",
				"channel": "nightly", "version": version,
				"issuedAt": time.Now().UTC(),
				"artifacts": []any{map[string]any{
					"platform": "linux", "arch": "amd64", "kind": "update",
					"filename": filename, "url": base + "/releases/nightly/" + version + "/" + filename,
					"size": len(body), "sha256": hex.EncodeToString(digest[:]),
				}},
			})
			if err != nil {
				t.Error(err)
				return
			}
			keyID := sha256.Sum256(public)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"schema":  "omniview-update-envelope/v1",
				"payload": base64.StdEncoding.EncodeToString(payload),
				"signatures": []any{map[string]string{
					"keyId": hex.EncodeToString(keyID[:8]), "algorithm": "ed25519",
					"signature": base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)),
				}},
			})
		case "/releases/nightly/" + version + "/" + filename:
			if failDownload.Load() {
				http.Error(w, "download failed", http.StatusInternalServerError)
				return
			}
			http.ServeContent(w, r, filename, time.Time{}, bytes.NewReader(body))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	base = server.URL
	provider, err := feed.NewProviderWithConfig("stable", root, nil, base, []ed25519.PublicKey{public}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	u := wailsupdater.New(updateTestHost{})
	if err := u.Init(wailsupdater.Config{CurrentVersion: "1.0.0", Platform: "linux", Arch: "amd64", Providers: []wailsupdater.Provider{provider}, Window: wailsupdater.WindowNone}); err != nil {
		t.Fatal(err)
	}
	s := &UpdateService{updater: u, provider: provider, configured: true, channel: "stable", root: root}
	list := s.ListChannels()
	if len(list.Options) != 3 || list.Options[2].Channel != "feature-abc" || list.Options[2].DesktopVersion == "" {
		t.Fatalf("ListChannels: %+v", list)
	}
	if err := s.SwitchChannel("feature-missing", false); err == nil || !strings.Contains(err.Error(), "has no active desktop release") {
		t.Fatalf("missing feature: %v", err)
	}
	createTargetDuringCheck.Store(true)
	if err := s.SwitchChannel("nightly", true); err == nil {
		t.Fatal("switch accepted concurrently created target")
	}
	if s.Status().State == string(wailsupdater.StateReady) {
		t.Fatal("seed failure left update staged")
	}
	createTargetDuringCheck.Store(false)
	if err := os.Remove(filepath.Join(home, ".omniview-nightly")); err != nil {
		t.Fatal(err)
	}
	failDownload.Store(true)
	if err := s.SwitchChannel("nightly", true); err == nil {
		t.Fatal("failed download succeeded")
	}
	if _, err := os.Lstat(filepath.Join(home, ".omniview-nightly")); !os.IsNotExist(err) {
		t.Fatalf("failed download left seed target: %v", err)
	}
	failDownload.Store(false)
	if err := s.SwitchChannel("nightly", true); err != nil {
		t.Fatal(err)
	}
	status := s.Status()
	if status.State != string(wailsupdater.StateReady) || status.SwitchTarget != "nightly" || status.AvailableVersion != version {
		t.Fatalf("Status: %+v", status)
	}
	data, err := os.ReadFile(filepath.Join(home, ".omniview-nightly", "switch-seed.json"))
	if err != nil {
		t.Fatal(err)
	}
	var seed struct {
		Schema string `json:"schema"`
		Source string `json:"source"`
	}
	if err := json.Unmarshal(data, &seed); err != nil || seed.Schema != "omniview-switch-seed/v1" || seed.Source != root {
		t.Fatalf("seed: %s: %v", data, err)
	}
	if err := s.SwitchChannel("feature-abc", false); err == nil || !strings.Contains(err.Error(), "restart to apply") {
		t.Fatalf("switch while ready: %v", err)
	}
}

