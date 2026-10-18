package devbaseline

import (
	"bytes"
	"context"
	"encoding/gob"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	categories "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
)

const testID = "9d799eef-e491-493f-942a-54ac906ca34e"

func fixture(t *testing.T) (string, string, instance.Profile) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	source := filepath.Join(home, "source")
	require.NoError(t, os.Mkdir(source, 0700))
	workspace := filepath.Join(home, "feature")
	require.NoError(t, os.Mkdir(workspace, 0700))
	manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: testID, Slug: "fixture", DisplayName: "Fixture", Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}, Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview", BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "feature/fixture"}}}
	data, err := json.Marshal(manifest)
	require.NoError(t, err)
	path := filepath.Join(workspace, "workspace.json")
	require.NoError(t, os.WriteFile(path, data, 0600))
	profile, err := instance.Resolve(instance.Options{Home: home, Workspace: path, Channel: "local"})
	require.NoError(t, err)
	return home, source, profile
}

func sourceSettings(t *testing.T, source string) []byte {
	t.Helper()
	s, err := settingsstore.Open(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, s.SaveCategory("general", map[string]any{"language": "es", "credential": "secret", "autoconnect": true, "futureKey": "private"}))
	require.NoError(t, s.SaveCategory("appearance", map[string]any{"theme": "void", "token": "secret"}))
	require.NoError(t, s.SaveCategory("terminal", map[string]any{"fontSize": 14, "defaultShell": "/private/source-shell", "session": "secret"}))
	require.NoError(t, s.SaveCategory("telemetry", map[string]any{"enabled": true, "authValue": "secret", "endpoint": "private"}))
	require.NoError(t, s.SaveCategory("connections", map[string]any{"autoconnect": true}))
	require.NoError(t, s.SavePluginSettings("example", map[string]any{"token": "secret"}))
	require.NoError(t, s.Close())
	b, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	return b
}

// Removing the explicit key filter would leak credentials/future schema additions.
func TestSeedCopiesOnlySafePreferencesAndInactiveInventory(t *testing.T) {
	home, source, p := fixture(t)
	before := sourceSettings(t, source)
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin_state.json"), []byte(`[{"id":"example","metadata":{"id":"example","version":"1.2.3","stateIsolation":{"version":1}},"enabled":true,"devMode":true,"devPath":"/private/source","lastError":"secret"}]`), 0600))
	for _, name := range []string{"plugin_pids.json", "devserver_pids.json", ".devinfo.json", "control.token", "connections.json", "settings.gob", "logs"} {
		require.NoError(t, os.WriteFile(filepath.Join(source, name), []byte("secret PID 1234"), 0600))
	}
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, SourceVersion: "1.2.3", TemporaryRoot: home})
	require.NoError(t, err)
	encoded, err := json.Marshal(b.Preferences)
	require.NoError(t, err)
	for _, excluded := range []string{"secret", "private", "credential", "autoconnect", "futureKey", "defaultShell", "stateIsolation", "devPath", "1234"} {
		require.NotContains(t, string(encoded), excluded)
	}
	manifest, err := json.Marshal(b)
	require.NoError(t, err)
	require.NotContains(t, string(manifest), "/private/source")
	require.NotContains(t, string(manifest), "secret")
	require.Equal(t, "created-for-offline-lock", b.Source.LockMarker)
	result, err := Import(context.Background(), b, ImportOptions{Destination: p, Home: home})
	require.NoError(t, err)
	require.Equal(t, p.Descriptor.StateRoot, result.StateRoot)
	entries, err := os.ReadDir(result.StateRoot)
	require.NoError(t, err)
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
		info, err := e.Info()
		require.NoError(t, err)
		if runtime.GOOS != "windows" {
			require.Equal(t, os.FileMode(0600), info.Mode().Perm())
		}
	}
	require.ElementsMatch(t, []string{"settings.db", "baseline.json"}, names)
	info, err := os.Stat(result.StateRoot)
	require.NoError(t, err)
	if runtime.GOOS != "windows" {
		require.Equal(t, os.FileMode(0700), info.Mode().Perm())
	}
	s, err := settingsstore.Open(filepath.Join(result.StateRoot, "settings.db"))
	require.NoError(t, err)
	values, err := s.LoadCategory("general")
	require.NoError(t, err)
	require.Equal(t, map[string]any{"language": "es"}, values)
	plugins, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	require.Empty(t, plugins)
	require.NoError(t, s.SaveCategory("general", map[string]any{"language": "en"}))
	require.NoError(t, s.Close())
	after, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	require.Len(t, result.Plugins, 1)
	require.Equal(t, "inactive", result.Plugins[0].Status)
	require.Equal(t, "unverified-source-inventory", result.Plugins[0].Provenance)
}

