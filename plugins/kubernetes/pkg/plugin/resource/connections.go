package resource

import (
	"errors"
	"fmt"

	"k8s.io/client-go/tools/clientcmd"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

const (
	// Estimated size of a the number of contexts in a kubeconfig.
	EstimatedContexts = 10
)

// LoadConnectionsFunc loads the available connections for the plugin.
func LoadConnectionsFunc(ctx *types.PluginContext) ([]types.Connection, error) {
	// Get the kubeconfigs from the settings provider
	kubeconfigs, settingsErr := ctx.PluginConfig.GetStringSlice("kubeconfigs")
	if settingsErr != nil {
		return nil, errors.New("failed to get kubeconfigs from settings")
	}

	// let's make a guestimate of the number of connections we might have
	connections := make([]types.Connection, 0, len(kubeconfigs)*EstimatedContexts)
	for _, kubeconfigPath := range kubeconfigs {
		kubeconfigConnections, err := connectionsFromKubeconfig(kubeconfigPath)
		if err != nil {
			// continue for now
			continue
		}
		connections = append(connections, kubeconfigConnections...)
	}

	return connections, nil
}

func connectionsFromKubeconfig(kubeconfigPath string) ([]types.Connection, error) {
	// if the path has a ~ in it, expand it to the home directory
	kubeconfigPath, err := utils.ExpandTilde(kubeconfigPath)
	if err != nil {
		return nil, err
	}

	// Load the kubeconfig file to get the configuration.
	config, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig from path %s: %w", kubeconfigPath, err)
	}

	connections := make([]types.Connection, 0, len(config.Contexts))

	for contextName, context := range config.Contexts {
		connections = append(connections, types.Connection{
			ID:          contextName,
			Name:        contextName,
			Description: "",
			Avatar:      "",
			Labels: map[string]interface{}{
				"kubeconfig": utils.DeexpandTilde(kubeconfigPath),
				"cluster":    context.Cluster,
				"user":       context.AuthInfo,
			},
			Data: map[string]interface{}{
				"kubeconfig": kubeconfigPath,
				"cluster":    context.Cluster,
				"namespace":  context.Namespace,
				"user":       context.AuthInfo,
			},
		})
	}

	return connections, nil
}
