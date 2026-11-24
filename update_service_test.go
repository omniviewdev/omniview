package main

import (
	"bytes"
	"context"
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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/releasechannel"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	feed "github.com/omniviewdev/omniview/internal/updater"
	"github.com/wailsapp/wails/v3/pkg/application"
	wailsupdater "github.com/wailsapp/wails/v3/pkg/updater"
)

// feedRequestCounts counts and steers requests to a signed feed fixture.
type feedRequestCounts struct {
	manifest       atomic.Int32
	payload        atomic.Int32
	failDownload   atomic.Bool
	blockPayload   atomic.Bool
	onManifest     atomic.Pointer[func()]
	payloadStarted chan struct{}
}

// newSignedFeedFixture serves a signed nightly manifest for version and its
// linux/amd64 payload. The provider follows providerChannel and keeps its
// rollback checkpoints in root.
func newSignedFeedFixture(t *testing.T, version, providerChannel, root string) (*httptest.Server, *feed.Provider, *feedRequestCounts) {
	t.Helper()
	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	public := key.Public().(ed25519.PublicKey)
	body := []byte("nightly binary")
	digest := sha256.Sum256(body)
	filename := "Omniview_" + version + "_linux_amd64"
	requests := &feedRequestCounts{payloadStarted: make(chan struct{}, 1)}
	var base string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/channels/index.json":
			fmt.Fprint(w, `{"schema":"omniview-channel-index/v1","channels":[{"channel":"feature-abc","branch":"feature/abc","status":"active","desktopVersion":"1.0.1-feature-abc.1.1"}]}`)
		case "/channels/nightly.json":
			requests.manifest.Add(1)
			if hook := requests.onManifest.Load(); hook != nil {
				(*hook)()
			}
			payload, err := json.Marshal(map[string]any{
				"schema": "omniview-update-manifest/v1", "product": "omniview",
				"channel": "nightly", "version": version,
				"issuedAt": time.Now().UTC(), "releaseUrl": "https://example.test/notes",
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
			requests.payload.Add(1)
			if requests.failDownload.Load() {
				http.Error(w, "download failed", http.StatusInternalServerError)
				return
			}
			if requests.blockPayload.Load() {
				select {
				case requests.payloadStarted <- struct{}{}:
				default:
				}
				<-r.Context().Done()
				return
			}
			http.ServeContent(w, r, filename, time.Time{}, bytes.NewReader(body))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	base = server.URL
	provider, err := feed.NewProviderWithConfig(providerChannel, root, nil, base, []ed25519.PublicKey{public}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	return server, provider, requests
}

func newTestUpdater(t *testing.T, provider *feed.Provider, currentVersion string) *wailsupdater.Updater {
	t.Helper()
	u := wailsupdater.New(updateTestHost{})
	if err := u.Init(wailsupdater.Config{CurrentVersion: currentVersion, Platform: "linux", Arch: "amd64", Providers: []wailsupdater.Provider{provider}, Window: wailsupdater.WindowNone}); err != nil {
		t.Fatal(err)
	}
	return u
}

const (
	testNightlyCurrent = "0.0.0-nightly.20261111.1.1"
	testNightlyNext    = "0.0.0-nightly.20261112.1.1"
)

// newModeTestService returns a configured nightly service whose update mode is *mode.
func newModeTestService(t *testing.T, mode *atomic.Value) (*UpdateService, *feedRequestCounts) {
	t.Helper()
	_, provider, requests := newSignedFeedFixture(t, testNightlyNext, "nightly", t.TempDir())
	s := &UpdateService{
		updater: newTestUpdater(t, provider, testNightlyCurrent), provider: provider, configured: true,
		channel: "nightly", updateMode: func() string { return mode.Load().(string) }, modeChanged: make(chan struct{}, 1),
	}
	return s, requests
}

func TestScheduledCheckFollowsUpdateMode(t *testing.T) {
	tests := []struct {
		mode             string
		wantState        wailsupdater.State
		wantManifestHits int32
		wantPayloadHits  int32
	}{
		{coresettings.UpdateModeAutomatic, wailsupdater.StateReady, 1, 1},
		{coresettings.UpdateModeCheckOnly, wailsupdater.StateAvailable, 1, 0},
		{coresettings.UpdateModeManual, wailsupdater.StateIdle, 0, 0},
	}
	for _, test := range tests {
		t.Run(test.mode, func(t *testing.T) {
			var mode atomic.Value
			mode.Store(test.mode)
			s, requests := newModeTestService(t, &mode)
			s.runScheduledCheck(context.Background(), s.currentMode())
			status := s.Status()
			if status.State != string(test.wantState) || requests.manifest.Load() != test.wantManifestHits || requests.payload.Load() != test.wantPayloadHits {
				t.Fatalf("status %+v, manifest %d, payload %d", status, requests.manifest.Load(), requests.payload.Load())
			}
			if test.mode != coresettings.UpdateModeManual && (status.LastCheckedAt == "" || status.ReleaseURL != "https://example.test/notes") {
				t.Fatalf("check details missing: %+v", status)
			}
		})
	}
}

func TestManualCheckFollowsUpdateMode(t *testing.T) {
	var mode atomic.Value
	mode.Store(coresettings.UpdateModeCheckOnly)
	s, requests := newModeTestService(t, &mode)
	if err := s.Download(); err == nil || err.Error() != "no update is available; check for updates first" {
		t.Fatalf("Download before check: %v", err)
	}
	if err := s.Check(); err != nil {
		t.Fatal(err)
	}
	if state := s.Status().State; state != string(wailsupdater.StateAvailable) || requests.payload.Load() != 0 {
		t.Fatalf("check only: state %s, payload %d", state, requests.payload.Load())
	}
	if err := s.Download(); err != nil {
		t.Fatal(err)
	}
	if state := s.Status().State; state != string(wailsupdater.StateReady) {
		t.Fatalf("after Download: %s", state)
	}
}

func TestCancelStopsDownload(t *testing.T) {
	var mode atomic.Value
	mode.Store(coresettings.UpdateModeCheckOnly)
	s, requests := newModeTestService(t, &mode)
	if err := s.Check(); err != nil {
		t.Fatal(err)
	}
	requests.blockPayload.Store(true)
	done := make(chan error, 1)
	go func() { done <- s.Download() }()
	select {
	case <-requests.payloadStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("payload request did not start")
	}
	if err := s.Cancel(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Download did not return after Cancel")
	}
	status := s.Status()
	if !status.Canceled || status.Error != "" || status.State == string(wailsupdater.StateReady) {
		t.Fatalf("after cancel: %+v", status)
	}
	if err := s.Cancel(); err == nil || err.Error() != "no update check or download is running" {
		t.Fatalf("second Cancel: %v", err)
	}
}

func TestModeChangeStartsCheck(t *testing.T) {
	var mode atomic.Value
	mode.Store(coresettings.UpdateModeManual)
	s, requests := newModeTestService(t, &mode)
	if err := s.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.ServiceShutdown() })
	time.Sleep(200 * time.Millisecond)
	if got := requests.manifest.Load(); got != 0 {
		t.Fatalf("manual mode made %d manifest requests", got)
	}
	mode.Store(coresettings.UpdateModeAutomatic)
	s.settingsChanged()
	deadline := time.Now().Add(5 * time.Second)
	for requests.payload.Load() != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("mode change made %d payload requests", requests.payload.Load())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRestartRequiresConfirmationForActiveWork(t *testing.T) {
	s := &UpdateService{
		updater: wailsupdater.New(updateTestHost{}),
		listActiveWork: func() []ActiveWork {
			return []ActiveWork{{Kind: "terminal", Description: "Terminal: bash"}}
		},
	}
	if err := s.Restart(false); err != errActiveWorkBlocksRestart {
		t.Fatalf("Restart(false): %v", err)
	}
	if got := (&UpdateService{}).ActiveWork(); got == nil || len(got) != 0 {
		t.Fatalf("ActiveWork without lister: %#v", got)
	}
}

func TestUpdateTargetProblem(t *testing.T) {
	var mu sync.Mutex
	var probed []string
	writableExcept := func(denied string) func(string) bool {
		return func(dir string) bool {
			mu.Lock()
			probed = append(probed, dir)
			mu.Unlock()
			return dir != denied
		}
	}
	tests := []struct {
		name, path, goos, denied, want string
	}{
		{"darwin translocated", "/private/var/folders/x/AppTranslocation/ABC/d/Omniview.app/Contents/MacOS/Omniview", "darwin", "", "Move Omniview to your Applications folder and open it again to receive updates."},
		{"darwin disk image", "/Volumes/Omniview/Omniview.app/Contents/MacOS/Omniview", "darwin", "", "Omniview is running from a disk image. Copy it to your Applications folder and open it from there to receive updates."},
		{"darwin unwritable", "/Applications/Omniview.app/Contents/MacOS/Omniview", "darwin", "/Applications", "Omniview cannot replace itself in /Applications. Move it to a folder you can write to, or update it with the tool that installed it."},
		{"linux unwritable", "/opt/omniview/Omniview", "linux", "/opt/omniview", "Omniview cannot replace itself in /opt/omniview. Move it to a folder you can write to, or update it with the tool that installed it."},
		{"linux writable", "/home/user/bin/Omniview", "linux", "", ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := updateTargetProblem(test.path, test.goos, writableExcept(test.denied)); got != test.want {
				t.Fatalf("updateTargetProblem = %q, want %q", got, test.want)
			}
		})
	}
	if dir := t.TempDir(); !directoryIsWritable(dir) {
		t.Fatalf("temporary directory %s is not writable", dir)
	}
}

func TestFreshProfileDefaultsUpdateModeToAutomatic(t *testing.T) {
	service, err := settingsservice.Initialize(settingsservice.Options{Categories: coresettings.Definitions(false)})
	if err != nil {
		t.Fatal(err)
	}
	hostScope := settingsservice.Scope{Kind: "host"}
	snapshot, err := service.GetSnapshot(hostScope)
	if err != nil {
		t.Fatal(err)
	}
	if got := snapshot.Categories["general"].Settings["update_mode"].Value; got != coresettings.UpdateModeAutomatic {
		t.Fatalf("update_mode default = %#v", got)
	}
	for value, wantValid := range map[string]bool{"bogus": false, coresettings.UpdateModeCheckOnly: true} {
		result, err := service.Validate(hostScope, "general.update_mode", value)
		if err != nil {
			t.Fatal(err)
		}
		if result.Valid != wantValid {
			t.Fatalf("Validate(%q) = %+v", value, result)
		}
	}
}

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
	t.Setenv("USERPROFILE", home)
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
	t.Setenv("USERPROFILE", home)
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
	t.Setenv("USERPROFILE", home)
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
	t.Setenv("USERPROFILE", home)
	root := filepath.Join(home, ".omniview")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	version := "0.0.0-nightly.20261112.1.1"
	_, provider, requests := newSignedFeedFixture(t, version, "stable", root)
	u := newTestUpdater(t, provider, "1.0.0")
	s := &UpdateService{updater: u, provider: provider, configured: true, channel: "stable", root: root}
	list := s.ListChannels()
	if len(list.Options) != 3 || list.Options[2].Channel != "feature-abc" || list.Options[2].DesktopVersion == "" {
		t.Fatalf("ListChannels: %+v", list)
	}
	if err := s.SwitchChannel("feature-missing", false); err == nil || !strings.Contains(err.Error(), "has no active desktop release") {
		t.Fatalf("missing feature: %v", err)
	}
	createTarget := func() {
		if err := os.Mkdir(filepath.Join(home, ".omniview-nightly"), 0700); err != nil {
			t.Error(err)
		}
	}
	requests.onManifest.Store(&createTarget)
	if err := s.SwitchChannel("nightly", true); err == nil {
		t.Fatal("switch accepted concurrently created target")
	}
	if s.Status().State == string(wailsupdater.StateReady) {
		t.Fatal("seed failure left update staged")
	}
	requests.onManifest.Store(nil)
	if err := os.Remove(filepath.Join(home, ".omniview-nightly")); err != nil {
		t.Fatal(err)
	}
	requests.failDownload.Store(true)
	if err := s.SwitchChannel("nightly", true); err == nil {
		t.Fatal("failed download succeeded")
	}
	if _, err := os.Lstat(filepath.Join(home, ".omniview-nightly")); !os.IsNotExist(err) {
		t.Fatalf("failed download left seed target: %v", err)
	}
	requests.failDownload.Store(false)
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
