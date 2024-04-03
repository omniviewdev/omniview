package clients

import (
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

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
	DiscoveryClient        *discovery.DiscoveryClient
	DynamicClient          dynamic.Interface
	DynamicInformerFactory dynamicinformer.DynamicSharedInformerFactory
}

var _ factories.ResourceClientFactory[ClientSet] = &KubernetesClientFactory{}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (f *KubernetesClientFactory) CreateClient(
	ctx *pkgtypes.PluginContext,
) (*ClientSet, error) {
	log.Printf("Connection: %v", ctx.Connection)
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

	// create a clientset for being able to initialize informers
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("error creating clientset: %w", err)
	}

	// create a dynamic client for interacting with the API server
	client, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("error creating dynamic client: %w", err)
	}

	dynamicInformerFactory := dynamicinformer.NewDynamicSharedInformerFactory(
		client,
		DefaultResyncPeriod,
	)

	// create our discovery client
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("error creating discovery client: %w", err)
	}

	return &ClientSet{
		Clientset:              clientset,
		DiscoveryClient:        discoveryClient,
		DynamicClient:          client,
		DynamicInformerFactory: dynamicInformerFactory,
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
