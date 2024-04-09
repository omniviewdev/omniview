package clients

import (
	"errors"
	"fmt"
	"os"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/factories"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

type KubernetesDiscoveryClientFactory struct{}

func NewKubernetesDiscoverClientFactory() factories.ResourceClientFactory[DiscoveryClient] {
	return &KubernetesDiscoveryClientFactory{}
}

// Use a custom type here since we want multiple clients to use for each namespace context.
type DiscoveryClient struct {
	DiscoveryClient *discovery.DiscoveryClient
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

	// Change this to get from settings provider
	os.Setenv("SHELL", "/bin/zsh")

	// ensure PATH includes locations for common dependencies
	os.Setenv("PATH", os.Getenv("PATH")+":/usr/local/bin:/usr/bin")

	// connect to a cluster using the provided kubeconfig and context
	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: val},
		&clientcmd.ConfigOverrides{CurrentContext: ctx.Connection.ID},
	).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("error creating client: %w", err)
	}

	// create our discovery client
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("error creating discovery client: %w", err)
	}

	return &DiscoveryClient{
		DiscoveryClient: discoveryClient,
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
