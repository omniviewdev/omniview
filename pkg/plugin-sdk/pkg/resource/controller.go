package resource

import (
	"errors"
	"fmt"
	"log"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/services"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ResourceController is responsible for managing the execution of resource operations.
// The resource controller will take in requests from requesters, both inside the IDE
// and outside, and will execute the necessary operations on the resource manager.
//
// This controller is the primary entrypoint for executing operations on resources, and
// operates as the plugin host for the installed resource plugin.
func NewResourceController[ClientT any](
	resourcerManager services.ResourcerManager[ClientT],
	connectionManager services.ConnectionManager[ClientT],
	resourceTypeManager services.ResourceTypeManager,
	layoutManager services.LayoutManager,
	createInformerFunc types.CreateInformerHandleFunc[ClientT],
) types.ResourceProvider {
	controller := &resourceController[ClientT]{
		stopChan:            make(chan struct{}),
		resourcerManager:    resourcerManager,
		connectionManager:   connectionManager,
		resourceTypeManager: resourceTypeManager,
		layoutManager:       layoutManager,
	}
	if createInformerFunc != nil {
		controller.withInformer = true
		controller.addChan = make(chan types.InformerAddPayload)
		controller.updateChan = make(chan types.InformerUpdatePayload)
		controller.deleteChan = make(chan types.InformerDeletePayload)
		controller.informerManager = services.NewInformerManager(
			createInformerFunc,
			controller.addChan,
			controller.updateChan,
			controller.deleteChan,
		)
	}
	return controller
}

type resourceController[ClientT any] struct {
	resourcerManager    services.ResourcerManager[ClientT]
	connectionManager   services.ConnectionManager[ClientT]
	resourceTypeManager services.ResourceTypeManager
	layoutManager       services.LayoutManager
	stopChan            chan struct{}
	informerManager     *services.InformerManager[ClientT]
	addChan             chan types.InformerAddPayload
	updateChan          chan types.InformerUpdatePayload
	deleteChan          chan types.InformerDeletePayload
	withInformer        bool
}

// retrieveClientResourcer gets our client and resourcer outside to slim down the methods.
// The unified GetResourcer handles both exact and pattern matches.
func (c *resourceController[ClientT]) retrieveClientResourcer(
	ctx *pkgtypes.PluginContext,
	resource string,
) (*ClientT, types.Resourcer[ClientT], error) {
	var nilResourcer types.Resourcer[ClientT]
	if ctx.Connection == nil {
		return nil, nilResourcer, errors.New("connection is nil")
	}

	resourcer, err := c.resourcerManager.GetResourcer(resource)
	if err != nil {
		return nil, nilResourcer, fmt.Errorf(
			"resourcer not found for resource type %s: %w",
			resource,
			err,
		)
	}

	client, err := c.connectionManager.GetCurrentConnectionClient(ctx)
	if err != nil {
		return nil, nilResourcer, fmt.Errorf(
			"client unable to be retrieved for connection %s: %w",
			ctx.Connection.ID,
			err,
		)
	}

	return client, resourcer, nil
}

// ================================= Operation Methods ================================= //

// Get gets a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) Get(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.GetInput,
) (*types.GetResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	return resourcer.Get(ctx, client, types.ResourceMetaFromString(resource), input)
}

// List lists resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) List(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.ListInput,
) (*types.ListResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	return resourcer.List(ctx, client, types.ResourceMetaFromString(resource), input)
}

// Find finds resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) Find(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.FindInput,
) (*types.FindResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	return resourcer.Find(ctx, client, types.ResourceMetaFromString(resource), input)
}

// Create creates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) Create(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.CreateInput,
) (*types.CreateResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	return resourcer.Create(ctx, client, types.ResourceMetaFromString(resource), input)
}

// Update updates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) Update(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.UpdateInput,
) (*types.UpdateResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	return resourcer.Update(ctx, client, types.ResourceMetaFromString(resource), input)
}

// Delete deletes a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) Delete(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	return resourcer.Delete(ctx, client, types.ResourceMetaFromString(resource), input)
}

