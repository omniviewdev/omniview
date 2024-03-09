package factories

import (
	"context"

	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// ResourceClientFactory is responsible for generating clients that resource
// namespace managers can use and pass to resourcers to be able to query resources
// against a given backend. Resource clients are expected to be credentialed to only
// one resource namespace, and the resource namespace manager is responsible for
// managing these clients and switching between them as necessary.
type ResourceClientFactory[ClientT, NamespaceDT, NamespaceSDT any] interface {
	// CreateClient creates a new client for the resource manager to use in interacting with
	// the resource backend. This method should be used to create a new client for the given
	// namespace.
	CreateClient(
		ctx context.Context,
		namespace types.Namespace[NamespaceDT, NamespaceSDT],
	) (*ClientT, error)

	// RefreshClient performs any actions necessary to refresh a client for the given namespace.
	// This may include refreshing credentials, or re-initializing the client if it has been
	// invalidated.
	RefreshClient(
		ctx context.Context,
		namespace types.Namespace[NamespaceDT, NamespaceSDT],
		client *ClientT,
	) error

	// StartClient starts the given client, and returns an error if the client could not be started.
	// This method should be called when the client is needed.
	//
	// If the client does not need to be started, this method should return nil. This method will
	// be called on every sync operation, and as such should be idempotent.
	StartClient(ctx context.Context, client *ClientT) error

	// StopClient stops the given client, and returns an error if the client could not be stopped.
	// If the client does not need to be stopped, this method should return nil.
	StopClient(ctx context.Context, client *ClientT) error
}
