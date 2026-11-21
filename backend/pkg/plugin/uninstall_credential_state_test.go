package plugin

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// A plugin's Password and Sensitive setting values live in the host settings
// store, outside the plugin directory. Uninstalling the plugin removes the
// directory; these tests pin what happens to the rest of the plugin's state:
// the credential-class values are erased once the uninstall is durable, nothing
// is erased for an uninstall that rolls back, and a plugin installed again
// under the same ID starts without them.

const (
	credentialToken  = "s3cret-token-value"
	credentialSecret = "s3cret-client-value"
)

// credentialSettingsProvider is the settings capability of the fixture plugin:
// a Password setting, a Sensitive text setting and an ordinary preference.
type credentialSettingsProvider struct {
	// onList runs each time the host asks the plugin for its schema, which it
	// does while the plugin starts.
	onList func()
}

func credentialSchema() map[string]pkgsettings.Setting {
	return map[string]pkgsettings.Setting{
		"apiToken":     {ID: "apiToken", Type: pkgsettings.Password, Default: ""},
		"clientSecret": {ID: "clientSecret", Type: pkgsettings.Text, Sensitive: true, Default: ""},
		"theme":        {ID: "theme", Type: pkgsettings.Text, Default: "light"},
	}
}

func (p credentialSettingsProvider) ListSettings() map[string]pkgsettings.Setting {
	if p.onList != nil {
		p.onList()
	}
	return credentialSchema()
}

func (credentialSettingsProvider) GetSetting(id string) (pkgsettings.Setting, error) {
	setting, ok := credentialSchema()[id]
	if !ok {
		return pkgsettings.Setting{}, errors.New("unknown setting")
	}
	return setting, nil
}

func (p credentialSettingsProvider) GetSettingValue(id string) (any, error) {
	setting, err := p.GetSetting(id)
	return setting.Value, err
}

func (credentialSettingsProvider) ValidateSetting(string, any) (pkgsettings.ValidationResult, error) {
	return pkgsettings.ValidationResult{}, nil
}

func (credentialSettingsProvider) CommitSettings(
	_ context.Context, values map[string]any, persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	if persist != nil {
		if err := persist(values); err != nil {
			return pkgsettings.CommitResult{}, err
		}
	}
	return pkgsettings.CommitResult{Committed: true, Applied: true}, nil
}

// credentialFixture is a manager wired to a real appstate service and a real
// settings store and controller, with a plugin whose backend serves
// credentialSettingsProvider, the way the application wires them: the manager
// releases the plugin's cached state roots through the service.
type credentialFixture struct {
	pm       *pluginManager
	svc      *appstate.Service
	store    *settingsstore.Store
	settings settings.Controller
	dbPath   string
	// onList runs when the fixture plugin is asked for its schema, that is,
	// while it starts.
	onList func()
}

func newCredentialFixture(t *testing.T) *credentialFixture {
	t.Helper()
	return newCredentialFixtureOver(t, appstate.NewTestService(t), filepath.Join(t.TempDir(), "settings.db"))
}

// newCredentialFixtureOver starts a manager over an existing state service and
// the settings database at dbPath, which it opens: what a host start does.
func newCredentialFixtureOver(t *testing.T, svc *appstate.Service, dbPath string) *credentialFixture {
	t.Helper()
	store, err := settingsstore.Open(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })

	f := &credentialFixture{svc: svc, store: store, settings: nil, dbPath: dbPath, onList: nil}
	pm := &pluginManager{
		logger:              testLogger(t),
		stateRoot:           svc.RootDir(),
		pluginsRoot:         svc.Plugins(),
		records:             make(map[string]*plugintypes.PluginRecord),
		connlessControllers: make(map[sdktypes.Capability]plugintypes.Controller),
		connfullControllers: make(map[sdktypes.Capability]plugintypes.LifecycleController),
		managers:            make(map[string]plugintypes.PluginManager),
		pidTracker:          NewPIDTracker(svc.RootDir()),
		pluginOpsLocks:      make(map[string]*sync.Mutex),
		emitter:             testNoopEmitter{},
	}
	pm.SetPluginStateReleaser(svc.ReleasePluginRoots)
	f.settings = settings.NewController(pm.logger, store)
	pm.connlessControllers[sdktypes.CapabilitySettings] = f.settings
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
			Providers: map[string]any{"settings": credentialSettingsProvider{onList: func() {
				if f.onList != nil {
					f.onList()
				}
			}}},
		}), nil
	}
	f.pm = pm
	return f
}

