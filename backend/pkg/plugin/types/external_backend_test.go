package types

import (
	"context"
	"net"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"

	goplugin "github.com/hashicorp/go-plugin"
	settingspb "github.com/omniviewdev/plugin-sdk/proto/v1/settings"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
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

type probingSettingsServer struct {
	settingspb.UnimplementedSettingsPluginServer
}

func (*probingSettingsServer) ListSettings(context.Context, *emptypb.Empty) (*settingspb.ListSettingsResponse, error) {
	return &settingspb.ListSettingsResponse{}, nil
}

func TestExternalFallbackDetectsOptionalSettingsWithoutLifecycle(t *testing.T) {
	for _, registered := range []bool{false, true} {
		name := "absent"
		if registered {
			name = "present"
		}
		t.Run(name, func(t *testing.T) {
			listener := bufconn.Listen(1 << 20)
			server := grpc.NewServer()
			if registered {
				settingspb.RegisterSettingsPluginServer(server, &probingSettingsServer{})
			}
			go func() { _ = server.Serve(listener) }()
			t.Cleanup(func() { server.Stop(); _ = listener.Close() })
			connection, err := grpc.NewClient("passthrough:///settings-probe",
				grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
					return listener.DialContext(ctx)
				}),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = connection.Close() })
			backend := NewExternalBackend(nil, &goplugin.GRPCClient{Conn: connection})
			capabilities, err := backend.DetectCapabilities()
			if err != nil {
				t.Fatal(err)
			}
			if registered {
				if len(capabilities) != 1 || capabilities[0] != "settings" {
					t.Fatalf("registered settings service not discovered: %v", capabilities)
				}
			} else if len(capabilities) != 0 {
				t.Fatalf("absent providers became capabilities: %v", capabilities)
			}
		})
	}
}
