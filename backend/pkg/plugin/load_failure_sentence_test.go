package plugin

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devcontract"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// A capability controller's lifecycle call can fail on the plugin's own answer: the resource
// controller asks the provider for its features before it registers it, and closes the provider
// when it stops, and a plugin that answers either with a typed error gives the host the sentence
// it wrote for it (the SDK restores it from the wire). The load, the unload and the shutdown keep
// the error's text where the plugin's page shows it (the cause of the failure) and return it to
// whoever asked: the install that failed on it, the crash recovery that reports it to a window.
// A provider's sentence reaches a window only after apperror has cleaned it or refused it, so
// what those keep is the gated one. An error the host made itself is not a provider's sentence:
// it has to arrive as it was made, with its own class and words.

const (
	loadHostileSentence = "\x1b[31mauth failed\x1b[0m: password=hunter2 in /Users/jdoe/.kube/config"
	loadHonestSentence  = "The cluster did not answer within ten seconds."
	failureClass        = "UNAVAILABLE"
)

func carriesProviderText(text string) bool {
	for _, marker := range []string{"hunter2", "/Users/jdoe", "u001b", "\x1b"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

// lifecycleFailureController fails the lifecycle calls it is given an error for.
type lifecycleFailureController struct {
	trackingController
	start, stop, shutdown error
}

func (c *lifecycleFailureController) OnPluginStart(string, config.PluginMeta, plugintypes.PluginBackend) error {
	return c.start
}

func (c *lifecycleFailureController) OnPluginStop(string, config.PluginMeta) error { return c.stop }

func (c *lifecycleFailureController) OnPluginShutdown(string, config.PluginMeta) error {
	return c.shutdown
}

// ownerController is the resource controller as the loader meets it when a plugin is started only
// because another plugin requires its connections.
type ownerController struct{ lifecycleFailureController }

func (c *ownerController) OnPluginStartWithoutAutoConnect(string, config.PluginMeta, plugintypes.PluginBackend) error {
	return c.start
}

func hostile() error {
	return &resourcev2.ResourceOperationError{Code: failureClass, Message: loadHostileSentence}
}

type providerFailureCase struct {
	err     error
	message string
}

// providerFailures are the typed errors a provider can answer with, as the three kinds of caller meet them.
func providerFailures() map[string]providerFailureCase {
	refused := apperror.ForResource(resourcev2.NewError(failureClass, ""), "").Detail
	return map[string]providerFailureCase{
		"a sentence with escape bytes, a credential pair and a home path": {err: hostile(), message: refused},
		"the same under the host's own words":                             {err: fmt.Errorf("closing: %w", hostile()), message: refused},
		"an honest sentence is kept": {
			err: &resourcev2.ResourceOperationError{Code: failureClass, Message: loadHonestSentence}, message: loadHonestSentence},
	}
}

// loaded installs a plugin that declares capability, backed by an in-process backend, with
// controller standing for the capability's controller.
func loaded(t *testing.T, capability sdktypes.Capability, controller plugintypes.Controller) (*pluginManager, string) {
	t.Helper()
	pm := newTestManager(t)
	id := "provider-failure"
	installPluginFixture(t, pm, id, []string{capability.String()}, true)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{capability.String(): struct{}{}}})
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) { return backend, nil }
	pm.connlessControllers[capability] = controller
	return pm, id
}

// loadedResource is loaded for the resource capability, whose controller is a connection-full one.
func loadedResource(t *testing.T, controller plugintypes.Controller) (*pluginManager, string) {
	t.Helper()
	pm, id := loaded(t, sdktypes.CapabilityResource, &trackingController{})
	delete(pm.connlessControllers, sdktypes.CapabilityResource)
	pm.connfullControllers[sdktypes.CapabilityResource] = controller
	return pm, id
}

// whatTheyKeep is the two texts a failed call leaves: the error it returned and the cause the
// plugin's page shows.
func (pm *pluginManager) whatTheyKeep(id string, returned error) map[string]string {
	pm.recordsMu.RLock()
	defer pm.recordsMu.RUnlock()
	kept := map[string]string{}
	if returned != nil {
		kept["the error it returned"] = returned.Error()
	}
	if record, ok := pm.records[id]; ok {
		kept["the cause the plugin's page shows"] = record.LastError
	}
	return kept
}