// restart simulates a host restart over the same state: the old store is
// closed, the state service and the settings database are opened again, a new
// manager starts over them, and Initialize runs, which finishes a pending
// uninstall by itself. customize runs before Initialize. Whatever the old manager
// held in memory is gone.
func (f *credentialFixture) restart(t *testing.T, customize ...func(*credentialFixture)) *credentialFixture {
	t.Helper()
	require.NoError(t, f.store.Close())
	svc, err := appstate.New(appstate.WithRoot(f.svc.Root()), appstate.WithFlock(false))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, svc.Close()) })
	next := newCredentialFixtureOver(t, svc, f.dbPath)
	for _, apply := range customize {
		apply(next)
	}
	require.NoError(t, next.pm.Initialize(context.Background()))
	return next
}

// credentialArchive packages the fixture plugin for the archive install path.
func credentialArchive(t *testing.T) string {
	t.Helper()
	return credentialArchiveVersion(t, "1.0.0")
}

func credentialArchiveVersion(t *testing.T, version string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fixture archive carries a Unix shell script as bin/plugin; a Windows host requires bin/plugin.exe")
	}
	return writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0o644, body: "id: flux\nversion: " + version + "\ncapabilities: [settings]\n"},
		{name: "bin/", mode: 0o755, dir: true},
		{name: "bin/plugin", mode: 0o755, body: "#!/bin/sh\n"},
	})
}

// install runs the real archive install; the plugin starts and the settings
// controller learns the plugin's schema from its provider.
func (f *credentialFixture) install(t *testing.T) {
	t.Helper()
	_, err := f.pm.InstallPluginFromPath(credentialArchive(t))
	require.NoError(t, err)
}

// save stores values the way the settings service does when a user edits them.
func (f *credentialFixture) save(t *testing.T, values map[string]any) {
	t.Helper()
	require.NoError(t, f.store.PatchPluginSettings("flux", values))
}

func (f *credentialFixture) persisted(t *testing.T) map[string]any {
	t.Helper()
	values, err := f.store.LoadPluginSettings("flux")
	require.NoError(t, err)
	return values
}

// installUIOnly installs and loads a plugin that has no settings capability,
// so the settings controller never learns a schema for it.
func installLoadedUIPlugin(t *testing.T, pm *pluginManager) {
	t.Helper()
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0o755))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
}

// uninstallObserverStub stands in for a controller that keeps state outside the
// plugin directory.
type uninstallObserverStub struct {
	*trackingController
	callsMu     sync.Mutex
	calls       []string
	err         error
	shutdownErr error
	onCall      func()
}

func (s *uninstallObserverStub) OnPluginShutdown(string, config.PluginMeta) error {
	return s.shutdownErr
}

func (s *uninstallObserverStub) OnPluginUninstalled(pluginID string) error {
	if s.onCall != nil {
		s.onCall()
	}
	s.callsMu.Lock()
	defer s.callsMu.Unlock()
	s.calls = append(s.calls, pluginID)
	return s.err
}

func (s *uninstallObserverStub) uninstalled() []string {
	s.callsMu.Lock()
	defer s.callsMu.Unlock()
	return append([]string(nil), s.calls...)
}

func newUninstallObserverStub() *uninstallObserverStub {
	return &uninstallObserverStub{trackingController: &trackingController{}}
}

func TestUninstallErasesSensitiveSettingValues(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	require.Equal(t, credentialToken, f.persisted(t)["apiToken"], "precondition: the secret is stored")

	_, err := f.pm.UninstallPlugin("flux")
	require.NoError(t, err)

	// Precondition: the plugin directory itself is gone, so this is a real uninstall.
	assert.NoDirExists(t, f.pm.pluginsRoot.ResolvePath("flux"))
	// The Password and the Sensitive values are erased; the ordinary preference stays.
	assert.Equal(t, map[string]any{"theme": "dark"}, f.persisted(t))
}

func TestUninstallErasesSettingValuesItCannotClassify(t *testing.T) {
	if runtime.GOOS == "windows" {
		// WINDOWS DEFECT: CI5-W1.
		t.Skip("WINDOWS DEFECT CI5-W1: plugin-sdk LoadPluginMetadata never closes plugin.yaml, so a loaded plugin's directory cannot be renamed")
	}
	f := newCredentialFixture(t)
	installLoadedUIPlugin(t, f.pm)
	// The legacy case: this plugin has no settings capability, so it never
	// reported a schema, neither in this session nor in an earlier one that the
	// host could have remembered. Nothing says which of its stored values are
	// credentials, so all of them are erased, as the settings snapshot and the
	// redaction already treat unknown values as secret.
	require.NoError(t, f.store.SavePluginSettings("flux", map[string]any{"apiToken": credentialToken, "theme": "dark"}))
	require.NoError(t, f.store.SavePluginSettings("other", map[string]any{"theme": "dark"}))

	_, err := f.pm.UninstallPlugin("flux")
	require.NoError(t, err)

	assert.Empty(t, f.persisted(t))
	other, err := f.store.LoadPluginSettings("other")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, other, "another plugin's settings are never touched")
}

