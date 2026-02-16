package kubeauth

import (
	"context"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type DefaultAuthStrategy struct{}

func (s *DefaultAuthStrategy) BuildRestConfig(
	ctx context.Context,
	kubeconfigPath, kubeContext string,
) (*rest.Config, error) {
	// log.Print("processing auth info with default")

	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		&clientcmd.ConfigOverrides{
			CurrentContext: kubeContext,
		},
	).ClientConfig()
}

func (s *DefaultAuthStrategy) NewForConfig(config *rest.Config) (*kubernetes.Clientset, error) {
	return kubernetes.NewForConfig(config)
}

func (s *DefaultAuthStrategy) NewDynamicForConfig(
	config *rest.Config,
) (*dynamic.DynamicClient, error) {
	return dynamic.NewForConfig(config)
}

func (s *DefaultAuthStrategy) NewDiscoveryForConfig(
	config *rest.Config,
) (*discovery.DiscoveryClient, error) {
	return discovery.NewDiscoveryClientForConfig(config)
}
