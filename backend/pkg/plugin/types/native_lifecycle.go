package types

import (
	"context"
	"slices"

	"github.com/omniviewdev/plugin-sdk/pkg/activity"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// NativeLifecycle publishes the identity, declared capabilities and readiness of
// one directly owned backend activation. It does not impersonate a plugin process
// or create a gRPC broker for product-owned code.
type NativeLifecycle struct {
	pluginID     string
	version      string
	capabilities []string
	healthy      func() bool
}

func NewNativeLifecycle(pluginID, version string, capabilities []string, healthy func() bool) *NativeLifecycle {
	return &NativeLifecycle{pluginID: pluginID, version: version, capabilities: slices.Clone(capabilities), healthy: healthy}
}

func (l *NativeLifecycle) GetInfo(ctx context.Context) (*lifecyclepb.GetInfoResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &lifecyclepb.GetInfoResponse{PluginId: l.pluginID, Version: l.version, SdkProtocolVersion: int32(CurrentProtocolVersion)}, nil
}

func (l *NativeLifecycle) GetCapabilities(ctx context.Context) (*lifecyclepb.GetCapabilitiesResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &lifecyclepb.GetCapabilitiesResponse{Capabilities: slices.Clone(l.capabilities)}, nil
}

func (l *NativeLifecycle) HealthCheck(ctx context.Context) (*lifecyclepb.HealthCheckResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	serving := lifecyclepb.ServingStatus_SERVING_STATUS_NOT_SERVING
	if l.healthy != nil && l.healthy() {
		serving = lifecyclepb.ServingStatus_SERVING_STATUS_SERVING
	}
	return &lifecyclepb.HealthCheckResponse{Status: serving}, nil
}

// ServeActivities explicitly declines the optional process-reporting backchannel.
// Native resource activities are host-owned; this lifecycle does not advertise a
// plugin producer or accept a reporter that nobody will use.
func (*NativeLifecycle) ServeActivities(context.Context, activity.Reporter) (func(), error) {
	return nil, status.Error(codes.Unimplemented, "Native backend does not expose plugin activity reporting.")
}
