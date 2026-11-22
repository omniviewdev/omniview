package plugin

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// SPIKE S0 (SDK0-S0-dual-read.md), baseline: what the host does today with a plugin whose process
// speaks another go-plugin protocol than the one the host offers (only 1).
//
// The plugin is a real SDK process: the SDK's own examples/resource-plugin, built on a released tag
// (S0_OLD_PLUGIN_EXE: one path or several separated by commas). The manifest's sdk_protocol_version
// overrides the compiled constant (SDK pkg/sdk/plugin.go effectiveProtocolVersion), so the same
// binary serves protocol 1, 2 or 3 without a modified SDK.

func s0Exes(t *testing.T) []string {
	t.Helper()
	list := os.Getenv("S0_OLD_PLUGIN_EXE")
	if list == "" {
		t.Skip("S0_OLD_PLUGIN_EXE names prebuilt SDK example plugins (examples/resource-plugin); see the S0 run notes")
	}
	return strings.Split(list, ",")
}

// s0InstallPrebuilt installs a real executable as plugin id, with a manifest that declares
// sdkProtocol (0 = leave the key out, so the compiled constant applies).
func s0InstallPrebuilt(t *testing.T, pm *pluginManager, id, exe string, sdkProtocol int) {
	t.Helper()
	manifest := "id: " + id + "\nname: " + id + "\nversion: 1.0.0\ncapabilities:\n  - resource\n"
	if sdkProtocol > 0 {
		manifest += "sdk_protocol_version: " + strconv.Itoa(sdkProtocol) + "\n"
	}
	dir := pm.pluginsRoot.ResolvePath(id)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "bin"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(manifest), 0o644))
	data, err := os.ReadFile(exe)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "bin", plugintypes.BinaryName()), data, 0o755))
}

func TestS0TodaysHostWithAPluginOnAnotherProtocol(t *testing.T) {
	for _, exe := range s0Exes(t) {
		for _, tc := range []struct {
			protocol int
			refused  bool
		}{{1, false}, {2, true}, {3, true}} {
			t.Run(filepath.Base(exe)+"/protocol "+strconv.Itoa(tc.protocol), func(t *testing.T) {
				pm, _ := newInstalledNativeManager(t)
				recorder := &testRecordingEmitter{}
				pm.emitter = recorder
				// The plugin id is the SDK example's own: its code opens the plugin root of "notes".
				const id = "notes"
				s0InstallPrebuilt(t, pm, id, exe, tc.protocol)
				started := time.Now()
				_, err := pm.LoadPlugin(id, nil)
				took := time.Since(started)
				t.Logf("load took %s", took.Round(time.Millisecond))
				if !tc.refused {
					require.NoError(t, err)
					assert.Equal(t, 1, pm.records[id].Backend.NegotiatedVersion())
					assert.Empty(t, toldUnloaded(t, recorder.getEvents()))
					return
				}
				require.Error(t, err)
				assert.Less(t, took, 10*time.Second, "it is refused at the handshake, not by a deadline")
				// go-plugin's own sentence is what the record and the error carry...
				want := "incompatible API version with plugin. Plugin version: " + strconv.Itoa(tc.protocol) + ", Client versions: [1]"
				assert.Contains(t, err.Error(), want)
				info, getErr := pm.GetPlugin(id)
				require.NoError(t, getErr)
				assert.Equal(t, "Failed", info.Phase)
				assert.Equal(t, want, info.LastError)
				// ...and the window is told "failed": the same word as for a plugin that crashed on start. Nothing says why, or that it is a version.
				assert.Equal(t, UnloadFailed, loadFailureCause(err))
				assert.Equal(t, toldOf(id, "failed"), toldUnloaded(t, recorder.getEvents()))
			})
		}
	}
}
