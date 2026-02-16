package kubeauth

import (
	"context"
	"log"
	"time"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const (
	DefaultResyncPeriod = 30 * time.Minute
)

type KubeClientBundle struct {
	Clientset       *kubernetes.Clientset
	Discovery       discovery.DiscoveryInterface
	Dynamic         dynamic.Interface
	InformerFactory dynamicinformer.DynamicSharedInformerFactory
	RestConfig      *rest.Config
}

// LoadKubeClients loads the various clients necessary to interact with the api, given a kubeconfig path and
// and active kubeconfig context to use
func LoadKubeClients(kubeconfigPath string, kubeContext string) (*KubeClientBundle, error) {
	ctx := context.Background()
	// log.Printf("loading kube clients at path %s for context %s", kubeconfigPath, kubeContext)

	strategy, err := DetectAuthStrategy(kubeconfigPath, kubeContext)
	if err != nil {
		return nil, err
	}

	restConfig, err := strategy.BuildRestConfig(ctx, kubeconfigPath, kubeContext)
	if err != nil {
		log.Printf("failed to build rest config: %s", err.Error())
		return nil, err
	}

	clientset, err := strategy.NewForConfig(restConfig)
	if err != nil {
		log.Printf("failed to build clientset config: %s", err.Error())
		return nil, err
	}

	dyn, err := strategy.NewDynamicForConfig(restConfig)
	if err != nil {
		log.Printf("failed to build dynamic config: %s", err.Error())
		return nil, err
	}

	disco, err := strategy.NewDiscoveryForConfig(restConfig)
	if err != nil {
		log.Printf("failed to build discovery config: %s", err.Error())
		return nil, err
	}

	informerFactory := dynamicinformer.NewDynamicSharedInformerFactory(dyn, 0)

	return &KubeClientBundle{
		Clientset:       clientset,
		Discovery:       disco,
		Dynamic:         dyn,
		InformerFactory: informerFactory,
		RestConfig:      restConfig,
	}, nil
}
