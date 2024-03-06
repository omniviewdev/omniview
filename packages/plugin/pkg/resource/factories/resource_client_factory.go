package factories

import "context"

// ResourceClientFactory is responsible for generating clients that resource
// namespace managers can use and pass to resourcers to be able to query resources
// against a given backend. Resource clients are expected to be credentialed to only
// one resource namespace, and the resource namespace manager is responsible for
// managing these clients and switching between them as necessary.
type ResourceClientFactory[T, O any] interface {
	// CreateClient creates a new client for the resource manager to use in interacting with
	// the resource backend. This method should be used to create a new client for the given
	// namespace.
	CreateClient(ctx context.Context, options O) (*T, error)

	// RefreshClient performs any actions necessary to refresh a client for the given namespace.
	// This may include refreshing credentials, or re-initializing the client if it has been
	// invalidated.
	RefreshClient(ctx context.Context, client *T, options O) error
}
