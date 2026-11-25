// The process behind the seam's ports fixture (`fixture-g-ports`, ui-next/plugins/fixture/build.mjs, `buildPortsProcess`): a plugin backend with the `networker` capability, which forwards a local port to a target server of its
// own, so that the seam can start a real port forward from a page of the plugin, in the real host, connect to its local port, read what the target says and watch the forward end when it is stopped or the plugin is.
//
// The target and the forwarder are the package `portforward` of this directory's parent: a TCP server on the loopback that sends the line `PF1-FIXTURE-HELLO` to every connection and echoes the rest, and a forwarder that
// relays to it. The plugin serves them, and nothing else of its own, but what the host needs to start a forward at all:
//
//	harbor-9c41e07ab2   the one connection, which starts at once. The host resolves the connection a forward belongs to (it fails a start for a plugin that has none), and the SDK starts a forward on a connection that is started
//	                    only: a page opened by a link to this one before it is started is refused with the SDK's CONNECTION_ERROR class, in words the page can show.
//
// One resource type, `fixture::v1::Target`, makes the controller valid; it lists the one record the forwarder knows, `fixture-target`.
//
//nolint:exhaustruct // A fixture sets the fields its one resource type needs; the SDK's other fields take their zero values on purpose.
package main

import (
	"context"
	"encoding/json"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/portforward"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// pluginID is the fixture plugin this process belongs to: the SDK refuses to start when it is not the id in the plugin.yaml next to the binary.
const pluginID = "fixture-g-ports"

const (
	// connectionID is the key of the plugin's one connection, made the way the host's own are (`<name>-<10 hex>`): a route carries it, and the window says its name.
	connectionID   = "harbor-9c41e07ab2"
	connectionName = "harbor"

	resourceType = "fixture::v1::Target"

	// coverageComplete is the coverage every answer of this process says.
	coverageComplete = "complete"
)

type client struct{}

// fixtureController is the resource controller of this process: its one connection and its one record.
type fixtureController = resource.Controller[client]

func main() {
	target, err := portforward.NewServer()
	if err != nil {
		panic(err)
	}
	defer func() { _ = target.Close() }()

	controller, err := newController()
	if err != nil {
		panic(err)
	}
	defer func() { _ = controller.Close() }()

	plugin := sdk.NewPlugin(sdk.PluginOpts{ID: pluginID})
	if err = register(plugin, controller, target); err != nil {
		panic(err)
	}
	plugin.Serve()
}

// register gives the plugin its two capabilities. The SDK binds the networker's forwards to the controller's connections when both are registered, in either order.
func register(plugin *sdk.Plugin, controller *fixtureController, target *portforward.Server) error {
	plugin.RegisterCapability("resource", &resourceplugin.GRPCPlugin{Impl: controller, SettingsProvider: plugin.SettingsProvider})

	return portforward.Register(plugin, target)
}

func newController() (*fixtureController, error) {
	return resource.NewController(resource.Config[client]{
		Catalog:       catalog,
		Registrations: []resource.Registration[client]{{Type: resourceType, Enumerate: enumerate, Get: get}},
		Lifecycle: &resource.Lifecycle[client]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{{ID: connectionID, Name: connectionName}}, nil
			},
			CreateClient:  func(context.Context, types.Connection) (*client, error) { return &client{}, nil },
			DestroyClient: func(context.Context, *client) error { return nil },
			CheckConnection: func(_ context.Context, connection types.Connection, _ *client) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{Connection: &connection, Status: types.ConnectionStatusConnected}, nil
			},
		},
	})
}

func representation() resource.Representation {
	return resource.Representation{ID: "native", Revision: "1"}
}

func catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	if err := ctx.Err(); err != nil {
		return resource.Catalog{}, err
	}
	if request.Route.Connection != connectionID {
		return resource.Catalog{}, resource.NewError("NOT_FOUND", "unknown connection")
	}

	return resource.Catalog{Provider: pluginID, Revision: "1", Coverage: resource.Coverage{Kind: coverageComplete}, Types: []resource.ResourceType{{
		Type: resourceType, DisplayName: "Targets",
		Representations: []resource.Representation{representation()}, DefaultRepresentation: "native",
		Capabilities: []resource.Capability{{Operation: resource.OperationEnumerate}, {Operation: resource.OperationGet}},
	}}}, nil
}

func record(target resource.ReadTarget) (resource.Record, error) {
	bodyJSON, err := json.Marshal(map[string]string{"name": portforward.TargetID})
	if err != nil {
		return resource.Record{}, err
	}
	body, err := resource.JSONToValue(bodyJSON)
	if err != nil {
		return resource.Record{}, err
	}

	return resource.Record{
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: portforward.TargetID}},
		Body:      body, Representation: representation(), Coverage: resource.Coverage{Kind: coverageComplete},
	}, nil
}

func enumerate(ctx context.Context, _ *client, input resource.EnumerateRequest) (resource.SourcePage, error) {
	if err := ctx.Err(); err != nil {
		return resource.SourcePage{}, err
	}
	if input.Cursor != nil {
		return resource.SourcePage{}, resource.NewError("INVALID_REQUEST", "no continuation cursor")
	}
	item, err := record(input.Target)
	if err != nil {
		return resource.SourcePage{}, err
	}
	count := "1"

	return resource.SourcePage{Records: []resource.Record{item}, Count: resource.Count{Kind: "exact", Value: &count}, Coverage: resource.Coverage{Kind: coverageComplete}, Consistency: "bestEffort"}, nil
}

func get(ctx context.Context, _ *client, input resource.GetRequest) (resource.Record, error) {
	if err := ctx.Err(); err != nil {
		return resource.Record{}, err
	}
	address := input.Reference.Address
	if address.ID != portforward.TargetID || address.Type != resourceType {
		return resource.Record{}, resource.NewError("NOT_FOUND", "unknown record")
	}

	return record(resource.ReadTarget{Route: input.Route, Provider: address.Provider, Authority: address.Authority, Type: address.Type, Representation: input.Representation})
}
