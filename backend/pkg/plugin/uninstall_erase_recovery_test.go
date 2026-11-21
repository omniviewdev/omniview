package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	boltErrors "go.etcd.io/bbolt/errors"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// An uninstall that has disposed of the installation still owes the erase of
// the credential state kept outside it. The erase runs inside the uninstall's
// recovery path, after disposal and before the recovery marker is removed, so
// that what is owed is never forgotten: an erase that fails, or a process that
// dies first, leaves the marker, the plugin shows as a failed pending uninstall,
// the ID cannot be installed again (the new installation would inherit the
// values), and uninstalling again, also after a restart, runs the erase again.

// uiArchive packages a plugin without settings capability under the fixture ID.
func uiArchive(t *testing.T) string {
	t.Helper()
	return writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0o644, body: "id: flux\nversion: 1.0.0\ncapabilities: [ui]\n"},
		{name: "assets/entry.js", mode: 0o644, body: "bundle"},
	})
}

func TestUninstallEraseFailureFailsTheUninstallAndTheRetryErasesAgain(t *testing.T) {
	cleanupErr := errors.New("settings store offline")
	pm := newTestManager(t)
	observer := newUninstallObserverStub()
	observer.err = cleanupErr
	pm.connlessControllers[sdktypes.CapabilityExec] = observer
	installLoadedUIPlugin(t, pm)
	refreshes := 0
	pm.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}

	info, err := pm.UninstallPlugin("flux")

	// The uninstall did not complete: it is reported like any other incomplete
	// uninstall, with the cause attached and no cause text shown.
	require.Error(t, err)
	require.ErrorIs(t, err, cleanupErr)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.NotEqual(t, apperror.TypePluginCommittedCleanupPending, appErr.Type, "nothing is committed while an erase is owed")
	assert.Equal(t, "flux", appErr.Instance)
	assert.NotContains(t, appErr.Detail, cleanupErr.Error())
	assert.Equal(t, "Failed", info.Phase)
	// What the plugin records, and the UI shows, says what is true: the files are
	// gone, the credentials are owed, and uninstalling again is the retry. It does
	// not say that artifacts remain in staging, because none do.
	assert.Contains(t, info.LastError, "retries at the next start")
	assert.NotContains(t, info.LastError, "partial artifacts")
	assert.NotContains(t, info.LastError, "pending uninstall recovery at")
	assert.Equal(t, 0, refreshes, "an incomplete uninstall publishes no inventory change")
	// The installation is gone, and the marker stays as the record of what is owed.
	assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
	recovery, readErr := pm.readUninstallRecovery("flux")
	require.NoError(t, readErr)
	require.NotNil(t, recovery, "the marker is kept so that the erase is retried")
	assert.True(t, recovery.cleanupStarted)
	listed := pm.ListPlugins()
	require.Len(t, listed, 1)
	assert.Equal(t, "Failed", listed[0].Phase)
	// The ID cannot be installed again while the erase is owed: a new installation
	// would inherit the values that were not erased.
	_, installErr := pm.InstallPluginFromPath(uiArchive(t))
	require.ErrorAs(t, installErr, &appErr)
	assert.Equal(t, "Plugin uninstall requires recovery", appErr.Title)
	assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))

	// The retry runs the erase again and completes the uninstall.
	observer.err = nil
	_, err = pm.UninstallPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, []string{"flux", "flux"}, observer.uninstalled())
	recovery, readErr = pm.readUninstallRecovery("flux")
	require.NoError(t, readErr)
	assert.Nil(t, recovery)
	assert.Empty(t, pm.ListPlugins())
	assert.Equal(t, 1, refreshes, "the inventory change is published once, when the uninstall completes")
	_, retryErr := pm.UninstallPlugin("flux")
	require.ErrorAs(t, retryErr, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type, "a completed uninstall leaves nothing to retry")
}

