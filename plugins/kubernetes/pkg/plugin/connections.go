package plugin

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"k8s.io/client-go/tools/clientcmd"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	// Estimated size of a the number of contexts in a kubeconfig.
	EstimatedContexts = 10
)

// LoadConnectionsFunc loads the available connections for the plugin.
func LoadConnectionsFunc(ctx *types.PluginContext) ([]types.Connection, error) {
	// Get the kubeconfigs from the settings provider
	val, settingErr := ctx.PluginConfig.GetSettingValue("kubeconfigs")
	if settingErr != nil {
		return nil, settingErr
	}

	kubeconfigs, ok := val.([]string)
	if !ok {
		return nil, errors.New("failed to get kubeconfigs from settings")
	}

	// let's make a guestimate of the number of connections we might have
	connections := make([]types.Connection, 0, len(kubeconfigs)*EstimatedContexts)
	for _, kubeconfigPath := range kubeconfigs {
		kubeconfigConnections, err := connectionsFromKubeconfig(kubeconfigPath)
		if err != nil {
			return nil, err
		}
		connections = append(connections, kubeconfigConnections...)
	}

	return connections, nil
}

// expandTilde takes a path and if it starts with a ~, it will replace it with the home directory.
func expandTilde(path string) (string, error) {
	if path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		path = filepath.Join(home, path[2:])
	}
	return path, nil
}

// deexpandTilde takes a path and if it is in the home directory, it will replace it with a ~.
func deexpandTilde(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		// fallback to the original path
		return path
	}
	if home != "" {
		path = filepath.Join("~", path[len(home):])
	}
	return path
}

func connectionsFromKubeconfig(kubeconfigPath string) ([]types.Connection, error) {
	// if the path has a ~ in it, expand it to the home directory
	kubeconfigPath, err := expandTilde(kubeconfigPath)
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
				"kubeconfig": deexpandTilde(kubeconfigPath),
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