func TestBusySourceAndCorruptionNeverMutateSource(t *testing.T) {
	home, source, _ := fixture(t)
	before := sourceSettings(t, source)
	lock := flock.New(filepath.Join(source, ".lock"))
	require.NoError(t, lock.Lock())
	_, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.ErrorIs(t, err, ErrSourceBusy)
	require.NoError(t, lock.Close())
	after, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	corrupt := bytes.Repeat([]byte("corrupt database"), 1024)
	require.NoError(t, os.WriteFile(filepath.Join(source, "settings.db"), corrupt, 0600))
	_, err = Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.Error(t, err)
	after, err = os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, corrupt, after)
	matches, err := filepath.Glob(filepath.Join(source, "settings.db.corrupt.*"))
	require.NoError(t, err)
	require.Empty(t, matches)
}

func TestSourceSymlinksAndHardlinksRejected(t *testing.T) {
	for _, kind := range []string{"root", "database", "inventory", "lock", "hardlink"} {
		t.Run(kind, func(t *testing.T) {
			home, source, _ := fixture(t)
			sourceSettings(t, source)
			switch kind {
			case "root":
				alias := filepath.Join(home, "alias")
				require.NoError(t, os.Symlink(source, alias))
				source = alias
			case "hardlink":
				require.NoError(t, os.Link(filepath.Join(source, "settings.db"), filepath.Join(home, "database-alias")))
			default:
				name := map[string]string{"database": "settings.db", "inventory": "plugin_state.json", "lock": ".lock"}[kind]
				target := filepath.Join(home, "outside")
				require.NoError(t, os.WriteFile(target, []byte("outside"), 0600))
				require.NoError(t, os.RemoveAll(filepath.Join(source, name)))
				require.NoError(t, os.Symlink(target, filepath.Join(source, name)))
			}
			_, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
			require.Error(t, err)
		})
	}
}

func TestDestinationGuardsAndNoOverwrite(t *testing.T) {
	for _, kind := range []string{"production", "arbitrary", "existing", "symlink", "source", "nested"} {
		t.Run(kind, func(t *testing.T) {
			home, source, p := fixture(t)
			sourceSettings(t, source)
			switch kind {
			case "production":
				p.Descriptor.Kind = "production"
				p.Descriptor.StateRoot = filepath.Join(home, ".omniview")
			case "arbitrary":
				p.Descriptor.StateRoot = filepath.Join(home, "elsewhere")
			case "existing":
				require.NoError(t, os.MkdirAll(p.Descriptor.StateRoot, 0700))
			case "symlink":
				require.NoError(t, os.MkdirAll(filepath.Dir(p.Descriptor.StateRoot), 0700))
				require.NoError(t, os.Symlink(source, p.Descriptor.StateRoot))
			case "source":
				source = p.Descriptor.StateRoot
				require.NoError(t, os.MkdirAll(source, 0700))
			case "nested":
				source = filepath.Dir(p.Descriptor.StateRoot)
			}
			_, err := Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: p, Home: home})
			require.Error(t, err)
		})
	}
}

func TestImportRefiltersUntrustedSnapshot(t *testing.T) {
	home, source, p := fixture(t)
	sourceSettings(t, source)
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.NoError(t, err)
	b.Preferences["general"]["token"] = "secret"
	b.Preferences["telemetry"] = map[string]any{"enabled": true}
	b.Plugins = []Plugin{{ID: "example", Version: "1.0.0", Status: "active", Provenance: "verified"}}
	_, err = Import(context.Background(), b, ImportOptions{Destination: p, Home: home})
	require.NoError(t, err)
	data, err := os.ReadFile(filepath.Join(p.Descriptor.StateRoot, "baseline.json"))
	require.NoError(t, err)
	require.NotContains(t, string(data), "secret")
	require.NotContains(t, string(data), `"active"`)
	require.NotContains(t, string(data), `"verified"`)
}

