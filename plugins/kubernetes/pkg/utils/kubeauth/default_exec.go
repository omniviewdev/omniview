package kubeauth

import (
	"context"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type DefaultExecStrategy struct{}

func (s *DefaultExecStrategy) BuildRestConfig(
	ctx context.Context,
	config clientcmd.ClientConfig,
) (*rest.Config, error) {
	restConfig, err := config.ClientConfig()
	if err != nil {
		return nil, err
	}
	return restConfig, nil
}
