package logs

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkutils "github.com/omniviewdev/plugin-sdk/pkg/utils"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	logspb "github.com/omniviewdev/plugin-sdk/proto/v1/logs"
)

// This provider exposes a private, real file directory. The selected connection
// supplies the only directory the log resolver/handler may open; request data
// deliberately contains a different directory so a metadata echo cannot pass.
// No frontend, application singleton, production credentials or fake RPC is used.
type nativeLogFileStore struct {
	connection sdktypes.Connection
}

func (s *nativeLogFileStore) LoadConnections(ctx context.Context) ([]sdktypes.Connection, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, ok := s.connection.Data["logRoot"].(string)
	if !ok {
		return nil, errors.New("native log directory is missing")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("native log source is not a directory")
	}
	return []sdktypes.Connection{s.connection}, nil
}

func (*nativeLogFileStore) CreateClient(_ context.Context, connection sdktypes.Connection) (*os.Root, error) {
	root, ok := connection.Data["logRoot"].(string)
	if !ok {
		return nil, errors.New("native file connection directory is missing")
	}
	return os.OpenRoot(root)
}

func (*nativeLogFileStore) DestroyClient(_ context.Context, root *os.Root) error {
	return root.Close()
}

func (*nativeLogFileStore) CheckConnection(_ context.Context, connection sdktypes.Connection, root *os.Root) (sdktypes.ConnectionStatus, error) {
	if _, err := root.Stat("."); err != nil {
		return sdktypes.ConnectionStatus{}, err
	}
	return sdktypes.ConnectionStatus{Connection: &connection, Status: sdktypes.ConnectionStatusConnected}, nil
}

func nativeLogRepresentation() sdkresource.Representation {
	return sdkresource.Representation{ID: "native", Revision: "native:1", Schema: sdkresource.SchemaBinding{State: "absent", Validation: "none"}}
}

func nativeLogRecord(target sdkresource.ReadTarget, name string, body sdkresource.Value) sdkresource.Record {
	return sdkresource.Record{
		Reference: sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: name, Scope: []sdkresource.ScopeEntry{}}},
		Body:      body, Representation: nativeLogRepresentation(), Coverage: sdkresource.Coverage{Kind: "complete"},
	}
}

func (*nativeLogFileStore) Get(ctx context.Context, root *os.Root, input sdkresource.GetRequest) (sdkresource.Record, error) {
	if err := ctx.Err(); err != nil {
		return sdkresource.Record{}, err
	}
	body, err := root.ReadFile(input.Reference.Address.ID)
	if err != nil {
		return sdkresource.Record{}, err
	}
	address := input.Reference.Address
	record := nativeLogRecord(sdkresource.ReadTarget{Provider: address.Provider, Authority: address.Authority, Type: address.Type}, address.ID, sdkresource.Value{Kind: "map", Map: map[string]sdkresource.Value{
		"name": {Kind: "string", String: address.ID}, "content": {Kind: "string", String: string(body)},
	}})
	return record, nil
}

