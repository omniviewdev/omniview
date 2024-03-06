// package clients provides a factory for creating clients. the kubernetes factory is responsible for setting up the necessary
// clients for interacting with the API server.
package clients

import (
	"fmt"
	"log"
	"os"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

type KubernetesClientFactory struct{}

// NewKubernetesClientFactory creates a new factory for creating clients for interacting with the API server.
func NewKubernetesClientFactory() *KubernetesClientFactory {
	return &KubernetesClientFactory{}
}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (kcf *KubernetesClientFactory) CreateClients(kubeconfig string, context string) (*kubernetes.Clientset, dynamic.Interface, error) {
	if kubeconfig == "" || context == "" {
		err := fmt.Errorf("kubeconfig and context are required")
		log.Println("error creating client: ", err)
		return nil, nil, err
	}

	// Example: Set SHELL environment variable if needed
	os.Setenv("SHELL", "/bin/zsh")

	// Ensure PATH includes locations for common dependencies
	path := os.Getenv("PATH")
	newPath := fmt.Sprintf("%s:/usr/local/bin:/usr/bin", path)
	os.Setenv("PATH", newPath)

	// connect to a cluster using the provided kubeconfig and context
	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfig},
		&clientcmd.ConfigOverrides{CurrentContext: context},
	).ClientConfig()
	if err != nil {
		err := fmt.Errorf("error creating client: %w", err)
		log.Println("error creating client: ", err)
		return nil, nil, err
	}

	// create a clientset for being able to initialize informers
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		err := fmt.Errorf("error creating clientset: %w", err)
		log.Println("error creating clientset: ", err)
		return nil, nil, err
	}

	// create a dynamic client for interacting with the API server
	client, err := dynamic.NewForConfig(config)
	if err != nil {
		err := fmt.Errorf("error creating dynamic client: %w", err)
		log.Println("error creating dynamic client: ", err)
		return nil, nil, err
	}

	return clientset, client, nil
}
