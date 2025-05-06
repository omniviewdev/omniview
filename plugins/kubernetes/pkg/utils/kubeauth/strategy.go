package kubeauth

import (
	"context"
	"fmt"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type AuthStrategy interface {
	BuildRestConfig(ctx context.Context, kubeconfigPath, kubeContext string) (*rest.Config, error)
	NewForConfig(config *rest.Config) (*kubernetes.Clientset, error)
	NewDynamicForConfig(config *rest.Config) (*dynamic.DynamicClient, error)
	NewDiscoveryForConfig(config *rest.Config) (*discovery.DiscoveryClient, error)
}

func DetectAuthStrategy(kubeconfigPath, kubeContext string) (AuthStrategy, error) {
	clientLoader := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		&clientcmd.ConfigOverrides{
			CurrentContext: kubeContext,
		},
	)

	rawCfg, err := clientLoader.RawConfig()
	if err != nil {
		return nil, fmt.Errorf("error loading raw config: %w", err)
	}

	currentCtx := rawCfg.Contexts[kubeContext]
	if currentCtx == nil {
		return nil, fmt.Errorf("context %q not found", kubeContext)
	}
	authInfo := rawCfg.AuthInfos[currentCtx.AuthInfo]

	switch {
	case isEKSAuth(authInfo):
		return &EKSAuthStrategy{}, nil
	case isGCPAuth(authInfo):
		return &DefaultAuthStrategy{}, nil
	case isAKSAuth(authInfo):
		return &DefaultAuthStrategy{}, nil
	default:
		return &DefaultAuthStrategy{}, nil
	}
}
