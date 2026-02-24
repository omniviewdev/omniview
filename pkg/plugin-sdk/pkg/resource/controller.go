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
	syncPolicies map[string]types.InformerSyncPolicy,
	schemaFunc func(*pkgtypes.PluginContext, *ClientT) ([]types.EditorSchema, error),
	errorClassifier func(error) error,
) types.ResourceProvider {
	controller := &resourceController[ClientT]{
		stopChan:            make(chan struct{}),
		resourcerManager:    resourcerManager,
		connectionManager:   connectionManager,
		resourceTypeManager: resourceTypeManager,
		layoutManager:       layoutManager,
		schemaFunc:          schemaFunc,
		errorClassifier:     errorClassifier,
		syncPolicies:        syncPolicies,
	}
	if createInformerFunc != nil {
		controller.withInformer = true
		controller.addChan = make(chan types.InformerAddPayload)
		controller.updateChan = make(chan types.InformerUpdatePayload)
		controller.deleteChan = make(chan types.InformerDeletePayload)
		controller.stateChan = make(chan types.InformerStateEvent)
		controller.informerManager = services.NewInformerManager(
			createInformerFunc,
			syncPolicies,
			controller.addChan,
			controller.updateChan,
			controller.deleteChan,
			controller.stateChan,
		)
	}
	return controller
}

type resourceController[ClientT any] struct {
	resourcerManager    services.ResourcerManager[ClientT]
	connectionManager   services.ConnectionManager[ClientT]
	resourceTypeManager services.ResourceTypeManager
	layoutManager       services.LayoutManager
	schemaFunc          func(*pkgtypes.PluginContext, *ClientT) ([]types.EditorSchema, error)
	errorClassifier     func(error) error
	syncPolicies        map[string]types.InformerSyncPolicy
	stopChan            chan struct{}
	informerManager     *services.InformerManager[ClientT]
	addChan             chan types.InformerAddPayload
	updateChan          chan types.InformerUpdatePayload
	deleteChan          chan types.InformerDeletePayload
	stateChan           chan types.InformerStateEvent
	withInformer        bool
}

// ClassifyResourceError delegates to the plugin's error classifier if one was provided.
// This satisfies the types.ResourceErrorClassifier interface so the gRPC server can
// type-assert and use it.
func (c *resourceController[ClientT]) ClassifyResourceError(err error) error {
	if c.errorClassifier != nil {
		return c.errorClassifier(err)
	}
	return nil
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

// ensureInformer triggers a lazy informer start for SyncOnFirstQuery resources.
func (c *resourceController[ClientT]) ensureInformer(ctx *pkgtypes.PluginContext, resource string) {
	if c.withInformer && ctx.Connection != nil {
		_ = c.informerManager.EnsureResource(ctx.Connection.ID, resource)
	}
}

// ================================= Operation Methods ================================= //

// Get gets a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT]) Get(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.GetInput,
) (*types.GetResult, error) {
	c.ensureInformer(ctx, resource)
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
	c.ensureInformer(ctx, resource)
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
	c.ensureInformer(ctx, resource)
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

// StartConnectionInformer signals to the listen runner to start the informer for the given context.
func (c *resourceController[ClientT]) StartConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	if !c.withInformer {
		return nil
	}

	// Already running — no-op to make StartConnection idempotent
	if c.informerManager.HasInformer(ctx, connectionID) {
		return nil
	}

	if err := c.connectionManager.InjectConnection(ctx, connectionID); err != nil {
		return fmt.Errorf("unable to inject connection: %w", err)
	}
	client, err := c.connectionManager.GetConnectionClient(ctx, connectionID)
	if err != nil {
		return fmt.Errorf("unable to get connection client: %w", err)
	}

	if err = c.informerManager.CreateConnectionInformer(ctx, ctx.Connection, client); err != nil {
		return err
	}

	resourceTypes := c.GetResourceTypes(connectionID)
	log.Println("got resource types in StartConnectionInformer: ", resourceTypes)
	for key, resource := range resourceTypes {
		policy := c.syncPolicies[key] // defaults to SyncOnConnect (zero value)
		if err = c.informerManager.RegisterResource(ctx, ctx.Connection, resource, policy); err != nil {
			log.Printf("unable to register resource: %s", err.Error())
		}
	}

	return c.informerManager.StartConnection(ctx, connectionID)
}

// StopConnectionInformer signals to the listen runner to stop the informer for the given context.
func (c *resourceController[ClientT]) StopConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	if !c.withInformer {
		return nil
	}

	// Not running — no-op to make StopConnection idempotent
	if !c.informerManager.HasInformer(ctx, connectionID) {
		return nil
	}

	if err := c.connectionManager.InjectConnection(ctx, connectionID); err != nil {
		return fmt.Errorf("unable to inject connection: %w", err)
	}

	if err := c.informerManager.StopConnection(ctx, connectionID); err != nil {
		return fmt.Errorf("unable to stop connection: %w", err)
	}

	return c.connectionManager.RefreshConnectionClient(ctx, connectionID)
}