func TestStartupCompletesAnUninstallWhoseEraseFailed(t *testing.T) {
	pm := newTestManager(t)
	observer := newUninstallObserverStub()
	observer.err = errors.New("settings store offline")
	pm.connlessControllers[sdktypes.CapabilityExec] = observer
	installLoadedUIPlugin(t, pm)
	_, err := pm.UninstallPlugin("flux")
	require.Error(t, err)

	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	restarted.pidTracker = NewPIDTracker(pm.stateRoot)
	second := newUninstallObserverStub()
	restarted.connlessControllers[sdktypes.CapabilityExec] = second
	recorder := &testRecordingEmitter{}
	restarted.emitter = recorder
	require.NoError(t, restarted.Initialize(context.Background()))

	// No one pressed a button: the host start retried the erase and finished the uninstall.
	assert.Equal(t, []string{"flux"}, second.uninstalled())
	_, getErr := restarted.GetPlugin("flux")
	require.Error(t, getErr, "a finished uninstall leaves no plugin record")
	assert.Empty(t, restarted.ListPlugins())
	recovery, readErr := restarted.readUninstallRecovery("flux")
	require.NoError(t, readErr)
	assert.Nil(t, recovery)
	persisted, readErr := restarted.readPluginStateJSON()
	require.NoError(t, readErr)
	assert.Empty(t, persisted)
	assert.Empty(t, toldUnloaded(t, recorder.getEvents()), "no window holds an interface of a plugin in a host that has just started")
	_, retryErr := restarted.UninstallPlugin("flux")
	var appErr *apperror.AppError
	require.ErrorAs(t, retryErr, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type, "a finished uninstall leaves nothing to retry")
}

func TestUninstallEraseFailureOfARecordWithoutAnInstallationIsRetried(t *testing.T) {
	cleanupErr := errors.New("settings store offline")
	pm := newTestManager(t)
	observer := newUninstallObserverStub()
	observer.err = cleanupErr
	pm.connlessControllers[sdktypes.CapabilityExec] = observer
	// A failed inventory entry may have no installation to stage, hence no marker.
	pm.records["flux"] = plugintypes.NewPluginRecord("flux", config.PluginMeta{
		ID: "flux", Capabilities: []string{"ui"},
	}, lifecycle.PhaseFailed)
	require.NoError(t, pm.writePluginStateJSON())

	_, err := pm.UninstallPlugin("flux")

	require.ErrorIs(t, err, cleanupErr)
	listed := pm.ListPlugins()
	require.Len(t, listed, 1, "the record returns, failed, so that there is something to retry")
	assert.Equal(t, "Failed", listed[0].Phase)
	persisted, readErr := pm.readPluginStateJSON()
	require.NoError(t, readErr)
	assert.Len(t, persisted, 1, "the inventory keeps the record until the erase has succeeded")

	observer.err = nil
	_, err = pm.UninstallPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, []string{"flux", "flux"}, observer.uninstalled())
	assert.Empty(t, pm.ListPlugins())
}

func TestUninstallEraseFailureLogsAndShowsTheErrorClassOnly(t *testing.T) {
	const secret = "erase-secret-xyz"
	pm := newTestManager(t)
	sink := installRecordingLogger(pm)
	observer := newUninstallObserverStub()
	observer.err = errors.New("write failed token=" + secret)
	pm.connlessControllers[sdktypes.CapabilityExec] = observer
	installLoadedUIPlugin(t, pm)

	info, err := pm.UninstallPlugin("flux")

	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.NotContains(t, appErr.Error(), secret, "the error the UI shows carries no cause text")
	assert.NotEmpty(t, info.LastError, "the plugin records why its uninstall is incomplete")
	assert.NotContains(t, info.LastError, secret, "the recorded last error carries no cause text either")
	assert.NotContains(t, fmt.Sprint(info), secret)
	var logged bool
	for _, record := range sink.Records() {
		fields := record.ToMap()
		assert.NotContains(t, record.Message+fmt.Sprint(fields), secret, "no log line carries the cause text: %q", record.Message)
		if record.Level == logging.LevelError && record.Message == "plugin uninstall left stored credential state behind" {
			logged = true
			assert.Equal(t, "flux", fields["pluginID"])
			assert.Contains(t, fields, "errorClass", "the class is logged instead of the text")
		}
	}
	assert.True(t, logged, "the failed erase must be logged at error level")
}

