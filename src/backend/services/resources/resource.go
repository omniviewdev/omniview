package resources

import (
	"context"
	"strings"
)

// ResourceActions defines methods to interact with Kubernetes resources.
// The methods in the interface are used to interact with Kubernetes resources, and
// must be fulfilled by all generic resources
type ResourceActions interface {
	Get(ctx context.Context, opts GetOptions) (interface{}, error)
	List(ctx context.Context, opts ListOptions) ([]interface{}, error)
	Edit(ctx context.Context, name string, namespace string, obj interface{}) error
	Delete(ctx context.Context, name string, namespace string) error
}

// GetOptions is a struct that contains options for getting a resource.
type GetOptions struct {
	// ClusterContext is the name of the cluster context. this should be in the form of
	// a kubeconfig path and a context name separated by a colon, e.g. /path/to/kubeconfig:context
	ClusterContext string `json:"cluster"`
	// Name of the resource
	Name string `json:"name"`
	// Namespace of the resource
	Namespace string `json:"namespace"`
	// Search for object by labels it contains
	Labels map[string]string `json:"labels,omitempty"`
}

// ListOptions is a struct that contains options for listing various resources.
type ListOptions struct {
	// ClusterContexts is the name of the cluster contexts to list from. They should be in the form of
	// a kubeconfig path and a context name separated by a colon, e.g. /path/to/kubeconfig:context
	ClusterContexts []string `json:"clusters"`
	// Search for object by name.
	Name string `json:"name,omitempty"`
	// Search for object by namespace.
	Namespaces []string `json:"namespaces,omitempty"`
	// Search for object by labels it contains
	Labels map[string]string `json:"labels,omitempty"`
}

// ============================ FILTER METHODS ============================ //

type MetaAccessor interface {
	GetName() string
	GetNamespace() string
	GetLabels() map[string]string
}

// ShouldInclude checks if a resource should be included in a list based on the provided ListOptions.
func ShouldInclude[T MetaAccessor](item T, opts ListOptions) bool {
	if opts.Name != "" && !strings.Contains(item.GetName(), opts.Name) {
		return false
	}
	if len(opts.Namespaces) > 0 && !contains(opts.Namespaces, item.GetNamespace()) {
		return false
	}
	if len(opts.Labels) > 0 && !labelsAreMatched(item.GetLabels(), opts.Labels) {
		return false
	}
	return true
}

// FilterResources filters a slice of Kubernetes resources based on the provided ListOptions.
func FilterResources[T MetaAccessor](items []T, opts ListOptions) []T {
	var result []T

	for _, item := range items {
		if opts.Name != "" && !strings.Contains(item.GetName(), opts.Name) {
			continue
		}

		if len(opts.Namespaces) > 0 && !contains(opts.Namespaces, item.GetNamespace()) {
			continue
		}

		if len(opts.Labels) > 0 && !labelsAreMatched(item.GetLabels(), opts.Labels) {
			continue
		}

		result = append(result, item)
	}

	return result
}

// contains checks if a slice contains a specific string.
func contains(slice []string, str string) bool {
	for _, s := range slice {
		if s == str {
			return true
		}
	}
	return false
}

// labelsAreMatched checks if all specified labels match those of an item.
func labelsAreMatched(itemLabels, filterLabels map[string]string) bool {
	for key, value := range filterLabels {
		if val, ok := itemLabels[key]; !ok || val != value {
			return false
		}
	}
	return true
}