// ================================= Informer Methods ================================= //

func (c *resourceController[ClientT]) HasInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) bool {
	return c.informerManager.HasInformer(ctx, connectionID)
}

// StartContextInformer signals to the listen runner to start the informer for the given context.
// If the informer is not enabled, this method will return a nil error.
//
// This typically should not be called by the client, but there may be situations where we need
// to start the informer manually. This gets handled on the StartConnection method.
func (c *resourceController[ClientT]) StartConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	if !c.withInformer {
		// safety guard just in case
		return nil
	}

	if err := c.connectionManager.InjectConnection(ctx, connectionID); err != nil {
		return fmt.Errorf("unable to inject connection: %w", err)
	}
	client, err := c.connectionManager.GetConnectionClient(ctx, connectionID)
	if err != nil {
		return fmt.Errorf("unable to get connection client: %w", err)
	}

	// first create the connection informer
	if err = c.informerManager.CreateConnectionInformer(ctx, ctx.Connection, client); err != nil {
		return err
	}

	// get all the resource types
	resourceTypes := c.GetResourceTypes(connectionID)
	log.Println("got resource types in StartConnectionInformer: ", resourceTypes)
	for _, resource := range resourceTypes {
		if err = c.informerManager.RegisterResource(ctx, ctx.Connection, resource); err != nil {
			// don't fail - just log
			log.Printf("unable to register resource: %s", err.Error())
		}
	}

	// finally, start it
	return c.informerManager.StartConnection(ctx, connectionID)
}

// StopContextInformer signals to the listen runner to stop the informer for the given context.
func (c *resourceController[ClientT]) StopConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	if !c.withInformer {
		// safety guard just in case
		return nil
	}
	if err := c.connectionManager.InjectConnection(ctx, connectionID); err != nil {
		return fmt.Errorf("unable to inject connection: %w", err)
	}

	if err := c.informerManager.StopConnection(ctx, connectionID); err != nil {
		return fmt.Errorf("unable to stop connection: %w", err)
	}

	// remake the client
	return c.connectionManager.RefreshConnectionClient(ctx, connectionID)
}

// ListenForEvents listens for events from the informer and sends them to the given event channels.
// This method will block until the context is cancelled, and given this will block, the parent
// gRPC plugin host will spin this up in a goroutine.
func (c *resourceController[ClientT]) ListenForEvents(
	ctx *pkgtypes.PluginContext,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) error {
	if !c.withInformer {
		log.Println("informer not enabled")
		return nil
	}
	if err := c.informerManager.Run(c.stopChan, addChan, updateChan, deleteChan); err != nil {
		log.Println("error running informer manager:", err)
		return fmt.Errorf("error running informer manager: %w", err)
	}
	return nil
}

// ================================= Connection Methods ================================= //

// StartConnection starts a connection, initializing any informers as necessary.
func (c *resourceController[ClientT]) StartConnection(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) (pkgtypes.ConnectionStatus, error) {
	conn, err := c.connectionManager.StartConnection(ctx, connectionID)
	if err != nil {
		return conn, fmt.Errorf("unable to start connection: %w", err)
	}
	// don't start the informer if the connection is not connected and valid
	if conn.Status != pkgtypes.ConnectionStatusConnected {
		return conn, nil
	}

	// sync the resource types
	if err := c.resourceTypeManager.SyncConnection(ctx, conn.Connection); err != nil {
		conn.Status = pkgtypes.ConnectionStatusError
		conn.Error = err.Error()
		conn.Details = "Unable to sync connection"
		return conn, nil
	}

	// check if has informer. if so, start it
	return conn, c.StartConnectionInformer(ctx, connectionID)
}

// StopConnection stops a connection, stopping any informers as necessary.
func (c *resourceController[ClientT]) StopConnection(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) (pkgtypes.Connection, error) {
	if err := c.StopConnectionInformer(ctx, connectionID); err != nil {
		return pkgtypes.Connection{}, fmt.Errorf("unable to stop connection informer: %w", err)
	}
	return c.connectionManager.StopConnection(ctx, connectionID)
}