// requireGated: the texts carry the class, and the sentence the gate lets through, and nothing
// of what the plugin wrote that it refused.
func requireGated(t *testing.T, kept map[string]string, class, message string) {
	t.Helper()
	require.NotEmpty(t, kept)
	for what, text := range kept {
		require.False(t, carriesProviderText(text), "%s carries what the plugin wrote: %s", what, text)
		require.Contains(t, text, message, what)
		require.Contains(t, text, class, "%s names no class: %s", what, text)
	}
}

func TestALoadThatFailsOnAProvidersErrorCarriesTheGatedSentence(t *testing.T) {
	for controller, capability := range map[string]sdktypes.Capability{
		"a capability controller": sdktypes.CapabilityExec,
		"the settings controller": sdktypes.CapabilitySettings,
	} {
		for name, tc := range providerFailures() {
			t.Run(controller+": "+name, func(t *testing.T) {
				pm, id := loaded(t, capability, &lifecycleFailureController{start: tc.err})

				_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})

				require.Error(t, err)
				requireGated(t, pm.whatTheyKeep(id, err), failureClass, tc.message)
			})
		}
	}
}

// A plugin started only because another requires its connections starts its resource controller
// without auto-connect (loader.go, the dependency owner's start).
func TestALoadOfARequiredOwnerThatFailsOnAProvidersErrorCarriesTheGatedSentence(t *testing.T) {
	for name, tc := range providerFailures() {
		t.Run(name, func(t *testing.T) {
			owner := &ownerController{}
			owner.start = tc.err
			pm, id := loadedResource(t, owner)

			_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir(), dependencyOwner: true})

			require.Error(t, err)
			requireGated(t, pm.whatTheyKeep(id, err), failureClass, tc.message)
		})
	}
}

func TestAnUnloadThatFailsOnAProvidersErrorCarriesTheGatedSentence(t *testing.T) {
	for controller, capability := range map[string]sdktypes.Capability{
		"a capability controller": sdktypes.CapabilityExec,
		"the settings controller": sdktypes.CapabilitySettings,
	} {
		for call, failing := range map[string]func(error) *lifecycleFailureController{
			"stop":     func(err error) *lifecycleFailureController { return &lifecycleFailureController{stop: err} },
			"shutdown": func(err error) *lifecycleFailureController { return &lifecycleFailureController{shutdown: err} },
		} {
			for name, tc := range providerFailures() {
				t.Run(controller+": "+call+": "+name, func(t *testing.T) {
					pm, id := loaded(t, capability, failing(tc.err))
					_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})
					require.NoError(t, err)

					err = pm.UnloadPlugin(id)

					require.Error(t, err)
					requireGated(t, pm.whatTheyKeep(id, err), failureClass, tc.message)
				})
			}
		}
	}
}

// The resource controller is a connection-full one: its Close, on the shutdown of the plugin,
// is where a provider that fails to close answers with a typed error (loader.go, the shutdown
// loop over the connection-full controllers).
func TestAnUnloadWhoseConnectionFullControllerFailsOnAProvidersErrorCarriesTheGatedSentence(t *testing.T) {
	for name, tc := range providerFailures() {
		t.Run(name, func(t *testing.T) {
			pm, id := loadedResource(t, &lifecycleFailureController{shutdown: tc.err})
			_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})
			require.NoError(t, err)

			err = pm.UnloadPlugin(id)

			require.Error(t, err)
			requireGated(t, pm.whatTheyKeep(id, err), failureClass, tc.message)
		})
	}
}

// A start that fails retires the controllers it had started, and what their stop answers is
// joined to the error of the load.
func TestARollbackThatFailsOnAProvidersErrorCarriesTheGatedSentence(t *testing.T) {
	for name, tc := range providerFailures() {
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			id := "provider-failure"
			installPluginFixture(t, pm, id, []string{"settings", "exec"}, true)
			backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"settings": struct{}{}, "exec": struct{}{}}})
			pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) { return backend, nil }
			pm.connlessControllers[sdktypes.CapabilitySettings] = &lifecycleFailureController{stop: tc.err}
			pm.connlessControllers[sdktypes.CapabilityExec] = &lifecycleFailureController{start: errors.New("controller initialization failed")}

			_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})

			require.ErrorContains(t, err, "controller initialization failed", "the host's own error keeps its text")
			requireGated(t, pm.whatTheyKeep(id, err), failureClass, tc.message)
		})
	}
}

