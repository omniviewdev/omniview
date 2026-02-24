package clients

import (
	"fmt"
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
	KubeClient             kubernetes.Interface
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
		KubeClient:             clients.Clientset,
		DiscoveryClient:        clients.Discovery,
		DynamicClient:          clients.Dynamic,
		DynamicInformerFactory: clients.InformerFactory,
		RESTConfig:             clients.RestConfig,
	}, nil
}

// RefreshClient re-reads the kubeconfig and replaces all client components
// in-place so that cached pointers pick up fresh credentials.
func RefreshClient(ctx *pkgtypes.PluginContext, client *ClientSet) error {
	fresh, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return fmt.Errorf("failed to refresh client: %w", err)
	}
	client.Clientset = fresh.Clientset
	client.KubeClient = fresh.Clientset
	client.DiscoveryClient = fresh.Discovery
	client.DynamicClient = fresh.Dynamic
	client.RESTConfig = fresh.RestConfig
	client.DynamicInformerFactory = dynamicinformer.NewDynamicSharedInformerFactory(
		fresh.Dynamic,
		DefaultResyncPeriod,
	)
	return nil
}