func TestLegacyMigrationUsesPrivateCopy(t *testing.T) {
	home, source, p := fixture(t)
	original := settings.Store{"general": settings.Category{Settings: map[string]settings.Setting{"language": {Value: "es"}, "password": {Value: "secret"}}}}
	var buf bytes.Buffer
	require.NoError(t, gob.NewEncoder(&buf).Encode(original))
	before := append([]byte(nil), buf.Bytes()...)
	require.NoError(t, os.WriteFile(filepath.Join(source, "settings"), before, 0600))
	result, err := Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: p, Home: home})
	require.NoError(t, err)
	after, err := os.ReadFile(filepath.Join(source, "settings"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	_, err = os.Stat(filepath.Join(source, "settings.gob.bak"))
	require.True(t, os.IsNotExist(err))
	s, err := settingsstore.Open(filepath.Join(result.StateRoot, "settings.db"))
	require.NoError(t, err)
	defer s.Close()
	values, err := s.LoadCategory("general")
	require.NoError(t, err)
	require.Equal(t, map[string]any{"language": "es"}, values)
	entries, err := filepath.Glob(filepath.Join(home, ".baseline-legacy-*"))
	require.NoError(t, err)
	require.Empty(t, entries)
}

func TestCancelledAndFailedImportLeaveNoDestinationOrStage(t *testing.T) {
	home, source, p := fixture(t)
	sourceSettings(t, source)
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = Import(ctx, b, ImportOptions{Destination: p, Home: home})
	require.ErrorIs(t, err, context.Canceled)
	// Malformed allowlisted values must never be published.
	b.Preferences["general"]["language"] = func() {}
	_, err = Import(context.Background(), b, ImportOptions{Destination: p, Home: home})
	require.Error(t, err)
	// A manifest encoding error occurs after the private staged DB was written.
	b.Preferences["general"]["language"] = "es"
	b.CreatedAt = time.Date(10000, time.January, 1, 0, 0, 0, 0, time.UTC)
	_, err = Import(context.Background(), b, ImportOptions{Destination: p, Home: home})
	require.Error(t, err)
	_, err = os.Lstat(p.Descriptor.StateRoot)
	require.True(t, errors.Is(err, os.ErrNotExist))
	stages, err := filepath.Glob(filepath.Join(filepath.Dir(p.Descriptor.StateRoot), ".baseline-stage-*"))
	require.NoError(t, err)
	require.Empty(t, stages)
}

type cancelAfterStaging struct {
	context.Context
	parent   string
	observed bool
	cancel   context.CancelFunc
	onStage  func()
}

func (c *cancelAfterStaging) Err() error {
	stages, _ := filepath.Glob(filepath.Join(c.parent, ".baseline-stage-*"))
	if len(stages) > 0 {
		c.observed = true
		if c.onStage != nil {
			c.onStage()
		}
		c.cancel()
	}
	return c.Context.Err()
}

func TestCancellationAfterStagingKeepsDestinationAbsent(t *testing.T) {
	home, source, p := fixture(t)
	sourceSettings(t, source)
	before, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.NoError(t, err)
	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &cancelAfterStaging{Context: base, cancel: cancel, parent: filepath.Dir(p.Descriptor.StateRoot)}
	_, err = Import(ctx, b, ImportOptions{Destination: p, Home: home})
	require.ErrorIs(t, err, context.Canceled)
	require.True(t, ctx.observed)
	_, err = os.Lstat(p.Descriptor.StateRoot)
	require.True(t, os.IsNotExist(err))
	stages, err := filepath.Glob(filepath.Join(ctx.parent, ".baseline-stage-*"))
	require.NoError(t, err)
	require.Empty(t, stages)
	after, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, before, after)
}

