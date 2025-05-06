package utils

import (
	"errors"
	"log"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Returns a kube client bundle given the incoming plugin context
func KubeClientsFromContext(ctx *types.PluginContext) (*kubeauth.KubeClientBundle, error) {
	if ctx.Connection == nil {
		return nil, errors.New("kubeconfig is required")
	}

	val, ok := ctx.Connection.GetDataKey("kubeconfig")
	if !ok {
		return nil, errors.New("kubeconfig is required")
	}
	kubeconfigPath, ok := val.(string)
	if !ok {
		return nil, errors.New("kubeconfig is required and must be a string")
	}

	log.Printf(
		"Loading kube clients at path %s with connection %s",
		kubeconfigPath,
		ctx.Connection.ID,
	)

	return kubeauth.LoadKubeClients(kubeconfigPath, ctx.Connection.ID)
}
