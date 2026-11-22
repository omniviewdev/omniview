package plugin

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Every class of failed load the host produces, with the cause the window is told and the title the host words the failure with (docs/ui-next/status/S4.md, "Every class of failed load"). A refusal by protocol
// number (`incompatible`) has to stay distinct from every other: a plugin that crashed at start, one that said nothing within the loader's start timeout, one whose channel failed its mutual TLS (#591), one whose
// SDK release the workspace refuses (`sdk_release_untrusted`), one with no binary or no usable metadata, and the one that speaks a protocol so far ahead that go-plugin names nothing. A real process stands for each class
// that a process makes: the fixture executable exits, or stays silent, or is a real go-plugin server that presents the wrong certificate or serves protocol 2. Only the SDK's refusal of a workspace's release is made at
// the loader's factory (it is made before any process exists).

const (
	// What the window is told of a load that was refused before it could be named: nothing at all.
	toldNothing = ""

	titleRPC          = "Failed to initialize plugin RPC"
	titleIncompatible = "Plugin is not compatible with this version of Omniview"
)

type failedLoadClass struct {
	name string
	// install makes plugin "acme" fail to load in this way.
	install func(t *testing.T, pm *pluginManager)
	// cause is the cause the window is told, or toldNothing when the load names no plugin and tells no one.
	cause string
	// title is the title of the AppError the load returns, "" when the error is not one the loader wrapped.
	title string
	// says is a word of the failure's own text that proves the row is the failure it names (a test reads it; the host never decides by text).
	says string
}

func failedLoadClasses() []failedLoadClass {
	return []failedLoadClass{
		{
			name: "the process exits at once: a plugin that crashed at start",
			install: func(t *testing.T, pm *pluginManager) {
				installPluginFixture(t, pm, "acme", []string{"resource"}, true)
				writePluginFixture(t, filepath.Join(pm.pluginsRoot.ResolvePath("acme"), "bin"), &pluginFixtureBehaviour{ExitCode: 3})
			},
			cause: "failed", title: titleRPC, says: handshakeSentence,
		},
		{
			name: "the process says nothing within the loader's start timeout",
			install: func(t *testing.T, pm *pluginManager) {
				slowPlugin(t, pm, "acme")
				pm.startTimeout = 400 * time.Millisecond
			},
			cause: "timeout", title: titleRPC, says: "timeout while waiting for plugin to start",
		},
		{
			name: "the file that should be the executable is not one",
			install: func(t *testing.T, pm *pluginManager) {
				installPluginFixture(t, pm, "acme", []string{"resource"}, true)
				require.NoError(t, os.WriteFile(filepath.Join(pm.pluginsRoot.ResolvePath("acme"), "bin", plugintypes.BinaryName()), []byte("not an executable"), 0o755))
			},
			cause: "failed", title: titleRPC, says: "exec format error",
		},
		{
			name: "the process presents another certificate than the one it advertised (the channel's mutual TLS, #591)",
			install: func(t *testing.T, pm *pluginManager) {
				binary, err := os.Executable()
				require.NoError(t, err)
				shortSocketRoot(t, "ch-")
				t.Setenv("CHANNEL_TEST_BINARY", binary)
				t.Setenv(impostorChildEnv, "1")
				t.Setenv(impostorOutEnv, filepath.Join(t.TempDir(), "handshake"))
				installPluginFixture(t, pm, "acme", []string{"resource"}, true)
				writePluginFixture(t, filepath.Join(pm.pluginsRoot.ResolvePath("acme"), "bin"), pluginFixtureRunsTestBinary("CHANNEL_TEST_BINARY", "TestChannelImpostorChildProcess"))
				// The first call on the channel is the binding of the plugin's activities: it is where the host's end of the handshake refuses the certificate.
				pm.activities = activityBrokerManager(activityObserverService(t)).activities
			},
			// go-plugin dials lazily, so the refusal comes with the first call, and the loader returns that call's own error.
			cause: "failed", title: "", says: "x509: certificate signed by unknown authority",
		},
		{
			name: "the plugin has no executable",
			install: func(t *testing.T, pm *pluginManager) {
				installPluginFixture(t, pm, "acme", []string{"resource"}, false)
			},
			cause: "failed", title: "Plugin 'acme' failed validation during loading", says: "resource plugin binary not found",
		},
		{
			name: "plugin.yaml does not say whose it is",
			install: func(t *testing.T, pm *pluginManager) {
				installPluginFixture(t, pm, "acme", []string{"resource"}, true)
				require.NoError(t, os.WriteFile(filepath.Join(pm.pluginsRoot.ResolvePath("acme"), "plugin.yaml"), []byte("id: someone-else\nversion: 1.0.0\n"), 0o644))
			},
			// Nothing names the plugin: the files say another id, and no state of the caller's holds one.
			cause: toldNothing, title: "", says: "does not match",
		},
		{
			name: "there is no plugin.yaml",
			install: func(t *testing.T, pm *pluginManager) {
				require.NoError(t, pm.pluginsRoot.MkdirAll("acme", 0o755))
			},
			cause: toldNothing, title: "Plugin metadata missing", says: "is missing its metadata file",
		},
		{
			name: "the SDK release of a workspace's plugin is not trusted (sdk_release_untrusted)",
			install: func(t *testing.T, pm *pluginManager) {
				installPluginFixture(t, pm, "acme", []string{"resource"}, true)
				// The refusal is made before any process exists (instance.PreparePluginArtifact), so the loader's own factory stands for it.
				pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
					return nil, devcontract.Fail(4, "sdk_release_untrusted", "kubernetes resolves plugin-sdk v0.20.0, which this controller does not accept: below the floor")
				}
			},
			cause: "failed", title: titleRPC, says: "which this controller does not accept",
		},
		{
			name: "a controller cannot start what the plugin brings",
			install: func(t *testing.T, pm *pluginManager) {
				installPluginFixture(t, pm, "acme", []string{"exec"}, true)
				backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"exec": struct{}{}}})
				pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) { return backend, nil }
				pm.connlessControllers[sdktypes.CapabilityExec] = &lifecycleFailureController{start: errors.New("the controller's start failed")}
			},
			cause: "failed", title: "Failed to start plugin", says: "start exec controller: the controller's start failed",
		},
		{
			name: "the process speaks plugin protocol 2, which the host does not run",
			install: func(t *testing.T, pm *pluginManager) {
				protocolPlugin(t, pm, "acme", 2)
			},
			cause: "incompatible", title: titleIncompatible, says: "It uses plugin protocol 2; this Omniview accepts protocol 1.",
		},
		{
			name: "the process speaks a protocol past the ceiling the host offers: the host's sentence, go-plugin's words to the log",
			install: func(t *testing.T, pm *pluginManager) {
				protocolPlugin(t, pm, "acme", 400)
			},
			cause: "failed", title: titleRPC, says: handshakeSentence,
		},
	}
}