func (*nativeLogFileStore) Enumerate(ctx context.Context, root *os.Root, input sdkresource.EnumerateRequest) (sdkresource.SourcePage, error) {
	if err := ctx.Err(); err != nil {
		return sdkresource.SourcePage{}, err
	}
	directory, err := root.Open(".")
	if err != nil {
		return sdkresource.SourcePage{}, err
	}
	defer directory.Close()
	entries, err := directory.ReadDir(-1)
	if err != nil {
		return sdkresource.SourcePage{}, err
	}
	records := make([]sdkresource.Record, 0, len(entries))
	for _, entry := range entries {
		if entry.Type().IsRegular() {
			records = append(records, nativeLogRecord(input.Target, entry.Name(), sdkresource.Value{Kind: "map", Map: map[string]sdkresource.Value{"name": {Kind: "string", String: entry.Name()}}}))
		}
	}
	count := strconv.Itoa(len(records))
	return sdkresource.SourcePage{Records: records, Count: sdkresource.Count{Kind: "exact", Value: &count}, Coverage: sdkresource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
}

// Follow a bounded real file until its SDK source context is cancelled. Close
// observes the actual file descriptor release, not a simulated session flag.
type nativeFollowingLogFile struct {
	file     *os.File
	ctx      context.Context
	closed   chan struct{}
	once     sync.Once
	closeErr error
}

func (f *nativeFollowingLogFile) Read(buffer []byte) (int, error) {
	n, err := f.file.Read(buffer)
	if errors.Is(err, io.EOF) {
		<-f.ctx.Done()
		return n, f.ctx.Err()
	}
	return n, err
}

func (f *nativeFollowingLogFile) Close() error {
	f.once.Do(func() {
		f.closeErr = f.file.Close()
		close(f.closed)
	})
	return f.closeErr
}

func TestNativeLogSessionConsumesRegisteredConnectionAndClosesFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
	defer cancel()
	const pluginID = "native-logs-success"
	const connectionID = "private-file-store"
	const fileName = "native.log"
	root := t.TempDir()
	decoy := t.TempDir()
	wantLines := []string{"native first line — 雪", "native second line — café"}
	require.NoError(t, os.WriteFile(filepath.Join(root, fileName), []byte(wantLines[0]+"\n"+wantLines[1]+"\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(decoy, fileName), []byte("wrong connection: must not be read\n"), 0600))
	store := &nativeLogFileStore{connection: sdktypes.Connection{ID: connectionID, Name: "Private native log directory", Data: map[string]interface{}{"logRoot": root}}}
	resourceManager, err := sdkresource.NewController(sdkresource.Config[os.Root]{
		Catalog: func(context.Context, sdkresource.CatalogRequest) (sdkresource.Catalog, error) {
			return sdkresource.Catalog{Provider: pluginID, Revision: "native:1", Coverage: sdkresource.Coverage{Kind: "complete"}, Types: []sdkresource.ResourceType{{
				Type: "native-log-file", DisplayName: "Native log file", Representations: []sdkresource.Representation{nativeLogRepresentation()},
				Capabilities: []sdkresource.Capability{{Operation: sdkresource.OperationGet}, {Operation: sdkresource.OperationEnumerate}},
			}}}, nil
		},
		Lifecycle:     &sdkresource.Lifecycle[os.Root]{LoadConnections: store.LoadConnections, CreateClient: store.CreateClient, DestroyClient: store.DestroyClient, CheckConnection: store.CheckConnection},
		Registrations: []sdkresource.Registration[os.Root]{{Type: "native-log-file", Get: store.Get, Enumerate: store.Enumerate}},
	})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, resourceManager.Close()) })

	opened := make(chan *nativeFollowingLogFile, 1)
	allowRead := make(chan struct{})
	logManager := sdklogs.NewManager(sdklogs.ManagerConfig{
		Logger: logging.NewNop(),
		Handlers: map[string]sdklogs.Handler{
			pluginID + "/native-log-file": {
				Plugin:   pluginID,
				Resource: "native-log-file",
				Handler: func(pctx *sdktypes.PluginContext, req sdklogs.LogStreamRequest) (io.ReadCloser, error) {
					if pctx.Connection == nil {
						return nil, errors.New("log handler did not receive the registered connection")
					}
					connectionRoot, ok := pctx.Connection.Data["logRoot"].(string)
					if !ok {
						return nil, errors.New("log handler connection directory is missing")
					}
					directory, openErr := os.OpenRoot(connectionRoot)
					if openErr != nil {
						return nil, openErr
					}
					defer directory.Close()
					file, openErr := directory.Open(req.SourceID)
					if openErr != nil {
						return nil, openErr
					}
					reader := &nativeFollowingLogFile{file: file, ctx: pctx.Context, closed: make(chan struct{})}
					select {
					case opened <- reader:
					case <-pctx.Context.Done():
						_ = reader.Close()
						return nil, pctx.Context.Err()
					}
					select {
					case <-allowRead:
						return reader, nil
					case <-pctx.Context.Done():
						_ = reader.Close()
						return nil, pctx.Context.Err()
					}
				},
			},
		},
		Resolvers: map[string]sdklogs.SourceResolver{
			"native-log-group": func(pctx *sdktypes.PluginContext, data *sdkresource.Value, _ sdklogs.SourceResolverOptions) (*sdklogs.SourceResolverResult, error) {
				if pctx.Connection == nil {
					return nil, errors.New("log resolver did not receive the registered connection")
				}
				connectionRoot, ok := pctx.Connection.Data["logRoot"].(string)
				if !ok {
					return nil, errors.New("log resolver connection directory is missing")
				}
				if data == nil || data.Kind != "map" {
					return nil, errors.New("native log file body is missing")
				}
				name := data.Map["name"]
				if name.Kind != "string" {
					return nil, errors.New("native log file name is missing")
				}
				directory, openErr := os.OpenRoot(connectionRoot)
				if openErr != nil {
					return nil, openErr
				}
				defer directory.Close()
				info, statErr := directory.Stat(name.String)
				if statErr != nil {
					return nil, statErr
				}
				return &sdklogs.SourceResolverResult{Sources: []sdklogs.LogSource{{ID: info.Name(), Labels: map[string]string{"file": info.Name()}}}}, nil
			},
		},
	})
	logManager.BindConnectionContextProvider(resourceManager)
	t.Cleanup(logManager.Close)

	streamStopped := make(chan struct{})
	server := grpc.NewServer(sdkutils.RegisterServerOpts([]grpc.ServerOption{grpc.StreamInterceptor(func(service interface{}, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		err := handler(service, stream)
		if info.FullMethod == logspb.LogPlugin_Stream_FullMethodName {
			close(streamStopped)
		}
		return err
	})}, logging.NewNop())...)
	resourceplugin.RegisterServer(server, resourceManager)
	logPlugin := &sdklogs.Plugin{Impl: logManager}
	require.NoError(t, logPlugin.GRPCServer(nil, server))
	listener := bufconn.Listen(1024 * 1024)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop(); _ = listener.Close() })
	transport, err := grpc.DialContext(ctx, "passthrough:///native-logs-success",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop()), func(ctx context.Context, method string, request, response interface{}, conn *grpc.ClientConn, invoker grpc.UnaryInvoker, options ...grpc.CallOption) error {
			callCtx, stop := context.WithTimeout(ctx, 3*time.Second)
			defer stop()
			return invoker(callCtx, method, request, response, conn, options...)
		}),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close() })
	logClient, err := logPlugin.GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{
		"resource": resourceplugin.NewClient(transport),
		"log":      logClient,
	})
	state := appstate.NewTestService(t)
	resources := hostresource.NewController(logging.NewNop(), nil, state.PluginStore, invocation.NewBoundary(nil))
	resources.Run(ctx)
	t.Cleanup(func() {
		_ = resources.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID})
		_ = resources.(interface{ ServiceShutdown() error }).ServiceShutdown()
	})
	resources.OnPluginInit(pluginID, config.PluginMeta{ID: pluginID})
	require.NoError(t, resources.OnPluginStart(pluginID, config.PluginMeta{ID: pluginID}, backend))
	nativeCtx := invocation.HostContext(ctx)
	_, err = resources.StartConnection(nativeCtx, pluginID, connectionID)
	require.NoError(t, err)
	target, err := resources.ResolveTarget(nativeCtx, pluginID, hostresource.ResolveTargetRequest{Route: sdkresource.AccessRoute{Connection: connectionID}, Type: "native-log-file", Representation: "native"})
	require.NoError(t, err)
	listing, err := resources.Enumerate(nativeCtx, pluginID, hostresource.HostEnumerateRequest{TargetID: target.TargetID, Request: sdkresource.EnumerateRequest{Target: target.Target}})
	require.NoError(t, err)
	require.Len(t, listing.Records, 1)
	fileData := &sdkresource.Value{Kind: "map", Map: map[string]sdkresource.Value{
		"name": {Kind: "string", String: listing.Records[0].Record.Body.Map["name"].String},
		// This request-side decoy must not override the registered connection.
		"logRoot": {Kind: "string", String: decoy},
	}}
	ctrl := NewController(logging.NewNop(), nil, resources).(*controller)
	ctrl.ctx = ctx // Native controller lifetime; deliberately no Wails singleton.
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID}) })
	require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{ID: pluginID}, backend))
	session, err := ctrl.CreateSession(pluginID, connectionID, sdklogs.CreateSessionOptions{
		ResourceKey: "native-log-group", ResourceID: fileName, ResourceData: fileData,
		Options: sdklogs.LogSessionOptions{Follow: true, IncludeSourceEvents: true},
	})
	require.NoError(t, err)
	require.NotEmpty(t, session.ID)
	require.Equal(t, pluginID, session.PluginID)
	require.Equal(t, connectionID, session.ConnectionID)
	var reader *nativeFollowingLogFile
	select {
	case reader = <-opened:
	case <-ctx.Done():
		t.Fatal("native log file was not opened: ", ctx.Err())
	}

	// Actual pause/resume commands plus read-back acknowledge that the real
	// bidirectional gRPC stream and SDK command consumer are established before
	// releasing file IO. No sleeps or synthetic stream-ready callback are used.
	for _, command := range []struct {
		command sdklogs.LogStreamCommand
		status  sdklogs.LogSessionStatus
	}{
		{sdklogs.StreamCommandPause, sdklogs.LogSessionStatusPaused},
		{sdklogs.StreamCommandResume, sdklogs.LogSessionStatusActive},
	} {
		require.NoError(t, ctrl.SendCommand(session.ID, command.command))
		require.Eventually(t, func() bool {
			current, getErr := ctrl.GetSession(session.ID)
			return getErr == nil && current.Status == command.status
		}, 3*time.Second, 5*time.Millisecond)
	}
	close(allowRead)
	var received []sdklogs.LogLine
	ready := false
	for len(received) < len(wantLines) || !ready {
		select {
		case output := <-ctrl.outputMux:
			require.Equal(t, session.ID, output.SessionID)
			if output.Line != nil {
				received = append(received, *output.Line)
			}
			if output.Event != nil {
				require.NotEqual(t, sdklogs.StreamEventStreamError, output.Event.Type, output.Event.Message)
				ready = ready || output.Event.Type == sdklogs.StreamEventSessionReady
			}
		case <-ctx.Done():
			t.Fatal("native log frames did not reach the host consumer: ", ctx.Err())
		}
	}
	require.Len(t, received, len(wantLines))
	for index, line := range received {
		require.Equal(t, wantLines[index], line.Content)
		require.Equal(t, session.ID, line.SessionID)
		require.Equal(t, fileName, line.SourceID)
		require.Equal(t, fileName, line.Labels["file"])
	}
	require.NoError(t, ctrl.CloseSession(session.ID))
	select {
	case <-reader.closed:
	case <-ctx.Done():
		t.Fatal("session close did not release the native file: ", ctx.Err())
	}
	require.ErrorIs(t, reader.ctx.Err(), context.Canceled)
	_, err = reader.file.Stat()
	require.ErrorIs(t, err, os.ErrClosed)
	sessions, err := ctrl.ListSessions()
	require.NoError(t, err)
	require.Empty(t, sessions)
	_, err = ctrl.GetSession(session.ID)
	require.Error(t, err)
	_, err = resources.StopConnection(nativeCtx, pluginID, connectionID)
	require.NoError(t, err)
	require.NoError(t, ctrl.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID}))
	select {
	case <-streamStopped:
	case <-ctx.Done():
		t.Fatal("real logs gRPC stream survived plugin stop: ", ctx.Err())
	}
	require.False(t, ctrl.HasPlugin(pluginID))
	require.Empty(t, ctrl.GetSupportedResources(pluginID))
}