// processKilled is what the simulated kill panics with.
type processKilled struct{}

// settingsKilledBeforeTheErase is the settings controller of a host whose
// process dies when the erase is about to run. Everything before it is real.
type settingsKilledBeforeTheErase struct {
	settings.Controller
	kill func()
}

func (c settingsKilledBeforeTheErase) OnPluginUninstalled(string) error {
	c.kill()
	return errors.New("the process was not killed")
}

// runUntilKilled runs fn and reports whether the simulated kill ended it. The
// panic unwinds the stack, so the deferred unlocks run, but nothing after the
// kill point does: no rollback, no cleanup and no state written, which is what
// a dead process leaves behind.
func runUntilKilled(fn func()) bool {
	killed := false
	func() {
		defer func() {
			if r := recover(); r != nil {
				if _, ok := r.(processKilled); !ok {
					panic(r)
				}
				killed = true
			}
		}()
		fn()
	}()
	return killed
}

func TestUninstallKilledBeforeTheEraseIsCompletedByTheNextStart(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	f.pm.connlessControllers[sdktypes.CapabilitySettings] = settingsKilledBeforeTheErase{
		Controller: f.settings,
		kill:       func() { panic(processKilled{}) },
	}

	killed := runUntilKilled(func() { _, _ = f.pm.UninstallPlugin("flux") })
	require.True(t, killed, "the uninstall must have reached the erase")

	requireErasePendingOnDisk(t, f)
	requireStartupCompletedTheUninstall(t, f.restart(t))
}

// requireErasePendingOnDisk checks what a process killed between the durable
// uninstall and the erase leaves: the installation is gone and no inventory
// entry lists it, the recovery marker records that disposal ran, and the
// credentials are still in the settings store.
func requireErasePendingOnDisk(t *testing.T, f *credentialFixture) {
	t.Helper()
	assert.NoDirExists(t, f.pm.pluginsRoot.ResolvePath("flux"))
	persisted, err := f.pm.readPluginStateJSON()
	require.NoError(t, err)
	assert.Empty(t, persisted)
	recovery, err := f.pm.readUninstallRecovery("flux")
	require.NoError(t, err)
	require.NotNil(t, recovery, "the marker must survive the kill: it is what the retry runs from")
	assert.True(t, recovery.cleanupStarted)
	assert.Equal(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"}, f.persisted(t),
		"the erase did not run")
}

// requireStartupCompletedTheUninstall takes the host that started after the kill
// or the failed erase, and checks that no one had to do anything: the start
// retried the erase, so the credentials are gone, the ordinary setting stays, no
// marker or plugin record is left and the ID can be installed again, with none of
// the old plugin's credentials.
func requireStartupCompletedTheUninstall(t *testing.T, next *credentialFixture) {
	t.Helper()
	_, err := next.pm.GetPlugin("flux")
	require.Error(t, err, "the host start finished the uninstall: no plugin record is left")
	assert.Empty(t, next.pm.ListPlugins())
	assert.Equal(t, map[string]any{"theme": "dark"}, next.persisted(t),
		"the credentials are erased and the ordinary setting stays")
	recovery, err := next.pm.readUninstallRecovery("flux")
	require.NoError(t, err)
	assert.Nil(t, recovery)
	persisted, err := next.pm.readPluginStateJSON()
	require.NoError(t, err)
	assert.Empty(t, persisted)
	// A reinstall can never see the old plugin's credentials.
	next.install(t)
	assert.Equal(t, map[string]any{"apiToken": "", "clientSecret": "", "theme": "dark"}, next.persisted(t))
}

const (
	killChildDirectory = "OMNIVIEW_TEST_UNINSTALL_KILL_DIRECTORY"
	killChildExitCode  = 86
)