// ListenForEvents listens for events from the informer and sends them to the given event channels.
func (c *resourceController[ClientT]) ListenForEvents(
	ctx *pkgtypes.PluginContext,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
	stateChan chan types.InformerStateEvent,
) error {
	if !c.withInformer {
		log.Println("informer not enabled")
		return nil
	}
	if err := c.informerManager.Run(c.stopChan, addChan, updateChan, deleteChan, stateChan); err != nil {
		log.Println("error running informer manager:", err)
		return fmt.Errorf("error running informer manager: %w", err)
	}
	return nil
}

// GetInformerState returns a snapshot of all resource informer states for a connection.
func (c *resourceController[ClientT]) GetInformerState(
	_ *pkgtypes.PluginContext,
	connectionID string,
) (*types.InformerConnectionSummary, error) {
	if !c.withInformer {
		return nil, nil
	}
	return c.informerManager.GetConnectionState(connectionID)
}

// EnsureInformerForResource triggers lazy start for SyncOnFirstQuery resources.
func (c *resourceController[ClientT]) EnsureInformerForResource(
	_ *pkgtypes.PluginContext,
	connectionID string,
	resourceKey string,
) error {
	if !c.withInformer {
		return nil
	}
	return c.informerManager.EnsureResource(connectionID, resourceKey)
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
	if conn.Status != pkgtypes.ConnectionStatusConnected {
		return conn, nil
	}

	if err := c.resourceTypeManager.SyncConnection(ctx, conn.Connection); err != nil {
		conn.Status = pkgtypes.ConnectionStatusError
		conn.Error = err.Error()
		conn.Details = "Unable to sync connection"
		return conn, nil
	}

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

// LoadConnections calls the custom connection loader func.
func (c *resourceController[ClientT]) LoadConnections(
	ctx *pkgtypes.PluginContext,
) ([]pkgtypes.Connection, error) {
	return c.connectionManager.LoadConnections(ctx)
}

// ListConnections calls the custom connection loader func.
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

func (c *resourceController[ClientT]) GetResourceGroups(
	connID string,
) map[string]types.ResourceGroup {
	return c.resourceTypeManager.GetGroups(connID)
}

func (c *resourceController[ClientT]) GetResourceGroup(
	name string,
) (types.ResourceGroup, error) {
	return c.resourceTypeManager.GetGroup(name)
}

func (c *resourceController[ClientT]) GetResourceTypes(
	connID string,
) map[string]types.ResourceMeta {
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

func (c *resourceController[ClientT]) GetResourceType(
	resource string,
) (*types.ResourceMeta, error) {
	return c.resourceTypeManager.GetResourceType(resource)
}

func (c *resourceController[ClientT]) HasResourceType(resource string) bool {
	return c.resourceTypeManager.HasResourceType(resource)
}

func (c *resourceController[ClientT]) GetResourceDefinition(
	resource string,
) (types.ResourceDefinition, error) {
	return c.resourceTypeManager.GetResourceDefinition(resource)
}

// ================================= Action Methods ================================= //

func (c *resourceController[ClientT]) GetActions(
	ctx *pkgtypes.PluginContext,
	resource string,
) ([]types.ActionDescriptor, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, nil
	}
	ar, ok := resourcer.(types.ActionResourcer[ClientT])
	if !ok {
		return nil, nil
	}
	return ar.GetActions(ctx, client, types.ResourceMetaFromString(resource))
}

func (c *resourceController[ClientT]) ExecuteAction(
	ctx *pkgtypes.PluginContext,
	resource string,
	actionID string,
	input types.ActionInput,
) (*types.ActionResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	ar, ok := resourcer.(types.ActionResourcer[ClientT])
	if !ok {
		return nil, fmt.Errorf("resource type %s does not support actions", resource)
	}
	return ar.ExecuteAction(ctx, client, types.ResourceMetaFromString(resource), actionID, input)
}

func (c *resourceController[ClientT]) StreamAction(
	ctx *pkgtypes.PluginContext,
	resource string,
	actionID string,
	input types.ActionInput,
	stream chan types.ActionEvent,
) error {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	ar, ok := resourcer.(types.ActionResourcer[ClientT])
	if !ok {
		return fmt.Errorf("resource type %s does not support streaming actions", resource)
	}
	return ar.StreamAction(ctx, client, types.ResourceMetaFromString(resource), actionID, input, stream)
}

// ================================= Schema Methods ================================= //

func (c *resourceController[ClientT]) GetEditorSchemas(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) ([]types.EditorSchema, error) {
	if err := c.connectionManager.InjectConnection(ctx, connectionID); err != nil {
		return nil, fmt.Errorf("unable to inject connection: %w", err)
	}

	client, err := c.connectionManager.GetConnectionClient(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("unable to get client for schema generation: %w", err)
	}

	var schemas []types.EditorSchema

	if c.schemaFunc != nil {
		s, err := c.schemaFunc(ctx, client)
		if err != nil {
			log.Printf("connection-level schema func error for %s: %s", connectionID, err)
		} else {
			schemas = append(schemas, s...)
		}
	}

	for key, resourcer := range c.resourcerManager.GetResourcers() {
		sr, ok := resourcer.(types.SchemaResourcer[ClientT])
		if !ok {
			continue
		}
		s, err := sr.GetEditorSchemas(ctx, client, types.ResourceMetaFromString(key))
		if err != nil {
			log.Printf("unable to get editor schemas for %s: %s", key, err)
			continue
		}
		schemas = append(schemas, s...)
	}
	return schemas, nil
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
