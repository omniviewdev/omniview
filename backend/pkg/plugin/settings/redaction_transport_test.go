package settings

import (
	"context"
	"encoding/json"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"

	logging "github.com/omniviewdev/plugin-sdk/log"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	settingspb "github.com/omniviewdev/plugin-sdk/proto/v1/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Keep the real SDK server, protobuf serialization, SDK client and hydration.
// Only downgrade two wire records to reproduce old/misclassified plugin
// messages; cached Setting structs are never fabricated by this test.
type classificationWireServer struct {
	*sdksettings.SettingsPluginServer
}

func (s classificationWireServer) ListSettings(ctx context.Context, request *emptypb.Empty) (*settingspb.ListSettingsResponse, error) {
	response, err := s.SettingsPluginServer.ListSettings(ctx, request)
	if err != nil {
		return nil, err
	}
	response.Settings["legacy"].Sensitive = nil
	public := false
	response.Settings["password"].Sensitive = &public
	return response, nil
}

func TestSnapshot_ActualV1RPCPreservesClassificationAndFailsClosedForLegacy(t *testing.T) {
	provider := newMockProvider(map[string]pkgsettings.Setting{
		"public": {ID: "public", Type: pkgsettings.Text, Value: "visible", Default: "public-default"},
		"secret": {
			ID: "secret", Type: pkgsettings.Text, Sensitive: true,
			Value: "rpc-secret-value", Default: "rpc-secret-default",
			Options:       []pkgsettings.SettingOption{{Value: "rpc-secret-option"}},
			FileSelection: &pkgsettings.SettingFileSelection{DefaultPath: "rpc-secret-path"},
		},
		"legacy": {
			ID: "legacy", Type: pkgsettings.Text, Value: "rpc-legacy-value", Default: "rpc-legacy-default",
			Options:       []pkgsettings.SettingOption{{Value: "rpc-legacy-option"}},
			FileSelection: &pkgsettings.SettingFileSelection{DefaultPath: "rpc-legacy-path"},
		},
		"password": {
			ID: "password", Type: pkgsettings.Password, Sensitive: false,
			Value: "rpc-password-value", Default: "rpc-password-default",
			Options:       []pkgsettings.SettingOption{{Value: "rpc-password-option"}},
			FileSelection: &pkgsettings.SettingFileSelection{DefaultPath: "rpc-password-path"},
		},
	})
	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer()
	settingspb.RegisterSettingsPluginServer(server, classificationWireServer{
		SettingsPluginServer: &sdksettings.SettingsPluginServer{Impl: provider},
	})
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		_ = listener.Close()
	})
	connection, err := grpc.NewClient("passthrough:///settings-fixture",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = connection.Close() })
	plugin := &sdksettings.SettingsPlugin{}
	rawClient, err := plugin.GRPCClient(context.Background(), nil, connection)
	require.NoError(t, err)
	client, ok := rawClient.(sdksettings.Provider)
	require.True(t, ok, "settings transport must implement the SDK provider")

	store := openTestStore(t)
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok, "settings controller must expose its concrete implementation")
	ctrl.clients["fixture"] = client
	ctrl.hydratePlugin(context.Background(), "fixture", client, ctrl.logger)
	require.True(t, ctrl.hydrated["fixture"])
	snapshot, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	safe := snapshot.Settings
	assert.Equal(t, "visible", safe["public"].Value)
	assert.Equal(t, "public-default", safe["public"].Default)
	assert.False(t, safe["public"].Sensitive)
	encoded, err := json.Marshal(safe)
	require.NoError(t, err)
	for _, key := range []string{"secret", "legacy", "password"} {
		assert.Equal(t, "[REDACTED]", safe[key].Value)
		assert.True(t, safe[key].Sensitive)
		assert.Nil(t, safe[key].Options)
		assert.Nil(t, safe[key].FileSelection)
		for _, suffix := range []string{"value", "default", "option", "path"} {
			assert.NotContains(t, string(encoded), "rpc-"+key+"-"+suffix)
		}
	}

	// The provider and isolated persistence still hold the real values; only
	// control inspection output is redacted, not the underlying settings.
	persisted, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, "rpc-secret-value", persisted["secret"])
	assert.Equal(t, "rpc-legacy-value", persisted["legacy"])
}
