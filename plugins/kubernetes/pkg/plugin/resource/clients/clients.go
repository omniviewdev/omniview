package clients

import (
	"log"
	"time"

	"github.com/omniview/kubernetes/pkg/utils"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/factories"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	DefaultResyncPeriod = 30 * time.Minute
)

type KubernetesClientFactory struct{}

func NewKubernetesClientFactory() factories.ResourceClientFactory[ClientSet] {
	return &KubernetesClientFactory{}
}

// Use a custom type here since we want multiple clients to use for each namespace context.
type ClientSet struct {
	Clientset              *kubernetes.Clientset
	DiscoveryClient        discovery.DiscoveryInterface
	DynamicClient          dynamic.Interface
	DynamicInformerFactory dynamicinformer.DynamicSharedInformerFactory
}

var _ factories.ResourceClientFactory[ClientSet] = &KubernetesClientFactory{}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (f *KubernetesClientFactory) CreateClient(
	ctx *pkgtypes.PluginContext,
) (*ClientSet, error) {
	log.Printf("Calling CreateClient")
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}

	return &ClientSet{
		Clientset:              clients.Clientset,
		DiscoveryClient:        clients.Discovery,
		DynamicClient:          clients.Dynamic,
		DynamicInformerFactory: clients.InformerFactory,
	}, nil
}

// We'll need to refresh just the dynamic informers when the client is refreshed.
func (f *KubernetesClientFactory) RefreshClient(
	_ *pkgtypes.PluginContext,
	client *ClientSet,
) error {
	// dynamic informers will need to be reinited
	client.DynamicInformerFactory = dynamicinformer.NewDynamicSharedInformerFactory(
		client.DynamicClient,
		DefaultResyncPeriod,
	)
	return nil
}

// StartClient starts the given client, and returns an error if the client could not be started.
func (f *KubernetesClientFactory) StartClient(_ *pkgtypes.PluginContext, _ *ClientSet) error {
	return nil
}

// StopClient stops the given client, and returns an error if the client could not be stopped.
func (f *KubernetesClientFactory) StopClient(_ *pkgtypes.PluginContext, _ *ClientSet) error {
	return nil
}
