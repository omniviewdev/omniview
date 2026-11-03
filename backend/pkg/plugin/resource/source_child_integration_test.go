package resource

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func compileSourceChild(t *testing.T) string {
	t.Helper()
	sdkRoot := os.Getenv("SDK_SOURCE")
	if sdkRoot == "" {
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, module := range info.Deps {
				if module.Path == "github.com/omniviewdev/plugin-sdk" && module.Replace != nil && filepath.IsAbs(module.Replace.Path) {
					sdkRoot = module.Replace.Path
					break
				}
			}
		}
	}
	if sdkRoot == "" {
		_, source, _, ok := runtime.Caller(0)
		require.True(t, ok)
		root := filepath.Clean(filepath.Join(filepath.Dir(source), "../../../.."))
		args := []string{"list", "-m", "-f", "{{if .Replace}}{{.Replace.Dir}}{{else}}{{.Dir}}{{end}}", "github.com/omniviewdev/plugin-sdk"}
		command := exec.Command("go", args...)
		command.Dir = root
		command.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=")
		output, err := command.CombinedOutput()
		require.NoError(t, err, "resolve SDK module: %s", output)
		sdkRoot = strings.TrimSpace(string(output))
	}
	require.NotEmpty(t, sdkRoot)
	binary := filepath.Join(t.TempDir(), "source-session-fixture")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	command := exec.Command("go", "test", "-c", "-o", binary, "./internal/resourceconformance")
	command.Dir = sdkRoot
	command.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=")
	output, err := command.CombinedOutput()
	require.NoError(t, err, "compile SDK source fixture: %s", output)
	return binary
}

// waitSourceView observes the emitted protocol rather than the coordinator's internals.
func waitSourceView(t *testing.T, emitter *recordingEmitter, topic string, predicate func(HostSourceViewEvent) bool) HostSourceViewEvent {
	t.Helper()
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	seen := 0
	for {
		emitter.mu.Lock()
		for ; seen < len(emitter.events); seen++ {
			event := emitter.events[seen]
			if event.Key == topic && len(event.Data) == 1 {
				if view, ok := event.Data[0].(HostSourceViewEvent); ok && predicate(view) {
					emitter.mu.Unlock()
					return view
				}
			}
		}
		changed := emitter.changed
		emitter.mu.Unlock()
		select {
		case <-changed:
		case <-timer.C:
			t.Fatalf("timed out waiting for source view event on %s", topic)
			return HostSourceViewEvent{}
		}
	}
}

func TestSourceChildRealSDKView(t *testing.T) {
	binary := compileSourceChild(t)
	for _, tc := range []struct {
		name, profile, connection, mode, state string
		count                                  string
	}{
		{"empty", "source-sessions-empty", "cloud-absent-schema", resourcev2.SourceModeSnapshot, "finished", "0"},
		{"paginated cloud", "source-sessions", "cloud-bundled-pages", resourcev2.SourceModeSnapshot, "finished", "3"},
		{"hypervisor", "source-sessions", "hypervisor-bundled-vms", resourcev2.SourceModeSnapshot, "finished", "2"},
		{"container", "source-sessions", "container-bundled-events", resourcev2.SourceModeSnapshotAndUpdates, "following", "2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider, receipts, stop := startNativeChild(t, binary, tc.profile)
			defer stop()
			ctrl, emitter := newTestControllerWithEmitter(t)
			registerMockPlugin(ctrl, nativeChildPluginID, provider)
			ctx := testInvocationContext()
			_, err := ctrl.StartConnection(ctx, nativeChildPluginID, tc.connection)
			require.NoError(t, err)
			route := resourcev2.AccessRoute{Connection: tc.connection}
			catalog, err := ctrl.Catalog(ctx, nativeChildPluginID, resourcev2.CatalogRequest{Route: route})
			require.NoError(t, err)
			require.Len(t, catalog.Types, 1)
			desc := catalog.Types[0]
			var scope resourcev2.QueryScope
			for _, capability := range desc.Capabilities {
				if capability.Operation == resourcev2.OperationEnumerate {
					scope = capability.Scope
					break
				}
			}
			resolved, err := ctrl.ResolveTarget(ctx, nativeChildPluginID, ResolveTargetRequest{Route: route, Type: desc.Type, Representation: "native", Scope: scope})
			require.NoError(t, err)
			opened, err := ctrl.OpenSourceView(ctx, nativeChildPluginID, HostSourceViewRequest{TargetID: resolved.TargetID, Target: resolved.Target, Updates: "ifSupported"})
			require.NoError(t, err)
			require.Equal(t, tc.mode, opened.Mode)
			require.NoError(t, ctrl.SyncSourceView(ctx, nativeChildPluginID, opened.ViewID))
			end := waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool {
				return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == tc.state
			})
			require.Equal(t, "exact", end.Status.Count.Kind)
			require.NotNil(t, end.Status.Count.Value)
			require.Equal(t, tc.count, *end.Status.Count.Value)
			if tc.name == "container" {
				waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool {
					for _, record := range append(event.Records, event.Upserts...) {
						if record.Record.Body.Map["state"].String == "paused" {
							return true
						}
					}
					return false
				})
			}
			require.NoError(t, ctrl.CloseSourceView(ctx, nativeChildPluginID, opened.ViewID))
			if tc.name == "container" {
				require.Eventually(t, func() bool {
					_, err := os.Stat(filepath.Join(receipts, tc.connection+".source-cancelled"))
					return err == nil
				}, 5*time.Second, 10*time.Millisecond)
			}
			_, err = ctrl.StopConnection(ctx, nativeChildPluginID, tc.connection)
			require.NoError(t, err)
		})
	}
}
