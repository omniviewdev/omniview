package types

import (
	"context"
	"fmt"
	"sync"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	grpccodes "google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
)

// rpcTimeout bounds each lifecycle and probe RPC made to an external plugin.
const rpcTimeout = 5 * time.Second

// ExternalBackend wraps a go-plugin Client and ClientProtocol pair.
// All go-plugin concrete types are confined to this file.
type ExternalBackend struct {
	pluginClient   *goplugin.Client
	rpcClient      goplugin.ClientProtocol
	processCleanup func()
	cleanupOnce    sync.Once
}

// NewExternalBackend creates a new ExternalBackend wrapping go-plugin types.
func NewExternalBackend(pluginClient *goplugin.Client, rpcClient goplugin.ClientProtocol) *ExternalBackend {
	return &ExternalBackend{
		pluginClient: pluginClient,
		rpcClient:    rpcClient,
	}
}

// SetProcessCleanup transfers a verified executable snapshot to this process's
// lifecycle. Configure once before publishing the backend to other goroutines.
func (b *ExternalBackend) SetProcessCleanup(cleanup func()) {
	b.processCleanup = cleanup
}

func (b *ExternalBackend) cleanupProcess() {
	b.cleanupOnce.Do(func() {
		if b.processCleanup != nil {
			b.processCleanup()
		}
	})
}

// Dispense returns a capability client by name.
func (b *ExternalBackend) Dispense(name string) (interface{}, error) {
	return b.rpcClient.Dispense(name)
}

// Healthy checks plugin health via lifecycle RPC, falling back to process
// exit status.
func (b *ExternalBackend) Healthy() bool {
	// Try lifecycle HealthCheck RPC first.
	raw, err := b.rpcClient.Dispense("lifecycle")
	if err == nil {
		if lcClient, ok := raw.(*lc.Client); ok {
			ctx, cancel := context.WithTimeout(context.Background(), rpcTimeout)
			defer cancel()
			resp, rpcErr := lcClient.HealthCheck(ctx)
			if rpcErr == nil {
				return resp.GetStatus() == lifecyclepb.ServingStatus_SERVING_STATUS_SERVING
			}
		}
	}

	// Fall back to checking if the process has exited.
	return !b.pluginClient.Exited()
}

// Stop gracefully closes the RPC connection.
func (b *ExternalBackend) Stop() error {
	return b.rpcClient.Close()
}

// Kill forcefully terminates the plugin process.
func (b *ExternalBackend) Kill() {
	b.pluginClient.Kill()
	// go-plugin v1.7 Kill waits for the runner and client goroutines to exit;
	// an RPC Close alone does not prove Windows released the executable.
	b.cleanupProcess()
}

// Exited returns true if the plugin process has exited.
func (b *ExternalBackend) Exited() bool {
	exited := b.pluginClient.Exited()
	if exited {
		b.cleanupProcess()
	}
	return exited
}

// DetectCapabilities tries lifecycle-based detection first, then falls
// back to gRPC method probing.
func (b *ExternalBackend) DetectCapabilities() ([]string, error) {
	caps, err := b.detectViaLifecycle()
	if err == nil {
		return caps, nil
	}

	// Fall back to probing.
	return b.detectViaProbing()
}

func (b *ExternalBackend) detectViaLifecycle() ([]string, error) {
	raw, err := b.rpcClient.Dispense("lifecycle")
	if err != nil {
		return nil, fmt.Errorf("failed to dispense lifecycle client: %w", err)
	}

	lcClient, ok := raw.(*lc.Client)
	if !ok {
		return nil, fmt.Errorf("dispensed lifecycle client has wrong type: %T", raw)
	}

	ctx, cancel := context.WithTimeout(context.Background(), rpcTimeout)
	defer cancel()

	resp, err := lcClient.GetCapabilities(ctx)
	if err != nil {
		return nil, fmt.Errorf("GetCapabilities RPC failed: %w", err)
	}

	return resp.GetCapabilities(), nil
}

func (b *ExternalBackend) detectViaProbing() ([]string, error) {
	grpcClient, ok := b.rpcClient.(*goplugin.GRPCClient)
	if !ok {
		return nil, fmt.Errorf("expected *plugin.GRPCClient for probing, got %T", b.rpcClient)
	}
	conn := grpcClient.Conn

	probeMethods := []struct {
		capability string
		method     string
	}{
		{"resource", "/com.omniview.pluginsdk.ResourcePlugin/GetResourceGroups"},
		{"exec", "/com.omniview.pluginsdk.ExecPlugin/GetSupportedResources"},
		{"networker", "/com.omniview.pluginsdk.NetworkerPlugin/GetSupportedPortForwardTargets"},
		{"log", "/com.omniview.pluginsdk.LogPlugin/GetSupportedResources"},
		{"metric", "/com.omniview.pluginsdk.MetricPlugin/GetSupportedResources"},
	}

	var caps []string
	for _, pm := range probeMethods {
		ctx, cancel := context.WithTimeout(context.Background(), rpcTimeout)
		err := conn.Invoke(ctx, pm.method, &emptypb.Empty{}, &emptypb.Empty{})
		cancel()
		if grpcstatus.Code(err) == grpccodes.Unimplemented {
			continue
		}
		caps = append(caps, pm.capability)
	}

	return caps, nil
}

// NegotiatedVersion returns the SDK protocol version negotiated via go-plugin.
func (b *ExternalBackend) NegotiatedVersion() int {
	return b.pluginClient.NegotiatedVersion()
}

// ReattachConfig exposes the plugin process PID for the PID tracker.
func (b *ExternalBackend) ReattachConfig() *goplugin.ReattachConfig {
	return b.pluginClient.ReattachConfig()
}
