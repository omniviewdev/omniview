package utils

import (
	"errors"
	"fmt"
	"runtime"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// some shells may not load the necessary environment variables.
func getPathAdditions() string {
	switch os := runtime.GOOS; os {
	case "darwin":
		return "/usr/local/bin:/usr/bin:/opt/homebrew/bin"
	case "linux":
		return "/usr/local/bin:/usr/bin"
	case "windows":
		return ""
	}
	return ""
}

func ClientsetAndConfigFromPluginCtx(
	ctx *types.PluginContext,
) (*kubernetes.Clientset, *rest.Config, error) {
	if ctx.Connection == nil {
		return nil, nil, errors.New("kubeconfig is required")
	}

	kubeconfig, ok := ctx.Connection.GetDataKey("kubeconfig")
	if !ok {
		return nil, nil, errors.New("kubeconfig is required")
	}
	val, ok := kubeconfig.(string)
	if !ok {
		return nil, nil, errors.New("kubeconfig is required and must be a string")
	}
	//
	// // build up the path with some defaults for finding binaries
	// pathVar := api.ExecEnvVar{
	// 	Name:  "PATH",
	// 	Value: getPathAdditions(),
	// }
	// envVars = append(envVars, pathVar)
	//
	// authInfo := api.NewAuthInfo()
	// authInfo.Exec = &api.ExecConfig{
	// 	Env: envVars,
	// }

	// TODO: Change this to get from settings provider
	// os.Setenv("SHELL", "/bin/zsh")
	// os.Setenv("PATH", os.Getenv("PATH")+getPathAdditions())

	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: val},
		&clientcmd.ConfigOverrides{
			CurrentContext: ctx.Connection.ID,
		},
	).ClientConfig()
	if err != nil {
		return nil, nil, fmt.Errorf("error creating client: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, nil, fmt.Errorf("error creating clientset: %w", err)
	}

	return clientset, config, nil
}