// The tools controller's previous advertisement is retired before anything else starts.
func TestARetiredToolsControllerThatFailsOnAProvidersErrorCarriesTheGatedSentence(t *testing.T) {
	for name, tc := range providerFailures() {
		t.Run(name, func(t *testing.T) {
			pm, id := loaded(t, sdktypes.CapabilityExec, &lifecycleFailureController{})
			pm.connlessControllers[sdktypes.CapabilityTools] = &lifecycleFailureController{stop: tc.err}

			_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})

			require.Error(t, err)
			requireGated(t, pm.whatTheyKeep(id, err), failureClass, tc.message)
		})
	}
}

// The CLI of a development build reads the first AppError in the chain of the error that stopping
// a plugin returns, and maps its type to an exit code. That error is the host's own failure to
// stop the plugin, whatever class the provider answered its Close with: a provider's TIMEOUT is
// not the CLI's own wait running out.
func TestStopDevPluginReportsAControllersFailureAsTheHostsOwn(t *testing.T) {
	pm, id := loaded(t, sdktypes.CapabilityExec, &lifecycleFailureController{
		shutdown: &resourcev2.ResourceOperationError{Code: "TIMEOUT", Message: loadHostileSentence}})
	_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})
	require.NoError(t, err)

	err = pm.StopDevPlugin(id)

	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	require.Equal(t, apperror.TypePluginLoadFailed, app.Type, "the first error of the chain is the host's")
	refused := apperror.ForResource(resourcev2.NewError("TIMEOUT", ""), "").Detail
	requireGated(t, pm.whatTheyKeep(id, err), "TIMEOUT", refused)
}

// undeclaredOwnerTools is a plugin whose tool names a connection owner that the plugin did not
// declare in requires.connections.
type undeclaredOwnerTools struct{}

func (undeclaredOwnerTools) ListTools(*sdktypes.PluginContext) ([]sdktools.Descriptor, error) {
	return []sdktools.Descriptor{{Name: "status", Scope: sdktools.ScopeConnection, ConnectionOwner: "kubernetes", InputSchema: sdktools.ObjectSchema(nil)}}, nil
}

func (undeclaredOwnerTools) CallTool(*sdktypes.PluginContext, sdktools.CallInput) (*sdktools.Result, error) {
	return sdktools.TextResult("ok"), nil
}

// The tools controller refuses such a plugin with the host's own reason. A plugin author who forgot
// requires.connections reads that reason where the load failed, and not "Internal error".
func TestAToolsControllerThatRefusesAnUndeclaredConnectionOwnerKeepsItsReason(t *testing.T) {
	pm := newTestManager(t)
	id := "needs-grant"
	installPluginFixture(t, pm, id, []string{"tools"}, true)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"tools": undeclaredOwnerTools{}}})
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) { return backend, nil }
	pm.connlessControllers[sdktypes.CapabilityTools] = tools.NewController(logging.NewNop(), nil)

	_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})

	require.Error(t, err)
	kept := pm.whatTheyKeep(id, err)
	require.NotEmpty(t, kept)
	for what, text := range kept {
		require.Contains(t, text, "Cross-plugin connection access is not permitted", what)
		require.Contains(t, text, "does not declare in requires.connections", what)
		require.NotContains(t, text, "Internal error", "%s flattens the host's own reason: %s", what, text)
	}
}

// hostMade is an error that the host made itself or took from the system, with what a reader of the
// plugin's page has to find in it. None holds a provider's typed error.
type hostMade struct {
	err      error
	sentence string
}

