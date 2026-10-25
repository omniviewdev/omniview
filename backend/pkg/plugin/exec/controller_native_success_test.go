//go:build darwin || linux

// The native fixture requires a POSIX shell and PTY; it does not prove Windows exec.

package exec

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	osexec "os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/interceptors"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/v1/resource"
)

// This exercises the non-local consumer: native connection discovery -> SDK
// resource controller -> real gRPC -> host GetConnection admission -> exec gRPC
// -> real SDK manager/PTY -> native file IO. No provider forwards a canned result.
func TestRegisteredExecConsumesNativeConnectionAndCleansUpSession(t *testing.T) {
	const pluginID = "native-exec-proof"
	const resourceKey = "cloud::v1::Machine"
	logger := logging.NewNop()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	state := appstate.NewTestService(t)
	root := t.TempDir()
	connections := []sdktypes.Connection{
		{ID: "account/a::opaque", Name: "first", Data: map[string]any{"directory": filepath.Join(root, "first")}},
		{ID: "account/b::opaque", Name: "second", Data: map[string]any{"directory": filepath.Join(root, "second")}},
	}
	payloads := []string{"native-file:first/account\n", "native-file:second/account\n"}
	for i, connection := range connections {
		directory := connection.Data["directory"].(string)
		require.NoError(t, os.Mkdir(directory, 0700))
		require.NoError(t, os.WriteFile(filepath.Join(directory, "payload.txt"), []byte(payloads[i]), 0600))
	}
	manifest, err := json.Marshal(connections)
	require.NoError(t, err)
	manifestPath := filepath.Join(root, "connections.json")
	require.NoError(t, os.WriteFile(manifestPath, manifest, 0600))
	resourceProvider, err := sdkresource.BuildResourceController(ctx, sdkresource.ResourcePluginConfig[string]{
		Logger: logger,
		Connections: &resourcetest.StubConnectionProvider[string]{
			LoadConnectionsFunc: func(context.Context) ([]sdktypes.Connection, error) {
				data, readErr := os.ReadFile(manifestPath)
				if readErr != nil {
					return nil, readErr
				}
				var discovered []sdktypes.Connection
				if decodeErr := json.Unmarshal(data, &discovered); decodeErr != nil {
					return nil, decodeErr
				}
				return discovered, nil
			},
		},
		Resources: []sdkresource.ResourceRegistration[string]{{
			Meta:      sdkresource.ResourceMeta{Group: "cloud", Version: "v1", Kind: "Machine"},
			Resourcer: &resourcetest.StubResourcer[string]{},
		}},
	})
	require.NoError(t, err)
	t.Cleanup(resourceProvider.Close)

	type nativeProcess struct {
		command *osexec.Cmd
		done    <-chan error
	}
	processes := make(chan nativeProcess, len(connections))
	terminals := make(chan sdkexec.Terminal, len(connections))
	realTerminal := sdkexec.NewRealTerminalFactory()
	handler := sdkexec.Handler{
		Plugin: pluginID, Resource: resourceKey,
		TTYHandler: func(pctx *sdktypes.PluginContext, _ sdkexec.SessionOptions, tty *os.File, stop chan error, _ <-chan sdkexec.SessionResizeInput) error {
			if pctx == nil || pctx.Connection == nil {
				return fmt.Errorf("native exec requires a selected connection")
			}
			directory, ok := pctx.Connection.Data["directory"].(string)
			if !ok || directory == "" {
				return fmt.Errorf("native connection has no directory")
			}
			// Only shell builtins are used. IO depends on the actual directory
			// obtained through registered resource discovery and the host lookup.
			command := osexec.CommandContext(pctx.Context, "/bin/sh", "-c", `IFS= read -r request || exit 1
IFS= read -r payload < payload.txt || exit 2
printf '%s' "$request" > applied.txt || exit 3
printf '%s\nrequest:%s\n' "$payload" "$request"
while IFS= read -r ignored; do :; done`)
			command.Dir = directory
			command.Stdin, command.Stdout, command.Stderr = tty, tty, tty
			if startErr := command.Start(); startErr != nil {
				return startErr
			}
			done := make(chan error, 1)
			processes <- nativeProcess{command: command, done: done}
			go func() {
				done <- command.Wait()
				select {
				case stop <- nil:
				default:
				}
			}()
			return nil
		},
	}
	manager := sdkexec.NewManager(sdkexec.ManagerConfig{
		Logger:   logger,
		Handlers: map[string]sdkexec.Handler{handler.ID(): handler},
		TerminalFactory: func() (sdkexec.Terminal, error) {
			terminal, factoryErr := realTerminal()
			if factoryErr == nil {
				terminals <- terminal
			}
			return terminal, factoryErr
		},
	})
	t.Cleanup(manager.Close)

	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer(grpc.UnaryInterceptor(interceptors.UnaryPluginContext()), grpc.StreamInterceptor(interceptors.StreamPluginContext()))
	resourcepb.RegisterResourcePluginServer(server, resourceplugin.NewServer(resourceProvider, nil))
	execPlugin := &sdkexec.Plugin{Impl: manager}
	require.NoError(t, execPlugin.GRPCServer(nil, server))
	go func() { _ = server.Serve(listener) }()
	//nolint:staticcheck // Match the existing host bufconn integration convention.
	connection, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(sdk.ClientPluginContextInterceptor(logger)),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })
	execClient, err := execPlugin.GRPCClient(ctx, nil, connection)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{
		"resource": resourceplugin.NewClient(resourcepb.NewResourcePluginClient(connection)),
		"exec":     execClient,
	})
	resources := hostresource.NewController(logger, nil, state.PluginStore, invocation.NewBoundary(nil))
	resources.Run(ctx)
	resourceShutdown := resources.(interface{ ServiceShutdown() error })
	t.Cleanup(func() {
		_ = resources.OnPluginStop(pluginID, config.PluginMeta{})
		_ = resourceShutdown.ServiceShutdown()
	})
	resources.OnPluginInit(pluginID, config.PluginMeta{})
	require.NoError(t, resources.OnPluginStart(pluginID, config.PluginMeta{}, backend))

	ctrl := NewController(logger, nil, resources).(*controller)
	ctrl.ctx = ctx // No local terminal manager/UI runtime is needed for plugin exec.
	ctrl.outputMux = make(chan sdkexec.StreamOutput, 16)
	ctrl.OnPluginInit(pluginID, config.PluginMeta{})
	require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{}, backend))
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{}) })
	require.NotNil(t, ctrl.GetHandler(pluginID, resourceKey))

	for i, selected := range connections {
		t.Run(selected.Name, func(t *testing.T) {
			session, createErr := ctrl.CreateSession(pluginID, selected.ID, sdkexec.SessionOptions{ResourcePlugin: pluginID, ResourceKey: resourceKey, Command: []string{"native-file-apply"}})
			require.NoError(t, createErr)
			setupCtx, setupCancel := context.WithTimeout(ctx, 5*time.Second)
			defer setupCancel()
			var process nativeProcess
			select {
			case process = <-processes:
			case <-setupCtx.Done():
				t.Fatal("native process was not published before setup deadline")
			}
			var terminal sdkexec.Terminal
			select {
			case terminal = <-terminals:
			case <-setupCtx.Done():
				t.Fatal("native terminal was not published before setup deadline")
			}
			attached, replay, attachErr := ctrl.AttachSession(session.ID)
			require.NoError(t, attachErr)
			require.True(t, attached.Attached)
			require.Empty(t, replay)
			require.NoError(t, ctrl.WriteSession(session.ID, []byte("apply-17\n")))
			var output []byte
			expected := []byte(payloads[i] + "request:apply-17\n")
			deadline := time.After(5 * time.Second)
			for !bytes.Contains(output, expected) {
				select {
				case event := <-ctrl.outputMux:
					require.Equal(t, session.ID, event.SessionID)
					require.Equal(t, sdkexec.StreamSignalNone, event.Signal)
					output = append(output, event.Data...)
				case <-deadline:
					t.Fatalf("native process output missing: got %q want %q", output, expected)
				}
			}
			require.Equal(t, expected, output)
			applied, readErr := os.ReadFile(filepath.Join(selected.Data["directory"].(string), "applied.txt"))
			require.NoError(t, readErr)
			require.Equal(t, "apply-17", string(applied))
			detached, detachErr := ctrl.DetachSession(session.ID)
			require.NoError(t, detachErr)
			require.False(t, detached.Attached)
			_, replay, attachErr = ctrl.AttachSession(session.ID)
			require.NoError(t, attachErr)
			require.Equal(t, expected, replay)
			require.NoError(t, ctrl.CloseSession(session.ID))
			select {
			case <-process.done:
				require.NotNil(t, process.command.ProcessState, "native process must be reaped")
			case <-time.After(5 * time.Second):
				t.Fatal("native process survived session close")
			}
			_, statErr := terminal.MasterFd().Stat()
			require.ErrorIs(t, statErr, os.ErrClosed)
			_, statErr = terminal.SlaveFd().Stat()
			require.ErrorIs(t, statErr, os.ErrClosed)
			select {
			case event := <-ctrl.outputMux:
				require.Equal(t, session.ID, event.SessionID)
				require.Equal(t, sdkexec.StreamSignalClose, event.Signal)
			case <-time.After(5 * time.Second):
				t.Fatal("host did not receive SDK session close")
			}
			active, listErr := manager.ListSessions(nil)
			require.NoError(t, listErr)
			require.Empty(t, active)
		})
	}
	require.NoError(t, ctrl.OnPluginStop(pluginID, config.PluginMeta{}))
	require.False(t, ctrl.HasPlugin(pluginID))
	require.Empty(t, ctrl.GetPluginHandlers(pluginID))
	ctrl.mu.RLock()
	indexCount, inputCount := len(ctrl.sessionIndex), len(ctrl.inChans)
	ctrl.mu.RUnlock()
	require.Zero(t, indexCount)
	require.Zero(t, inputCount)
	_, err = ctrl.CreateSession(pluginID, connections[0].ID, sdkexec.SessionOptions{ResourcePlugin: pluginID, ResourceKey: resourceKey})
	var appError *apperror.AppError
	require.ErrorAs(t, err, &appError)
	require.Equal(t, apperror.TypePluginNotFound, appError.Type)
}
