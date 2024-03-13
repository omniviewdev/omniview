package services

import (
	"fmt"
	"sync"

	"github.com/omniviewdev/plugin/pkg/resource/factories"
	"github.com/omniviewdev/plugin/pkg/types"
)

// TODO - rename to AuthorizationsManager

// AuthContextManager is an interface that resource managers must implement
// in order to manage working against resources within a authd resources. T is the type of the client
// that the resource manager will manage, and O is the options type that the resource manager will use.
//
// Authorizations in the context of this plugin are not to be confused with Kubernetes auths,
// which are a way to divide cluster resources between multiple users. Instead, auths
// in the context of the plugin are a way to have orchestrate multiple clients within the resource
// backend to separate contexts and resources.
//
// For example, a user may have multiple AWS accounts and roles they would like to incorporate
// into the IDE. However, each account (and role) has it's own authorizations, and must used different
// credentials to access. As such, the user would like to separate these backends into different
// auths, so that they can easily switch between them. For this example, a resource auth
// would consist of the account and role, and the resource auth manager would be responsible for
// setting up, switching between, and managing these authd clients.
//
// The resource auth manager is designed to be used in conjunction with the resource manager, and
// acts as a provider that resourcers can use to get the appropriate client for the given auth.
// When creating a new resource manager, the type and options type should be provided to the auth manager
// so that it can be provided the necessary client factory to create and manage clients for the resource manager.
type AuthContextManager[ClientT any] interface {
	// InjectAuthContext injects the auth context by id into the plugin context
	InjectAuthContext(ctx *types.PluginContext, id string) error

	// CreateAuthorization creates a new auth for the resource manager
	// This method should perform any necessary setup so that client retrieval
	// can be done for the auth after it is created
	Create(ctx *types.PluginContext, auth types.AuthContext) error

	// RemoveAuthorization removes a auth from the resource manager
	Remove(ctx *types.PluginContext, id string) error

	// ListAuthorizations lists the auths for the resource manager
	List(ctx *types.PluginContext) ([]types.AuthContext, error)

	// GetContextClient returns the necessary client for the given auth
	// This method should be used by resourcers to get the client for the given
	// auth.
	GetContextClient(ctx *types.PluginContext, id string) (*ClientT, error)

	// RefreshContextClient performs any actions necessary to refresh a client for the given auth.
	// This may include refreshing credentials, or re-initializing the client if it has been
	// invalidated.
	RefreshContextClient(ctx *types.PluginContext, id string) error

	// GetCurrentContextClient returns the current client for the given auth
	GetCurrentContextClient(ctx *types.PluginContext) (*ClientT, error)

	// RefreshCurrentContextClient performs any actions necessary to refresh the current client for the given auth.
	RefreshCurrentContextClient(ctx *types.PluginContext) error
}

// NewAuthContextManager creates a new service to manage the various auth contexts for a
// plugin with an authenticated backend.
func NewAuthContextManager[ClientT any](
	factory factories.ResourceClientFactory[ClientT],
) AuthContextManager[ClientT] {
	return &authContextManager[ClientT]{
		factory: factory,
		auths:   make(map[string]types.AuthContext),
		clients: make(map[string]*ClientT),
	}
}

type authContextManager[ClientT any] struct {
	factory factories.ResourceClientFactory[ClientT]
	auths   map[string]types.AuthContext
	clients map[string]*ClientT
	sync.RWMutex
}

func (r *authContextManager[ClientT]) InjectAuthContext(
	ctx *types.PluginContext,
	id string,
) error {
	r.RLock()
	defer r.RUnlock()

	auth, ok := r.auths[id]
	if !ok {
		return fmt.Errorf("auth %s does not exist", id)
	}
	ctx.AuthContext = &auth
	return nil
}

func (r *authContextManager[ClientT]) Create(
	ctx *types.PluginContext,
	auth types.AuthContext,
) error {
	r.Lock()
	defer r.Unlock()

	_, hasClient := r.clients[auth.ID]
	_, hasAuthorization := r.auths[auth.ID]

	if hasClient || hasAuthorization {
		return fmt.Errorf("auth %s already exists", auth.ID)
	}

	client, err := r.factory.CreateClient(ctx)
	if err != nil {
		return err
	}

	r.clients[auth.ID] = client
	r.auths[auth.ID] = auth

	return nil
}

func (r *authContextManager[ClientT]) Remove(
	ctx *types.PluginContext,
	id string,
) error {
	r.Lock()
	defer r.Unlock()

	client, ok := r.clients[id]

	if ok && client != nil {
		delete(r.clients, id)
		if err := r.factory.StopClient(ctx, client); err != nil {
			return err
		}
	}

	delete(r.auths, id)

	return nil
}

func (r *authContextManager[ClientT]) List(
	_ *types.PluginContext,
) ([]types.AuthContext, error) {
	r.RLock()
	defer r.RUnlock()

	auths := make([]types.AuthContext, 0, len(r.auths))

	for _, auth := range r.auths {
		auths = append(auths, auth)
	}
	return auths, nil
}

func (r *authContextManager[ClientT]) GetContextClient(
	_ *types.PluginContext,
	id string,
) (*ClientT, error) {
	r.RLock()
	defer r.RUnlock()
	client, ok := r.clients[id]

	if !ok {
		return nil, fmt.Errorf("client for auth context %s does not exist", id)
	}

	return client, nil
}

func (r *authContextManager[ClientT]) RefreshContextClient(
	ctx *types.PluginContext,
	id string,
) error {
	r.RLock()
	defer r.RUnlock()

	client, clientOk := r.clients[id]
	_, authOk := r.auths[id]

	if !clientOk {
		return fmt.Errorf("client for auth %s does not exist", id)
	}
	if !authOk {
		return fmt.Errorf("auth %s does not exist", id)
	}

	return r.factory.RefreshClient(ctx, client)
}

func (r *authContextManager[ClientT]) GetCurrentContextClient(
	ctx *types.PluginContext,
) (*ClientT, error) {
	r.RLock()
	defer r.RUnlock()

	if ctx.AuthContext == nil {
		return nil, fmt.Errorf("auth context is nil")
	}

	client, ok := r.clients[ctx.AuthContext.ID]

	if !ok {
		return nil, fmt.Errorf("client for auth context %s does not exist", ctx.AuthContext.ID)
	}

	return client, nil
}

func (r *authContextManager[ClientT]) RefreshCurrentContextClient(
	ctx *types.PluginContext,
) error {
	r.RLock()
	defer r.RUnlock()
	if ctx.AuthContext == nil {
		return fmt.Errorf("auth context is nil")
	}
	client, clientOk := r.clients[ctx.AuthContext.ID]
	_, authOk := r.auths[ctx.AuthContext.ID]

	if !clientOk {
		return fmt.Errorf("client for auth %s does not exist", ctx.AuthContext.ID)
	}
	if !authOk {
		return fmt.Errorf("auth %s does not exist", ctx.AuthContext.ID)
	}

	return r.factory.RefreshClient(ctx, client)
}
