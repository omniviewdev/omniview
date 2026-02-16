package clients

import (
	"time"

	"github.com/omniview/kubernetes/pkg/utils"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	DefaultResyncPeriod = 30 * time.Minute
)

// Use a custom type here since we want multiple clients to use for each namespace context.
type ClientSet struct {
	Clientset              *kubernetes.Clientset
	DiscoveryClient        discovery.DiscoveryInterface
	DynamicClient          dynamic.Interface
	DynamicInformerFactory dynamicinformer.DynamicSharedInformerFactory
	RESTConfig             *rest.Config
}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func CreateClient(ctx *pkgtypes.PluginContext) (*ClientSet, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}

	return &ClientSet{
		Clientset:              clients.Clientset,
		DiscoveryClient:        clients.Discovery,
		DynamicClient:          clients.Dynamic,
		DynamicInformerFactory: clients.InformerFactory,
		RESTConfig:             clients.RestConfig,
	}, nil
}

// RefreshClient refreshes the dynamic informer factory on an existing client.
func RefreshClient(_ *pkgtypes.PluginContext, client *ClientSet) error {
	client.DynamicInformerFactory = dynamicinformer.NewDynamicSharedInformerFactory(
		client.DynamicClient,
		DefaultResyncPeriod,
	)
	return nil
}
