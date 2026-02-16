package kubeauth

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
)

type EKSAuthStrategy struct {
	clusterName string
	roleArn     string
	profile     string
	region      string

	httpClient *http.Client
	// if we have an issue
	useDefault bool
}

// parseIamAuthenticator parses out the information from a kubeconfig entry that's using the
// aws-iam-authenticator.
func (e *EKSAuthStrategy) parseIamAuthenticator(authInfo *api.AuthInfo) error {
	for i := range len(authInfo.Exec.Args) - 1 {
		if authInfo.Exec.Args[i] == "-i" || authInfo.Exec.Args[i] == "--cluster-id" {
			e.clusterName = authInfo.Exec.Args[i+1]
		}
		if authInfo.Exec.Args[i] == "-r" || authInfo.Exec.Args[i] == "--role" {
			e.roleArn = authInfo.Exec.Args[i+1]
		}
		if authInfo.Exec.Args[i] == "--region" {
			e.region = authInfo.Exec.Args[i+1]
		}
	}
	// try to see if there's a profile we can use
	for _, entry := range authInfo.Exec.Env {
		switch entry.Name {
		case "AWS_PROFILE":
			e.profile = entry.Value
		case "AWS_REGION":
			e.region = entry.Value
		case "AWS_DEFAULT_REGION":
			if e.region == "" {
				e.region = entry.Value
			}
		}
	}

	return nil
}

// parseAwsCli parses out the information from a kubeconfig entry that's using the aws cli
// with the `eks get-token` method.
func (e *EKSAuthStrategy) parseAwsCli(authInfo *api.AuthInfo) error {
	for i := range len(authInfo.Exec.Args) - 1 {
		if authInfo.Exec.Args[i] == "--cluster-name" {
			e.clusterName = authInfo.Exec.Args[i+1]
		}
		if authInfo.Exec.Args[i] == "--role-arn" {
			e.roleArn = authInfo.Exec.Args[i+1]
		}
		if authInfo.Exec.Args[i] == "--region" {
			e.region = authInfo.Exec.Args[i+1]
		}
	}
	// try to see if there's a profile we can use
	for _, entry := range authInfo.Exec.Env {
		if entry.Name == "AWS_PROFILE" {
			e.profile = entry.Value
		}
		if entry.Name == "AWS_REGION" {
			e.region = entry.Value
		}
	}

	if e.clusterName == "" {
		// fallback to parsing from user name: arn:aws:eks:region:acct:cluster/my-cluster
		parts := strings.Split(authInfo.Exec.Args[0], "/")
		if len(parts) > 1 {
			e.clusterName = parts[len(parts)-1]
		}
	}
	return nil
}

func (e *EKSAuthStrategy) BuildRestConfig(
	ctx context.Context,
	kubeconfigPath, kubeContext string,
) (*rest.Config, error) {
	clientLoader := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		&clientcmd.ConfigOverrides{
			CurrentContext: kubeContext,
		},
	)

	rawCfg, err := clientLoader.RawConfig()
	if err != nil {
		return nil, err
	}

	current := rawCfg.Contexts[kubeContext]
	authInfo := rawCfg.AuthInfos[current.AuthInfo]

	switch authInfo.Exec.Command {
	case awsCliCommand:
		if err := e.parseAwsCli(authInfo); err != nil {
			return nil, err
		}
	case awsIamAuthenticatorCommand:
		if err := e.parseIamAuthenticator(authInfo); err != nil {
			return nil, err
		}
	default:
		// log an error and try to use the default authenticator so we at least try. our checks
		// should never get to this point, but just in case
		e.useDefault = true
		return clientLoader.ClientConfig()
	}

	baseConfig, err := clientLoader.ClientConfig()
	if err != nil {
		return nil, err
	}

	// clear out the exec provider so it's not used
	baseConfig.ExecProvider = nil

	configShallowCopy := *baseConfig

	if configShallowCopy.UserAgent == "" {
		configShallowCopy.UserAgent = rest.DefaultKubernetesUserAgent()
	}

	// we're purposely not overriding the transport option here, as if we do then we'll get errors regarding
	// not being able to use custom transports with cert data passed in (which is required for CA auth to the
	// control plane)

	transport, err := rest.TransportFor(&configShallowCopy)
	if err != nil {
		return nil, fmt.Errorf("failed to create full transport: %w", err)
	}

	roundTripper := &eksAuthTransport{
		ClusterName: e.clusterName,
		RoleARN:     e.roleArn,
		Profile:     e.profile,
		Region:      e.region,
		Base:        transport,
	}

	e.httpClient = &http.Client{
		Transport: roundTripper,
		Timeout:   configShallowCopy.Timeout,
	}

	return baseConfig, nil
}

func (e *EKSAuthStrategy) NewForConfig(config *rest.Config) (*kubernetes.Clientset, error) {
	configShallowCopy := *config

	if configShallowCopy.UserAgent == "" {
		configShallowCopy.UserAgent = rest.DefaultKubernetesUserAgent()
	}

	return kubernetes.NewForConfigAndClient(&configShallowCopy, e.httpClient)
}

func (e *EKSAuthStrategy) NewDynamicForConfig(
	config *rest.Config,
) (*dynamic.DynamicClient, error) {
	configShallowCopy := *config

	if configShallowCopy.UserAgent == "" {
		configShallowCopy.UserAgent = rest.DefaultKubernetesUserAgent()
	}

	return dynamic.NewForConfigAndClient(&configShallowCopy, e.httpClient)
}

func (e *EKSAuthStrategy) NewDiscoveryForConfig(
	config *rest.Config,
) (*discovery.DiscoveryClient, error) {
	configShallowCopy := *config

	if configShallowCopy.UserAgent == "" {
		configShallowCopy.UserAgent = rest.DefaultKubernetesUserAgent()
	}

	return discovery.NewDiscoveryClientForConfigAndClient(&configShallowCopy, e.httpClient)
}
