package types

import (
	"context"
	"net"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"

	goplugin "github.com/hashicorp/go-plugin"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

func TestExternalBackendOwnsSnapshotCleanupUntilStopped(t *testing.T) {
	// No process is started: this exercises the actual go-plugin no-runner
	// lifecycle and idempotent cleanup without launching an app/plugin fixture.
	client := goplugin.NewClient(&goplugin.ClientConfig{})
	backend := NewExternalBackend(client, nil)
	calls := 0
	backend.SetProcessCleanup(func() { calls++ })
	if calls != 0 {
		t.Fatal("cleanup ran before backend was stopped")
	}
	backend.Kill()
	backend.Kill()
	if calls != 1 {
		t.Fatalf("cleanup called %d times, want once", calls)
	}
}

func TestExternalBackendDiagnosticFailureDoesNotFailConstructionOrCleanUp(t *testing.T) {
	backend := NewExternalBackend(goplugin.NewClient(&goplugin.ClientConfig{}), nil)
	calls := 0
	backend.SetProcessCleanup(func() { calls++ })
	identity, err := backend.ProcessObservation()
	if err == nil || identity.PID != 0 {
		t.Fatalf("unstarted backend returned identity %+v, error %v", identity, err)
	}
	backend.ProcessExited()
	if calls != 0 {
		t.Fatal("diagnostic liveness check invoked lifecycle cleanup")
	}
}

func TestExternalBackendObservationReturnsImmutableCopy(t *testing.T) {
	want := devsession.ProcessObservation{PID: 123, StartIdentity: "launch-start", Executable: "/plugin"}
	backend := &ExternalBackend{observation: want}
	first, err := backend.ProcessObservation()
	if err != nil {
		t.Fatal(err)
	}
	first.StartIdentity = "replacement-start"
	second, err := backend.ProcessObservation()
	if err != nil || second != want {
		t.Fatalf("launch observation changed: %+v, error %v", second, err)
	}
}

func TestExternalLegacyProbingDiscoversOnlyRegisteredSettings(t *testing.T) {
	for _, registered := range []bool{false, true} {
		name := "without-settings"
		if registered {
			name = "registered-settings"
		}
		t.Run(name, func(t *testing.T) {
			listener := bufconn.Listen(1 << 20)
			server := grpc.NewServer()
			if registered {
				transport := &sdksettings.SettingsPlugin{Impl: sdksettings.NewProviderWrapper(pkgsettings.NewProvider(pkgsettings.ProviderOpts{}))}
				require.NoError(t, transport.GRPCServer(nil, server))
			}
			go func() { _ = server.Serve(listener) }()
			t.Cleanup(func() { server.Stop(); _ = listener.Close() })
			connection, err := grpc.NewClient("passthrough:///legacy-plugin",
				grpc.WithTransportCredentials(insecure.NewCredentials()),
				grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
					return listener.DialContext(ctx)
				}),
			)
			require.NoError(t, err)
			t.Cleanup(func() { _ = connection.Close() })
			backend := &ExternalBackend{rpcClient: &goplugin.GRPCClient{Conn: connection}}
			capabilities, err := backend.detectViaProbing()
			require.NoError(t, err)
			if registered {
				require.Contains(t, capabilities, "settings")
			} else {
				require.NotContains(t, capabilities, "settings")
			}
		})
	}
}
