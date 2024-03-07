package services

import (
	"context"
	"sync"

	"github.com/infraview/plugin/pkg/resource/factories"
)

// ResourceNamespaceManagerState represents the state of the resource namespace manager
type ResourceNamespaceManagerStatus int

const (
	// ResourceNamespaceManagerStatusStopped represents the state of the resource namespace manager when it is stopped
	ResourceNamespaceManagerStatusStopped ResourceNamespaceManagerStatus = iota
	// ResourceNamespaceManagerStatusStarted represents the state of the resource namespace manager when it is started
	ResourceNamespaceManagerStatusStarted
)

func (r ResourceNamespaceManagerStatus) String() string {
	return [...]string{"Stopped", "Started"}[r]
}

// ResourceNamespaceManager is an interface that resource managers must implement
// in order to manage working against resources within a namespaced resources. T is the type of the client
// that the resource manager will manage, and O is the options type that the resource manager will use.
//
// Namespaces in the context of this plugin are not to be confused with Kubernetes namespaces,
// which are a way to divide cluster resources between multiple users. Instead, namespaces
// in the context of the plugin are a way to have orchestrate multiple clients within the resource
// backend to separate contexts and resources.
//
// For example, a user may have multiple AWS accounts and roles they would like to incorporate
// into the IDE. However, each account (and role) has it's own authorizations, and must used different
// credentials to access. As such, the user would like to separate these backends into different
// namespaces, so that they can easily switch between them. For this example, a resource namespace
// would consist of the account and role, and the resource namespace manager would be responsible for
// setting up, switching between, and managing these namespaced clients.
//
// The resource namespace manager is designed to be used in conjunction with the resource manager, and
// acts as a provider that resourcers can use to get the appropriate client for the given namespace.
// When creating a new resource manager, the type and options type should be provided to the namespace manager
// so that it can be provided the necessary client factory to create and manage clients for the resource manager.
type ResourceNamespaceManager[ClientT, OptionsT any] interface {
	sync.Locker

	// Initialize initializes the resource manager with the given client factory
	// This method should be called before any other methods on the resource manager
	// are called.
	Initialize(ctx context.Context, factory factories.ResourceClientFactory[ClientT, OptionsT]) error

	// Start starts the resource manager for use
	// This method should be called before any other methods on the resource manager
	// are called.
	Start(ctx context.Context) error

	// Stop stops the resource manager
	// This method should be called before any other methods on the resource manager
	// are called.
	Stop(ctx context.Context) error

	// GetState returns the state of the resource namespace manager
	GetStatus() ResourceNamespaceManagerStatus

	// CreateNamespace creates a new namespace for the resource manager
	// This method should perform any necessary setup so that client retrieval
	// can be done for the namespace after it is created
	CreateNamespace(ctx context.Context, namespace string) error

	// RemoveNamespace removes a namespace from the resource manager
	RemoveNamespace(ctx context.Context, namespace string) error

	// ListNamespaces lists the namespaces for the resource manager
	ListNamespaces() ([]string, error)

	// GetNamespaceClient returns the necessary client for the given namespace
	// This method should be used by resourcers to get the client for the given
	// namespace.
	GetNamespaceClient(namespace string) (*ClientT, error)

	// RefreshNamespaceClient performs any actions necessary to refresh a client for the given namespace.
	// This may include refreshing credentials, or re-initializing the client if it has been
	// invalidated.
	RefreshNamespaceClient(ctx context.Context, namespace string, options OptionsT) error
}