// TestUninstallKilledProcessBeforeTheEraseIsCompletedByTheNextStart kills a real
// process: a child process of this test binary runs the uninstall and exits the
// moment the erase is about to run, with no deferred function and no cleanup.
// This process then starts over what it left, as the next start of the host does,
// and nothing but the start is needed to finish the uninstall.
func TestUninstallKilledProcessBeforeTheEraseIsCompletedByTheNextStart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the child process installs the fixture archive, whose bin/plugin is a Unix shell script; a Windows host requires bin/plugin.exe")
	}
	dir := t.TempDir()
	child := exec.Command(os.Args[0], "-test.run=^TestUninstallKillHelperProcess$", "-test.count=1")
	child.Env = append(os.Environ(), killChildDirectory+"="+dir)
	output, err := child.CombinedOutput()
	var exitErr *exec.ExitError
	require.ErrorAs(t, err, &exitErr, "the child must have been killed, not finished: %s", output)
	require.Equal(t, killChildExitCode, exitErr.ExitCode(), "the child must have been killed at the erase: %s", output)

	svc, err := appstate.New(appstate.WithRoot(filepath.Join(dir, "state")), appstate.WithFlock(false))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, svc.Close()) })
	next := newCredentialFixtureOver(t, svc, filepath.Join(dir, "settings.db"))
	assert.Equal(t, credentialToken, next.persisted(t)["apiToken"], "the killed process erased nothing")
	require.NoError(t, next.pm.Initialize(context.Background()))
	requireStartupCompletedTheUninstall(t, next)
}

// TestUninstallKillHelperProcess is the child of the test above. It does
// nothing in a normal run.
func TestUninstallKillHelperProcess(t *testing.T) {
	dir := os.Getenv(killChildDirectory)
	if dir == "" {
		t.Skip("helper process of TestUninstallKilledProcessBeforeTheEraseIsCompletedByTheNextStart")
	}
	svc, err := appstate.New(appstate.WithRoot(filepath.Join(dir, "state")), appstate.WithFlock(false))
	require.NoError(t, err)
	f := newCredentialFixtureOver(t, svc, filepath.Join(dir, "settings.db"))
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	f.pm.connlessControllers[sdktypes.CapabilitySettings] = settingsKilledBeforeTheErase{
		Controller: f.settings,
		kill:       func() { os.Exit(killChildExitCode) },
	}

	_, _ = f.pm.UninstallPlugin("flux")

	t.Fatal("the process was not killed at the erase")
}

func TestUninstallSettingsStoreFailureFailsTheUninstallUntilTheNextStartFinishesIt(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	require.NoError(t, f.store.Close())

	_, err := f.pm.UninstallPlugin("flux")

	require.ErrorIs(t, err, boltErrors.ErrDatabaseNotOpen)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.NotEqual(t, apperror.TypePluginCommittedCleanupPending, appErr.Type)
	assert.NoDirExists(t, f.pm.pluginsRoot.ResolvePath("flux"))
	info, getErr := f.pm.GetPlugin("flux")
	require.NoError(t, getErr, "the plugin stays listed, failed, while the erase is owed")
	assert.Equal(t, "Failed", info.Phase)

	// The store is back (a restart): the host start retries the erase and finishes
	// the uninstall, without a user.
	next := f.restart(t)
	_, getErr = next.pm.GetPlugin("flux")
	require.Error(t, getErr)
	assert.Equal(t, map[string]any{"theme": "dark"}, next.persisted(t))
}

// settingsFailingFirst is the settings controller of a host whose erase fails a
// given number of times, across restarts (the counter is shared), and then works.
type settingsFailingFirst struct {
	settings.Controller
	remaining *atomic.Int32
}

func (c settingsFailingFirst) OnPluginUninstalled(pluginID string) error {
	if c.remaining.Add(-1) >= 0 {
		// A cause text that carries a value: it must never reach the plugin's last error.
		return errors.New("settings store offline, token=" + credentialToken)
	}
	observer, ok := c.Controller.(plugintypes.PluginUninstallObserver)
	if !ok {
		return errors.New("the settings controller has no uninstall hook")
	}
	return observer.OnPluginUninstalled(pluginID)
}

