package clients

import (
	"errors"

	"k8s.io/client-go/discovery"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/factories"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

type KubernetesDiscoveryClientFactory struct{}

func NewKubernetesDiscoverClientFactory() factories.ResourceClientFactory[DiscoveryClient] {
	return &KubernetesDiscoveryClientFactory{}
}

// Use a custom type here since we want multiple clients to use for each namespace context.
type DiscoveryClient struct {
	DiscoveryClient discovery.DiscoveryInterface
}

var _ factories.ResourceDiscoveryClientFactory[DiscoveryClient] = &KubernetesDiscoveryClientFactory{}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (f *KubernetesDiscoveryClientFactory) CreateClient(
	ctx *pkgtypes.PluginContext,
) (*DiscoveryClient, error) {
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

// nothing we need to do here.
func (f *KubernetesDiscoveryClientFactory) RefreshClient(
	_ *pkgtypes.PluginContext,
	client *DiscoveryClient,
) error {
	return nil
}

// StartClient starts the given client, and returns an error if the client could not be started.
func (f *KubernetesDiscoveryClientFactory) StartClient(
	_ *pkgtypes.PluginContext,
	_ *DiscoveryClient,
) error {
	return nil
}

// StopClient stops the given client, and returns an error if the client could not be stopped.
func (f *KubernetesDiscoveryClientFactory) StopClient(
	_ *pkgtypes.PluginContext,
	_ *DiscoveryClient,
) error {
	return nil
}