func TestUninstallRemovesHostSavedConnectionState(t *testing.T) {
	appstate.SkipIfOpenRootBlocksRename(t)
	f := newCredentialFixture(t)
	f.install(t)
	store, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	data, err := f.svc.PluginData("flux")
	require.NoError(t, err)
	// The names the resource controller gives a plugin's connection state.
	const credentialFile = "connection-credentials-6f1c2a3e-8b4d-4e5f-9a60-7b1c2d3e4f50"
	for _, name := range []string{credentialFile, "connection-profiles-v1", "connections", "resource-authorities-v1"} {
		require.NoError(t, store.WriteFile(name, []byte("saved "+credentialToken), 0o600))
	}
	require.NoError(t, data.WriteFile("preferences.json", []byte(`{"density":"compact"}`), 0o600))
	// A settings migration backup keeps the legacy values inside the plugin directory.
	require.NoError(t, f.pm.pluginsRoot.WriteFile("flux/settings.gob.bak", []byte("legacy "+credentialToken), 0o600))
	pluginDir := f.pm.pluginsRoot.ResolvePath("flux")
	require.FileExists(t, filepath.Join(pluginDir, "store", credentialFile))

	_, err = f.pm.UninstallPlugin("flux")
	require.NoError(t, err)

	assert.NoFileExists(t, filepath.Join(pluginDir, "store", credentialFile), "host-saved connection credentials go with the directory")
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "connection-profiles-v1"), "connection profiles go with the directory")
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "connections"))
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "resource-authorities-v1"))
	assert.NoFileExists(t, filepath.Join(pluginDir, "data", "preferences.json"))
	assert.NoFileExists(t, filepath.Join(pluginDir, "settings.gob.bak"))
	assert.NoDirExists(t, pluginDir)
}

func TestUninstallLeavesCredentialStateAloneWhenRolledBack(t *testing.T) {
	appstate.SkipIfOpenRootBlocksRename(t)
	f := newCredentialFixture(t)
	observer := newUninstallObserverStub()
	f.pm.connlessControllers[sdktypes.CapabilityExec] = observer
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	heldStore, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	// A directory where the inventory's temporary file belongs makes the
	// inventory write fail, so the uninstall rolls back after staging.
	require.NoError(t, f.pm.stateRoot.MkdirAll(stateFileName+".tmp", 0o755))

	_, err = f.pm.UninstallPlugin("flux")
	require.Error(t, err)

	assert.Empty(t, observer.uninstalled(), "a rolled-back uninstall notifies nobody")
	// The plugin is still installed, so its cached state roots stay: a holder of
	// one, such as the authority resolver, must not be left with a closed root.
	again, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	assert.Same(t, heldStore, again, "a rolled-back uninstall releases no root")
	require.NoError(t, heldStore.WriteFile("after-rollback.json", []byte("ok"), 0o600))
	assert.Equal(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"}, f.persisted(t))
	assert.DirExists(t, f.pm.pluginsRoot.ResolvePath("flux"), "the installation is restored")
	_, getErr := f.pm.GetPlugin("flux")
	require.NoError(t, getErr, "the plugin stays in the inventory")

	// The retry succeeds, and only now are the credentials erased, once.
	require.NoError(t, f.pm.stateRoot.Remove(stateFileName+".tmp"))
	_, err = f.pm.UninstallPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, []string{"flux"}, observer.uninstalled())
	assert.Equal(t, map[string]any{"theme": "dark"}, f.persisted(t))
}

