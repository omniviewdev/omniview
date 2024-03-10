package resource

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/omniviewdev/plugin/pkg/resource/factories"
	"github.com/omniviewdev/plugin/pkg/resource/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

const (
	DEFAULT_RESYNC_PERIOD = 30 * time.Minute
)

type KubernetesClientFactory struct{}

func NewKubernetesClientFactory() *KubernetesClientFactory {
	return &KubernetesClientFactory{}
}

// Use a custom type here since we want multiple clients to use for each namespace context.
type ClientSet struct {
	Clientset       *kubernetes.Clientset
	DynamicClient   dynamic.Interface
	InformerFactory informers.SharedInformerFactory
}

var _ factories.ResourceClientFactory[ClientSet, Data, SensitiveData] = &KubernetesClientFactory{}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (f *KubernetesClientFactory) CreateClient(
	_ context.Context,
	rn types.Namespace[Data, SensitiveData],
) (*ClientSet, error) {
	if rn.Data.Kubeconfig == "" {
		return nil, errors.New("kubeconfig is required")
	}

	os.Setenv("SHELL", "/bin/zsh")

	// ensure PATH includes locations for common dependencies
	os.Setenv("PATH", os.Getenv("PATH")+":/usr/local/bin:/usr/bin")

	// connect to a cluster using the provided kubeconfig and context
	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: rn.Data.Kubeconfig},
		&clientcmd.ConfigOverrides{CurrentContext: rn.ID},
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

	informerFactory := informers.NewSharedInformerFactory(clientset, DEFAULT_RESYNC_PERIOD)

	return &ClientSet{
		Clientset:       clientset,
		DynamicClient:   client,
		InformerFactory: informerFactory,
	}, nil
}

// We don't need to refresh the client since we're using a new client for each namespace.
func (f *KubernetesClientFactory) RefreshClient(
	_ context.Context,
	_ types.Namespace[Data, SensitiveData],
	_ *ClientSet,
) error {
	return nil
}

// StartClient starts the given client, and returns an error if the client could not be started.
func (f *KubernetesClientFactory) StartClient(_ context.Context, _ *ClientSet) error {
	return nil
}

// StopClient stops the given client, and returns an error if the client could not be stopped.
func (f *KubernetesClientFactory) StopClient(_ context.Context, _ *ClientSet) error {
	return nil
}
