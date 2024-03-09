package services

import (
	"context"
	"fmt"
	"sync"

	"github.com/omniviewdev/plugin/pkg/resource/factories"
	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// NamespaceManager is an interface that resource managers must implement
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
type NamespaceManager[ClientT, DataT, SensitiveDataT any] interface {
	// CreateNamespace creates a new namespace for the resource manager
	// This method should perform any necessary setup so that client retrieval
	// can be done for the namespace after it is created
	CreateNamespace(ctx context.Context, namespace types.Namespace[DataT, SensitiveDataT]) error

	// RemoveNamespace removes a namespace from the resource manager
	RemoveNamespace(ctx context.Context, id string) error

	// ListNamespaces lists the namespaces for the resource manager
	ListNamespaces() ([]types.Namespace[DataT, SensitiveDataT], error)

	// GetNamespaceClient returns the necessary client for the given namespace
	// This method should be used by resourcers to get the client for the given
	// namespace.
	GetNamespaceClient(id string) (*ClientT, error)

	// RefreshNamespaceClient performs any actions necessary to refresh a client for the given namespace.
	// This may include refreshing credentials, or re-initializing the client if it has been
	// invalidated.
	RefreshNamespaceClient(ctx context.Context, id string) error
}

func NewNamespaceManager[ClientT, DataT, SensitiveDataT any](
	factory factories.ResourceClientFactory[ClientT, DataT, SensitiveDataT],
) NamespaceManager[ClientT, DataT, SensitiveDataT] {
	return &namespaceManager[ClientT, DataT, SensitiveDataT]{
		factory:    factory,
		namespaces: make(map[string]types.Namespace[DataT, SensitiveDataT]),
		clients:    make(map[string]*ClientT),
	}
}

type namespaceManager[ClientT, DataT, SensitiveDataT any] struct {
	factory    factories.ResourceClientFactory[ClientT, DataT, SensitiveDataT]
	namespaces map[string]types.Namespace[DataT, SensitiveDataT]
	clients    map[string]*ClientT
	sync.RWMutex
}

func (r *namespaceManager[ClientT, DataT, SensitiveDataT]) CreateNamespace(
	ctx context.Context,
	namespace types.Namespace[DataT, SensitiveDataT],
) error {
	r.Lock()
	defer r.Unlock()

	_, hasClient := r.clients[namespace.ID]
	_, hasNamespace := r.namespaces[namespace.ID]

	if hasClient || hasNamespace {
		return fmt.Errorf("namespace %s already exists", namespace.ID)
	}

	client, err := r.factory.CreateClient(ctx, namespace)
	if err != nil {
		return err
	}

	r.clients[namespace.ID] = client
	r.namespaces[namespace.ID] = namespace

	return nil
}

func (r *namespaceManager[ClientT, DataT, SensitiveDataT]) RemoveNamespace(
	ctx context.Context,
	namespace string,
) error {
	r.Lock()
	defer r.Unlock()

	client, ok := r.clients[namespace]

	if ok && client != nil {
		delete(r.clients, namespace)
		if err := r.factory.StopClient(ctx, client); err != nil {
			return err
		}
	}

	delete(r.namespaces, namespace)

	return nil
}

func (r *namespaceManager[ClientT, DataT, SensitiveDataT]) ListNamespaces() (
	[]types.Namespace[DataT, SensitiveDataT],
	error,
) {
	r.RLock()
	defer r.RUnlock()

	namespaces := make([]types.Namespace[DataT, SensitiveDataT], 0, len(r.namespaces))

	for _, namespace := range r.namespaces {
		namespaces = append(namespaces, namespace)
	}
	return namespaces, nil
}

func (r *namespaceManager[ClientT, DataT, SensitiveDataT]) GetNamespaceClient(
	id string,
) (*ClientT, error) {
	r.RLock()
	defer r.RUnlock()
	client, ok := r.clients[id]

	if !ok {
		return nil, fmt.Errorf("client for namespace %s does not exist", id)
	}

	return client, nil
}

func (r *namespaceManager[ClientT, DataT, SensitiveDataT]) RefreshNamespaceClient(
	ctx context.Context,
	id string,
) error {
	r.RLock()
	defer r.RUnlock()

	client, clientOk := r.clients[id]
	namespace, namespaceOk := r.namespaces[id]

	if !clientOk {
		return fmt.Errorf("client for namespace %s does not exist", id)
	}
	if !namespaceOk {
		return fmt.Errorf("namespace %s does not exist", id)
	}

	return r.factory.RefreshClient(ctx, namespace, client)
}