func TestStartupRetriesAFailedEraseAtEveryStartUntilItSucceeds(t *testing.T) {
	var remaining atomic.Int32
	remaining.Store(2) // the erase fails twice, then works
	failTwice := func(c *credentialFixture) {
		c.pm.connlessControllers[sdktypes.CapabilitySettings] = settingsFailingFirst{Controller: c.settings, remaining: &remaining}
	}
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	failTwice(f)

	// Attempt 1, by the uninstall itself, fails.
	_, err := f.pm.UninstallPlugin("flux")
	require.Error(t, err)

	// Attempt 2, by the first start, fails too: the plugin stays failed, with the
	// class of the cause and no cause text, and the credentials stay owed.
	next := f.restart(t, failTwice)
	held, err := next.pm.GetPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, "Failed", held.Phase)
	assert.Contains(t, held.LastError, "retries at the next start")
	assert.NotContains(t, held.LastError, credentialToken)
	assert.Equal(t, credentialToken, next.persisted(t)["apiToken"])
	_, installErr := next.pm.InstallPluginFromPath(credentialArchive(t))
	require.Error(t, installErr, "the ID cannot be installed again while the erase is owed")

	// Attempt 3, by the next start, works, with no user action.
	requireStartupCompletedTheUninstall(t, next.restart(t, failTwice))
}

func TestStartupLeavesAnUninstallThatDidNotReachDisposalToTheUser(t *testing.T) {
	pm := newTestManager(t)
	installLoadedUIPlugin(t, pm)
	// The process died after the uninstall began, before disposal: it can still be
	// rolled back, so nothing may be erased for it.
	recovery, err := pm.prepareUninstallRecovery("flux", pm.records["flux"])
	require.NoError(t, err)
	require.NotNil(t, recovery)
	require.False(t, recovery.cleanupStarted)
	// The plugin is staged but not disposed of: it can still be restored.
	staged := filepath.Join(recovery.Stage, "plugin")
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", staged))

	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	restarted.pidTracker = NewPIDTracker(pm.stateRoot)
	second := newUninstallObserverStub()
	restarted.connlessControllers[sdktypes.CapabilityExec] = second
	require.NoError(t, restarted.Initialize(context.Background()))

	assert.Empty(t, second.uninstalled(), "an uninstall that can still roll back erases nothing")
	held, err := restarted.GetPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, "Failed", held.Phase)
	assert.DirExists(t, pm.pluginsRoot.ResolvePath(staged), "nothing was disposed of: the staged plugin is intact")
}

func TestStartupStopsFinishingUninstallsWhenItsTimeBudgetIsSpent(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	f.pm.connlessControllers[sdktypes.CapabilitySettings] = settingsKilledBeforeTheErase{
		Controller: f.settings,
		kill:       func() { panic(processKilled{}) },
	}
	require.True(t, runUntilKilled(func() { _, _ = f.pm.UninstallPlugin("flux") }))

	// A start with no time left attempts nothing: the plugin stays failed and the
	// credentials stay owed.
	spent := f.restart(t, func(c *credentialFixture) { c.pm.startupEraseBudget = -time.Second })
	held, err := spent.pm.GetPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, "Failed", held.Phase)
	assert.Equal(t, credentialToken, spent.persisted(t)["apiToken"])

	// The next start has its whole budget and finishes the uninstall.
	requireStartupCompletedTheUninstall(t, spent.restart(t))
}

func TestAnUninstallThatIsRetriedTellsTheWindowThePluginIsGoneOnce(t *testing.T) {
	pm, recorder := loadedPlugin(t, "flux")
	observer := newUninstallObserverStub()
	observer.err = errors.New("settings store offline")
	pm.connlessControllers[sdktypes.CapabilityExec] = observer

	_, err := pm.UninstallPlugin("flux")
	require.Error(t, err)
	_, err = pm.UninstallPlugin("flux") // the user's retry, still failing
	require.Error(t, err)
	observer.err = nil
	_, err = pm.UninstallPlugin("flux") // the retry that completes it
	require.NoError(t, err)

	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{"pluginID": "flux", "cause": "uninstalled"}}, toldUnloaded(t, events),
		"the window is told once per uninstall, not once per attempt: %v", names(events))
}
