package resource

import (
	"fmt"
	"log"
	"strings"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/clientcmd"

	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

const (
	// Estimated size of a the number of contexts in a kubeconfig.
	EstimatedContexts = 10
)

// LoadConnectionsFunc loads the available connections for the plugin.
func LoadConnectionsFunc(ctx *types.PluginContext) ([]types.Connection, error) {
	log.Println("Loading connections")
	// Get the kubeconfigs from the settings provider
	kubeconfigs, settingsErr := ctx.PluginConfig.GetStringSlice("kubeconfigs")
	if settingsErr != nil {
		log.Printf("failed to get kubeconfigs from settings: %v", settingsErr)
		return nil, fmt.Errorf("failed to get kubeconfigs from settings: %w", settingsErr)
	}
	log.Printf("kubeconfigs: %v", kubeconfigs)

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

// LoadConnectionNamespacesFunc loads the available namespaces for the connection.
func LoadConnectionNamespacesFunc(
	ctx *types.PluginContext,
	client *clients.ClientSet,
) ([]string, error) {
	lister := client.DynamicInformerFactory.
		ForResource(corev1.SchemeGroupVersion.WithResource("namespaces")).
		Lister()

	resources, err := lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	namespaces := make([]string, 0, len(resources))

	for _, r := range resources {
		var obj map[string]interface{}
		obj, err = runtime.DefaultUnstructuredConverter.ToUnstructured(r)
		if err != nil {
			return nil, err
		}
		res := unstructured.Unstructured{Object: obj}
		namespaces = append(namespaces, res.GetName())
	}

	return namespaces, nil
}

// CheckConnectionFunc checks the connection to the cluster, using the discovery client.
func CheckConnectionFunc(
	_ *types.PluginContext,
	conn *types.Connection,
	client *clients.ClientSet,
) (types.ConnectionStatus, error) {
	if conn == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "No connection was provided to check",
			Error:      "connection is required",
		}, nil
	}
	if client == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "No client was provided to check the connection",
			Error:      "client is required",
		}, nil
	}

	result := types.ConnectionStatus{
		Connection: conn,
		Status:     types.ConnectionStatusUnknown,
	}

	// our check is simply if we can get all the server groups
	_, err := client.DiscoveryClient.ServerGroups()
	if err != nil {
		switch {
		case k8serrors.IsUnauthorized(err):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your credentials and try again."
		case k8serrors.IsForbidden(err):
			result.Status = types.ConnectionStatusForbidden
			result.Error = "Forbidden"
			result.Details = "You are forbidden from accessing this connection. Please check your permissions and try again."
		// common cases for unauthorized AWS session credentials
		case strings.Contains(err.Error(), "getting credentials: exec: executable aws failed with exit code 255"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your AWS credentials and try again."
		case strings.Contains(err.Error(), "executable aws-iam-authenticator failed with exit code 1"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your AWS credentials and try again."
		case strings.Contains(err.Error(), "no such host"):
			result.Status = types.ConnectionStatusNotFound
			result.Error = "Not Found"
			result.Details = "The host was not found. Please check the host and try again."
		case strings.Contains(err.Error(), "connection refused"):
			result.Status = types.ConnectionStatusError
			result.Error = "Connection Refused"
			result.Details = "The connection was refused. Please check the host and try again."
		case strings.Contains(err.Error(), "certificate signed by unknown authority"):
			result.Status = types.ConnectionStatusError
			result.Error = "Unknown Authority"
			result.Details = "The certificate for this connection was signed by an unknown authority. Please check the certificate and try again."
		case strings.Contains(err.Error(), "certificate has expired"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Certificate Expired"
			result.Details = "The certificate for this connection has expired. Please check/refresh the certificate and try again."
		default:
			result.Status = types.ConnectionStatusError
			result.Error = "Error"
			result.Details = fmt.Sprintf("Error checking connection: %v", err)
		}

		return result, nil
	}

	// wait for an informer cache sync so that we don't get a bunch of empty resources
	result.Status = types.ConnectionStatusConnected
	result.Details = "Connection is valid"
	return result, nil
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

func processGroupVersion(gv string) (string, string) {
	parts := strings.Split(gv, "/")

	if len(parts) == 1 {
		return "core", parts[0]
	}

	group := parts[0]
	version := parts[1]

	if strings.HasSuffix(group, ".k8s.io") {
		// if group ends in .k8s.io, remove it
		group = strings.TrimSuffix(group, ".k8s.io")

		// if group still has dots, remove them except in our weird cases
		if strings.Contains(group, ".") {
			// split by dot, and combine in reverse order without dot
			parts := strings.Split(group, ".")

			if strings.HasPrefix(group, "internal.") {
				group = ""
				for i := len(parts) - 1; i >= 0; i-- {
					group += parts[i]
				}
			} else {
				// take the first part of the group
				group = parts[0]
			}
		}
	}

	return group, version
}

func DiscoveryFunc(
	ctx *types.PluginContext,
	client *clients.DiscoveryClient,
) ([]resourcetypes.ResourceMeta, error) {
	// TODO: not sure if we wnat preferred or not, but I could see a use case for getting all supported
	groups, err := client.DiscoveryClient.ServerPreferredResources()
	if err != nil {
		return nil, err
	}

	// guestimate about 5 resources per group
	response := make([]resourcetypes.ResourceMeta, 0, len(groups)*5)

	for _, grouplist := range groups {
		group, version := processGroupVersion(grouplist.GroupVersion)

		for _, resource := range grouplist.APIResources {
			response = append(response, resourcetypes.ResourceMeta{
				Group:   group,
				Version: version,
				Kind:    resource.Kind,
			})
		}
	}

	return response, nil
}