func TestAtomicFinalizeNeverReplacesCompetingDestination(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	stage := filepath.Join(parent, "stage")
	destination := filepath.Join(parent, "state")
	require.NoError(t, os.Mkdir(stage, 0700))
	require.NoError(t, os.Mkdir(destination, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(stage, "settings.db"), []byte("staged"), 0600))
	require.Error(t, finalize(stage, destination))
	entries, err := os.ReadDir(destination)
	require.NoError(t, err)
	require.Empty(t, entries)
	data, err := os.ReadFile(filepath.Join(stage, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, "staged", string(data))
}

func TestSerializedSnapshotRejectsSourceAncestorDestination(t *testing.T) {
	home, _, p := fixture(t)
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: home, TemporaryRoot: home})
	require.NoError(t, err)
	data, err := json.Marshal(b)
	require.NoError(t, err)
	var restored Baseline
	require.NoError(t, json.Unmarshal(data, &restored))
	_, err = Import(context.Background(), &restored, ImportOptions{Destination: p, Home: home})
	require.Error(t, err)
	_, err = os.Lstat(p.Descriptor.StateRoot)
	require.True(t, os.IsNotExist(err))
}

func TestHostSensitiveClassificationOverridesAllowlist(t *testing.T) {
	home, source, _ := fixture(t)
	sourceSettings(t, source)
	original := categories.General.Settings["language"]
	sensitive := original
	sensitive.Sensitive = true
	categories.General.Settings["language"] = sensitive
	t.Cleanup(func() { categories.General.Settings["language"] = original })
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.NoError(t, err)
	require.NotContains(t, b.Preferences["general"], "language")
}

func TestMalformedLegacyFailsWithoutChangingSource(t *testing.T) {
	home, source, _ := fixture(t)
	before := []byte("not a valid GOB settings store")
	require.NoError(t, os.WriteFile(filepath.Join(source, "settings"), before, 0600))
	_, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.Error(t, err)
	after, err := os.ReadFile(filepath.Join(source, "settings"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	_, err = os.Stat(filepath.Join(source, "settings.db"))
	require.True(t, os.IsNotExist(err))
	stages, err := filepath.Glob(filepath.Join(home, ".baseline-legacy-*"))
	require.NoError(t, err)
	require.Empty(t, stages)
}

func TestStableProfileGuardRejectsCompetingSeedAndImportWithoutCreatingState(t *testing.T) {
	for _, operation := range []string{"seed", "import"} {
		t.Run(operation, func(t *testing.T) {
			home, source, p := fixture(t)
			sourceSettings(t, source)
			var b *Baseline
			if operation == "import" {
				var err error
				b, err = Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
				require.NoError(t, err)
			}
			release, err := devcontract.LockProfile(context.Background(), home, p.Descriptor.WorkspaceID)
			require.NoError(t, err)
			defer func() { require.NoError(t, release()) }()
			if operation == "seed" {
				_, err = Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: p, Home: home})
			} else {
				_, err = Import(context.Background(), b, ImportOptions{Destination: p, Home: home})
			}
			require.Error(t, err)
			_, statErr := os.Lstat(p.Descriptor.StateRoot)
			require.True(t, os.IsNotExist(statErr))
			stages, globErr := filepath.Glob(filepath.Join(filepath.Dir(p.Descriptor.StateRoot), ".baseline-stage-*"))
			require.NoError(t, globErr)
			require.Empty(t, stages)
			if operation == "seed" {
				_, statErr = os.Lstat(filepath.Join(source, ".lock"))
				require.True(t, os.IsNotExist(statErr))
			}
		})
	}
}

func TestStableProfileGuardHeldDuringAbsentRootStaging(t *testing.T) {
	home, source, p := fixture(t)
	sourceSettings(t, source)
	b, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.NoError(t, err)
	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	probed := false
	ctx := &cancelAfterStaging{Context: base, cancel: cancel, parent: filepath.Dir(p.Descriptor.StateRoot), onStage: func() {
		probed = true
		_, statErr := os.Lstat(p.Descriptor.StateRoot)
		require.True(t, os.IsNotExist(statErr))
		// Startup takes the same primitive before it can create state/.lock.
		release, lockErr := devcontract.LockProfile(context.Background(), home, p.Descriptor.WorkspaceID)
		if lockErr == nil {
			_ = release()
		}
		require.Error(t, lockErr)
	}}
	_, err = Import(ctx, b, ImportOptions{Destination: p, Home: home})
	require.ErrorIs(t, err, context.Canceled)
	require.True(t, probed)
	release, err := devcontract.LockProfile(context.Background(), home, p.Descriptor.WorkspaceID)
	require.NoError(t, err)
	require.NoError(t, release())
	_, err = os.Lstat(p.Descriptor.StateRoot)
	require.True(t, os.IsNotExist(err))
}
