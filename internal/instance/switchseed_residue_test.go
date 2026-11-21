package instance

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	bolt "go.etcd.io/bbolt"

	"github.com/omniviewdev/omniview/internal/settings/store"
)

// sentinel stands for a credential that was erased in the source profile before
// the switch. It must never reach the new profile, in any file, as raw bytes.
const sentinel = "SEC3-SENTINEL-erased-credential-7f3a9c1d"

// plantDatabase writes a settings database the way a host without the settings
// scrub (the stable channel's older build) leaves it: a credential that spans
// pages is written, committed, then deleted. bbolt frees the pages without
// wiping them, so the bytes stay in the file. A live value is written beside it.
func plantDatabase(t *testing.T, path string) {
	t.Helper()
	db, err := bolt.Open(path, 0o600, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte(strings.Repeat(sentinel+"|", 600))
	if err := db.Update(func(tx *bolt.Tx) error {
		plugins, err := tx.CreateBucketIfNotExists([]byte("plugins"))
		if err != nil {
			return err
		}
		if err := plugins.Put([]byte("gone"), secret); err != nil {
			return err
		}
		return plugins.Put([]byte("p1"), []byte(`{"live":"keep-me"}`))
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte("plugins")).Delete([]byte("gone"))
	}); err != nil {
		t.Fatal(err)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func holdsSentinel(t *testing.T, path string) bool {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.Contains(data, []byte(sentinel))
}

// files lists the relative path of every non-directory under root.
func files(t *testing.T, root string) []string {
	t.Helper()
	var names []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		names = append(names, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(names)
	return names
}

const credentialFile = "plugins/p1/store/connection-credentials-4f0c6d52-9a1e-4d57-8a43-0b3f6d3f2a10"

// residueFiles are files a profile holds that it never needs and that can hold a
// secret that was erased elsewhere: every one carries the sentinel.
var residueFiles = []string{
	"settings.db.corrupt.1700000000",
	"settings.db.corrupt.1700000001",
	"settings.db.scrub-old",
	"settings.db.scrub-new",
	"settings.gob.bak",
	"settings.gob.bak.3",
	"settings",
	"plugin",
	"plugin_state.json.invalid.1700000000",
	"plugin_state.json.tmp",
	"activities.json.invalid.1700000002",
	".archive-recovery-p1.json",
	".uninstall-recovery-p1.json",
	"plugin_pids.json",
	"devserver_pids.json",
	"plugin-channel-sync.json",
	"windows.json",
	"windows.json.bak",
	"logs/ui.log",
	"logs/app.log",
	"logs/plugin.p1.log",
	"diagnostics/captures/capture-1.json",
	"runtime/diagnostics/token-1.secret",
	"plugins/.uninstall-p1-abc/plugin/store/connection-credentials-old",
	"plugins/p1.invalid.77/plugin.yaml",
	"plugins/p1/settings",
	"plugins/p1/settings.gob.bak",
	"plugins/p1/logs/plugin.log",
	"plugins/p1/data/.data-write.tmp",
	"plugins/p1/store/resource-authorities-v1.2c0e.tmp",
	"plugins/p1/store/connection-profiles-v1.invalid.1700000003",
	"builtin/grafana/connections.tmp",
	"builtin/grafana/connections.json.invalid.1700000004",
	"builtin/other/connections.json",
}

// neededFiles are what the new profile is given.
var neededFiles = map[string]string{
	"plugin_state.json":                       `[{"id":"p1"}]`,
	"activities.json":                         `{"version":1,"records":[]}`,
	"plugins/p1/plugin.yaml":                  "id: p1\n",
	"plugins/p1/bin/plugin":                   "binary",
	"plugins/p1/assets/a.js":                  "export {}",
	"plugins/p1/data/recent.json":             `["kind-kind"]`,
	"plugins/p1/store/connection-profiles-v1": `{"profiles":[]}`,
	credentialFile:                            "live-credential",
	"builtin/grafana/connections.json":        `{"connections":[]}`,
}

// seedSource builds a source profile that holds everything above.
func seedSource(t *testing.T) string {
	t.Helper()
	source := t.TempDir()
	plantDatabase(t, filepath.Join(source, "settings.db"))
	for _, name := range residueFiles {
		writeFile(t, filepath.Join(source, filepath.FromSlash(name)), "erased: "+sentinel)
	}
	for name, content := range neededFiles {
		writeFile(t, filepath.Join(source, filepath.FromSlash(name)), content)
	}
	return source
}

func apply(t *testing.T, source string) string {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	target := filepath.Join(t.TempDir(), "target")
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
	return target
}

// The planted source must really hold the erased credential everywhere the test
// says it does: a detector that cannot see the bytes proves nothing.
func TestSeedSourceHoldsTheSentinel(t *testing.T) {
	source := seedSource(t)
	if !holdsSentinel(t, filepath.Join(source, "settings.db")) {
		t.Fatal("the planted database does not hold the erased value in a freed page")
	}
	for _, name := range residueFiles {
		if !holdsSentinel(t, filepath.Join(source, filepath.FromSlash(name))) {
			t.Fatalf("%s does not hold the sentinel", name)
		}
	}
}

func TestSwitchSeedCarriesNoResidue(t *testing.T) {
	source := seedSource(t)
	target := apply(t, source)

	for _, name := range files(t, target) {
		if holdsSentinel(t, filepath.Join(target, filepath.FromSlash(name))) {
			t.Errorf("%s in the new profile holds the credential that was erased in the old one", name)
		}
	}
	for _, name := range residueFiles {
		if _, err := os.Lstat(filepath.Join(target, filepath.FromSlash(name))); !os.IsNotExist(err) {
			t.Errorf("%s was carried to the new profile: %v", name, err)
		}
	}
}

// The new profile holds exactly what an allow-list names: nothing else rides along.
func TestSwitchSeedCarriesExactlyWhatAProfileNeeds(t *testing.T) {
	source := seedSource(t)
	target := apply(t, source)

	want := []string{"settings.db"}
	for name := range neededFiles {
		want = append(want, name)
	}
	sort.Strings(want)
	got := files(t, target)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("the new profile holds\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	for name, content := range neededFiles {
		data, err := os.ReadFile(filepath.Join(target, filepath.FromSlash(name)))
		if err != nil || string(data) != content {
			t.Errorf("%s: %q: %v", name, data, err)
		}
	}
}

func TestSwitchSeedCarriesTheLiveSettingsAndNotTheErasedOnes(t *testing.T) {
	source := seedSource(t)
	target := apply(t, source)

	settings, err := store.Open(filepath.Join(target, "settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer settings.Close()
	live, err := settings.LoadPluginSettings("p1")
	if err != nil || live["live"] != "keep-me" {
		t.Fatalf("live settings %v: %v", live, err)
	}
	gone, err := settings.LoadPluginSettings("gone")
	if err != nil || len(gone) != 0 {
		t.Fatalf("erased settings came back: %v: %v", gone, err)
	}
	for _, name := range files(t, target) {
		if strings.HasPrefix(name, "settings.db.") {
			t.Errorf("the store left %s beside the database", name)
		}
	}
}

// The switch only reads the old profile: its own database keeps its own pages.
func TestSwitchSeedLeavesTheSourceAsItWas(t *testing.T) {
	source := seedSource(t)
	before := map[string][]byte{}
	for _, name := range files(t, source) {
		data, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		before[name] = data
	}
	apply(t, source)
	after := files(t, source)
	// The switch takes the source's lock file, which it creates when it is missing.
	after = slices.DeleteFunc(after, func(name string) bool { return name == ".lock" })
	if len(after) != len(before) {
		t.Fatalf("the source holds %d files, held %d", len(after), len(before))
	}
	for _, name := range after {
		data, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if err != nil || !bytes.Equal(data, before[name]) {
			t.Errorf("the source's %s changed: %v", name, err)
		}
	}
}

// A database that cannot be read is not carried: the new profile starts with
// default settings, as the store's own recovery would give it, and keeps no copy.
func TestSwitchSeedDoesNotCarryAnUnreadableDatabase(t *testing.T) {
	source := t.TempDir()
	writeFile(t, filepath.Join(source, "settings.db"), strings.Repeat("not a database "+sentinel, 400))
	writeFile(t, filepath.Join(source, "plugin_state.json"), "[]")
	target := apply(t, source)

	got := files(t, target)
	if strings.Join(got, "\n") != "plugin_state.json" {
		t.Fatalf("the new profile holds %v", got)
	}
}

func TestSwitchSeedWithoutADatabaseStillSeeds(t *testing.T) {
	source := t.TempDir()
	writeFile(t, filepath.Join(source, "plugin_state.json"), "[]")
	target := apply(t, source)
	if got := files(t, target); strings.Join(got, "\n") != "plugin_state.json" {
		t.Fatalf("the new profile holds %v", got)
	}
}