func TestEveryClassOfFailedLoadKeepsItsOwnCauseAndOnlyARefusalByProtocolIsIncompatible(t *testing.T) {
	for _, class := range failedLoadClasses() {
		t.Run(class.name, func(t *testing.T) {
			pm := newTestManager(t)
			recorder := &testRecordingEmitter{}
			pm.emitter = recorder
			class.install(t, pm)

			_, err := pm.LoadPlugin("acme", nil)

			require.Error(t, err)
			assert.Contains(t, err.Error(), class.says, "the row is the failure it names")
			told := toldUnloaded(t, recorder.getEvents())
			if class.cause == toldNothing {
				assert.Empty(t, told, "the load names no plugin, so it tells no one: %v", names(recorder.getEvents()))
				assert.Empty(t, pm.ListPlugins(), "and keeps no record")
				return
			}
			assert.Equal(t, []string{class.cause}, causesOf(told), "the window was told: %v", names(recorder.getEvents()))
			assert.Equal(t, class.cause == "incompatible", told[0]["incompatibility"] != nil, "the two numbers ride the event of a refusal by protocol number and of no other class")
			assert.Equal(t, class.cause == "incompatible", inventoryOf(t, pm, "acme")["incompatible"] != nil, "and the inventory of the plugin that was refused by number and of no other")
			_, typed := plugintypes.IncompatibilityOf(err)
			assert.Equal(t, class.cause == "incompatible", typed, "only the refusal by number is the typed decision")
			assert.Equal(t, UnloadCause(class.cause), loadFailureCause(err))
			failedRecord(t, pm, "acme")
		})
	}
}

func TestEveryClassOfFailedLoadSaysItsTitle(t *testing.T) {
	for _, class := range failedLoadClasses() {
		if class.cause == toldNothing && class.title == "" {
			continue
		}
		t.Run(class.name, func(t *testing.T) {
			pm := newTestManager(t)
			class.install(t, pm)

			_, err := pm.LoadPlugin("acme", nil)

			require.Error(t, err)
			var app *apperror.AppError
			if class.title == "" {
				assert.NotErrorAs(t, err, &app, "a failure of the channel's own first call is returned as it was made")
				return
			}
			require.ErrorAs(t, err, &app)
			assert.Equal(t, class.title, app.Title)
		})
	}
}
