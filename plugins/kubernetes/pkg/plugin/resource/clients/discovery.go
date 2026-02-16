package clients

import (
	"errors"

	"k8s.io/client-go/discovery"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// DiscoveryClient wraps a Kubernetes discovery client.
type DiscoveryClient struct {
	DiscoveryClient discovery.DiscoveryInterface
}

// CreateDiscoveryClient creates a new discovery client for a Kubernetes connection.
func CreateDiscoveryClient(ctx *pkgtypes.PluginContext) (*DiscoveryClient, error) {
	if ctx.Connection == nil {
		return nil, errors.New("kubeconfig is required")
	}

	kubeconfig, ok := ctx.Connection.GetDataKey("kubeconfig")
	if !ok {
		return nil, errors.New("kubeconfig is required")
	}
	val, ok := kubeconfig.(string)
	if !ok {
		return nil, errors.New("kubeconfig is required and must be a string")
	}

	clients, err := kubeauth.LoadKubeClients(val, ctx.Connection.ID)
	if err != nil {
		return nil, err
	}

	return &DiscoveryClient{
		DiscoveryClient: clients.Discovery,
	}, nil
}