func TestUninstallRunsTheErasureAfterDisposalAndBeforeTheMarkerIsRemoved(t *testing.T) {
	if runtime.GOOS == "windows" {
		// WINDOWS DEFECT: CI5-W1.
		t.Skip("WINDOWS DEFECT CI5-W1: plugin-sdk LoadPluginMetadata never closes plugin.yaml, so a loaded plugin's directory cannot be renamed")
	}
	for _, dev := range []bool{false, true} {
		name := "installed"
		if dev {
			name = "dev"
		}
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			disposed := func() {
				// The installation is disposed of for good, the only point after which
				// anything may be erased: the directory and its staging are gone, the
				// inventory no longer lists the plugin and disposal was published in the
				// recovery marker. The marker itself is still there, so a failure or a
				// kill from here on is retried instead of forgotten.
				require.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
				persisted, err := pm.readPluginStateJSON()
				require.NoError(t, err)
				require.Empty(t, persisted)
				recovery, err := pm.readUninstallRecovery("flux")
				require.NoError(t, err)
				require.NotNil(t, recovery, "the marker must stay until the erase has succeeded")
				require.True(t, recovery.cleanupStarted, "disposal is published before anything is erased")
				require.NoDirExists(t, pm.pluginsRoot.ResolvePath(recovery.Stage))
			}
			// One observer of each kind of registration: the settings controller is
			// connection-less, the resource controller connection-full.
			connless, connfull := newUninstallObserverStub(), newUninstallObserverStub()
			connless.onCall, connfull.onCall = disposed, disposed
			pm.connlessControllers[sdktypes.CapabilityExec] = connless
			pm.connfullControllers[sdktypes.CapabilityResource] = connfull
			var released []string
			pm.SetPluginStateReleaser(func(id string) {
				disposed()
				released = append(released, id)
			})
			installLoadedUIPlugin(t, pm)
			pm.records["flux"].DevMode = dev
			require.NoError(t, pm.writePluginStateJSON())

			var err error
			if dev {
				_, err = pm.UnlinkDevPlugin("flux")
			} else {
				_, err = pm.UninstallPlugin("flux")
			}
			require.NoError(t, err)

			assert.Equal(t, []string{"flux"}, connless.uninstalled())
			assert.Equal(t, []string{"flux"}, connfull.uninstalled())
			assert.Equal(t, []string{"flux"}, released, "the plugin's cached state roots are released once")
			recovery, err := pm.readUninstallRecovery("flux")
			require.NoError(t, err)
			assert.Nil(t, recovery, "the marker goes once the erase has succeeded")
		})
	}
}

func TestUninstallDoesNotNotifyObserversWhenItFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		// WINDOWS DEFECT: CI5-W1.
		t.Skip("WINDOWS DEFECT CI5-W1: plugin-sdk LoadPluginMetadata never closes plugin.yaml, so a loaded plugin's directory cannot be renamed")
	}
	for _, failure := range []string{"unload", "persist", "missing", "not-dev"} {
		t.Run(failure, func(t *testing.T) {
			pm := newTestManager(t)
			observer := newUninstallObserverStub()
			pm.connlessControllers[sdktypes.CapabilityExec] = observer
			installLoadedUIPlugin(t, pm)
			switch failure {
			case "unload":
				observer.shutdownErr = errors.New("controller refuses shutdown")
			case "persist":
				require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0o755))
			}

			var err error
			switch failure {
			case "missing":
				_, err = pm.UninstallPlugin("missing")
			case "not-dev":
				_, err = pm.UnlinkDevPlugin("flux")
			default:
				_, err = pm.UninstallPlugin("flux")
			}

			require.Error(t, err)
			assert.Empty(t, observer.uninstalled())
		})
	}
}

func TestReinstallAfterUninstallStartsFreshAndKeepsHostStoresWritable(t *testing.T) {
	appstate.SkipIfOpenRootBlocksRename(t)
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	// The host opens the plugin's state directories while it is installed, as the
	// resource and data controllers do, and keeps the handles.
	firstStore, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	firstData, err := f.svc.PluginData("flux")
	require.NoError(t, err)
	require.NoError(t, firstStore.WriteFile("first.json", []byte("one"), 0o600))
	require.NoError(t, firstData.WriteFile("first.json", []byte("one"), 0o600))

	_, err = f.pm.UninstallPlugin("flux")
	require.NoError(t, err)
	f.install(t)

	// The new installation inherits no credential value and no file; its
	// ordinary preference carries over, as it always did.
	assert.Equal(t, map[string]any{"apiToken": "", "clientSecret": "", "theme": "dark"}, f.persisted(t))
	pluginDir := f.pm.pluginsRoot.ResolvePath("flux")
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "first.json"))
	assert.NoFileExists(t, filepath.Join(pluginDir, "data", "first.json"))
	// Host writes land in the new directories.
	secondStore, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	secondData, err := f.svc.PluginData("flux")
	require.NoError(t, err)
	require.NoError(t, secondStore.WriteFile("second.json", []byte("two"), 0o600))
	require.NoError(t, secondData.WriteFile("second.json", []byte("two"), 0o600))
	for _, name := range []string{"store", "data"} {
		written, readErr := os.ReadFile(filepath.Join(pluginDir, name, "second.json"))
		require.NoError(t, readErr)
		assert.Equal(t, "two", string(written))
	}
	// A holder of a handle from before the uninstall gets a clean error.
	require.ErrorIs(t, firstStore.WriteFile("late.json", []byte("late"), 0o600), os.ErrClosed)
	require.ErrorIs(t, firstData.WriteFile("late.json", []byte("late"), 0o600), os.ErrClosed)
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "late.json"))
}