// LoadConnections calls the custom connection loader func to provide the the IDE the possible connections
// available.
func (c *resourceController[ClientT]) LoadConnections(
	ctx *pkgtypes.PluginContext,
) ([]pkgtypes.Connection, error) {
	return c.connectionManager.LoadConnections(ctx)
}

// ListConnections calls the custom connection loader func to provide the the IDE the possible connections.
func (c *resourceController[ClientT]) ListConnections(
	ctx *pkgtypes.PluginContext,
) ([]pkgtypes.Connection, error) {
	return c.connectionManager.ListConnections(ctx)
}

// GetConnection gets a connection by its ID.
func (c *resourceController[ClientT]) GetConnection(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) (pkgtypes.Connection, error) {
	return c.connectionManager.GetConnection(ctx, connectionID)
}

// GetConnectionNamespaces get's the list of namespaces for the connection.
func (c *resourceController[ClientT]) GetConnectionNamespaces(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) ([]string, error) {
	return c.connectionManager.GetConnectionNamespaces(ctx, connectionID)
}

// UpdateConnection updates a connection by its ID.
func (c *resourceController[ClientT]) UpdateConnection(
	ctx *pkgtypes.PluginContext,
	connection pkgtypes.Connection,
) (pkgtypes.Connection, error) {
	return c.connectionManager.UpdateConnection(ctx, connection)
}

// DeleteConnection deletes a connection by its ID.
func (c *resourceController[ClientT]) DeleteConnection(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	return c.connectionManager.DeleteConnection(ctx, connectionID)
}

// WatchConnections watches for connection changes.
func (c *resourceController[ClientT]) WatchConnections(
	ctx *pkgtypes.PluginContext,
	eventChan chan []pkgtypes.Connection,
) error {
	return c.connectionManager.WatchConnections(ctx, eventChan)
}

// ================================= Resource Type Methods ================================= //

// GetResourceGroups gets the resource groups available to the resource controller.
func (c *resourceController[ClientT]) GetResourceGroups(
	connID string,
) map[string]types.ResourceGroup {
	return c.resourceTypeManager.GetGroups(connID)
}

// GetResourceGroup gets the resource group by its name.
func (c *resourceController[ClientT]) GetResourceGroup(
	name string,
) (types.ResourceGroup, error) {
	return c.resourceTypeManager.GetGroup(name)
}

// GetResourceTypes gets the resource types available to the resource controller.
func (c *resourceController[ClientT]) GetResourceTypes(
	connID string,
) map[string]types.ResourceMeta {
	// switch this to be the other
	res, err := c.resourceTypeManager.GetConnectionResourceTypes(connID)
	if err != nil {
		return map[string]types.ResourceMeta{}
	}

	resources := make(map[string]types.ResourceMeta, len(res))
	for _, rm := range res {
		resources[rm.String()] = rm
	}

	return resources
}

// GetResourceType gets the resource type information by its string representation.
func (c *resourceController[ClientT]) GetResourceType(
	resource string,
) (*types.ResourceMeta, error) {
	return c.resourceTypeManager.GetResourceType(resource)
}

// HasResourceType checks to see if the resource type exists.
func (c *resourceController[ClientT]) HasResourceType(resource string) bool {
	return c.resourceTypeManager.HasResourceType(resource)
}

// GetResourceDefinition gets the resource definition for the resource type.
func (c *resourceController[ClientT]) GetResourceDefinition(
	resource string,
) (types.ResourceDefinition, error) {
	return c.resourceTypeManager.GetResourceDefinition(resource)
}

// ================================= Layout Methods ================================= //

func (c *resourceController[ClientT]) GetLayout(
	layoutID string,
) ([]types.LayoutItem, error) {
	return c.layoutManager.GetLayout(layoutID)
}

func (c *resourceController[ClientT]) GetDefaultLayout() ([]types.LayoutItem, error) {
	return c.layoutManager.GetDefaultLayout()
}

func (c *resourceController[ClientT]) SetLayout(
	id string,
	layout []types.LayoutItem,
) error {
	return c.layoutManager.SetLayout(id, layout)
}