func hostMadeFailures() map[string]hostMade {
	return map[string]hostMade{
		"a refusal the host words": {
			err: apperror.New(apperror.TypePluginBuildFailed, http.StatusUnprocessableEntity,
				"Plugin refused", "A tool of this plugin names a connection owner it does not declare."),
			sentence: "A tool of this plugin names a connection owner it does not declare."},
		"a state file the host cannot write": {
			err:      &fs.PathError{Op: "open", Path: "/state/plugins/p/state.json", Err: fs.ErrPermission},
			sentence: "open /state/plugins/p/state.json: permission denied"},
		"a refusal of the channel's handshake": {
			err:      errors.New("tls: failed to verify client certificate: x509: certificate signed by unknown authority"),
			sentence: "certificate signed by unknown authority"},
		"the loader's start deadline": {
			err:      startTimeoutError{err: errors.New("timeout while waiting for plugin to start")},
			sentence: "timeout while waiting for plugin to start"},
		"a refusal of the plugin's SDK release": {
			err:      devcontract.Fail(4, "sdk_release_untrusted", "kubernetes resolves plugin-sdk v0.20.0, which this controller does not accept: below the floor"),
			sentence: "which this controller does not accept: below the floor"},
		"a refusal of the plugin's protocol": {
			err:      &plugintypes.IncompatibleError{Incompatibility: plugintypes.Incompatibility{PluginProtocol: 2, Accepted: plugintypes.AcceptedProtocols()}},
			sentence: "It uses plugin protocol 2; this Omniview accepts protocol 1."},
	}
}

// The gate acts on a provider's typed error and on nothing else: every error the host made comes
// back as the same error, so its class, its words and its chain are the ones it was made with.
func TestControllerFailureHandsBackEveryHostMadeErrorAsItIs(t *testing.T) {
	for name, failure := range hostMadeFailures() {
		t.Run(name, func(t *testing.T) {
			got := controllerFailure(failure.err)

			require.Equal(t, failure.err, got)
			require.Equal(t, failure.err.Error(), got.Error())
			require.ErrorIs(t, got, failure.err)
		})
	}
	require.NoError(t, controllerFailure(nil))
}

// A host-made typed error of a class that may show a sentence keeps it: the resource controller
// refuses a provider that advertises a trait it does not serve with INVALID_REQUEST.
func TestControllerFailureKeepsTheSentenceOfAHostMadeTypedErrorOfAClassThatMayShowOne(t *testing.T) {
	const sentence = "Provider advertised an unavailable metadata trait."

	var app *apperror.AppError
	require.ErrorAs(t, controllerFailure(resourcev2.NewError("INVALID_REQUEST", sentence)), &app)

	require.Equal(t, "INVALID_REQUEST", app.Code)
	require.Equal(t, sentence, app.Detail)
}

// An error the host made, returned by a controller's start, stop or shutdown, reaches the plugin's
// page and the caller with its own words and its own chain.
func TestAHostMadeFailureOfAControllerKeepsItsSentenceThroughTheLoader(t *testing.T) {
	for call, failing := range map[string]func(error) *lifecycleFailureController{
		"start":    func(err error) *lifecycleFailureController { return &lifecycleFailureController{start: err} },
		"stop":     func(err error) *lifecycleFailureController { return &lifecycleFailureController{stop: err} },
		"shutdown": func(err error) *lifecycleFailureController { return &lifecycleFailureController{shutdown: err} },
	} {
		for name, failure := range hostMadeFailures() {
			t.Run(call+": "+name, func(t *testing.T) {
				pm, id := loaded(t, sdktypes.CapabilityExec, failing(failure.err))
				_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})
				if call != "start" {
					require.NoError(t, err)
					err = pm.UnloadPlugin(id)
				}

				require.Error(t, err)
				require.ErrorIs(t, err, failure.err)
				for what, text := range pm.whatTheyKeep(id, err) {
					require.Contains(t, text, failure.sentence, what)
					require.NotContains(t, text, "Internal error", what)
				}
			})
		}
	}
}

// The errors of the channel (its handshake, its deadline, the refusal of the plugin's SDK release)
// are made before any controller starts: they never meet the gate, and the page reads them as made.
func TestAHostMadeFailureOfTheBackendKeepsItsSentenceThroughTheLoader(t *testing.T) {
	for name, failure := range hostMadeFailures() {
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			id := "backend-failure"
			installPluginFixture(t, pm, id, []string{"exec"}, true)
			pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) { return nil, failure.err }

			_, err := pm.LoadPlugin(id, &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})

			require.Error(t, err)
			require.ErrorIs(t, err, failure.err)
			for what, text := range pm.whatTheyKeep(id, err) {
				require.Contains(t, text, failure.sentence, what)
			}
		})
	}
}
