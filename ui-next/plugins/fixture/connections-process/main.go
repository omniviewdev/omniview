// The process behind the seam's connections fixture (`fixture-f-conn`, ui-next/plugins/fixture/build.mjs, `buildConnectionsProcess`): a plugin backend with a `resource` capability that serves TWO connections,
// so that the checks of the connection picker, the Home page and the palette have real connections to list, start and fail to start, in the real host. Each says a `Description` besides its name (the SDK's secondary
// text for a connection: the host lists the whole connection, and its Home and its picker draw the line under the name); `src/connection.test.ts` holds the page's copy of every fact stated here to this file.
//
//	north-57a082bd74   starts after about 300 ms (a "connecting" state is visible)
//	south-0c3d9e1f42   starts as the file `connection-mode` next to bin/ says: no file or `ok` starts it at once, `unauthorized` fails it
//	                   with the SDK's UNAUTHORIZED class, `unreachable` with its UNAVAILABLE class (the server did not answer),
//	                   `unreachable-path` with the same class and a sentence that names a path under a home directory (a sentence the
//	                   host never shows: it refuses it and says its own for the class, so a check can tell the plugin's text from the host's),
//	                   `hang` keeps the start waiting for 20 s (it ends at once when the host cancels it)
//
// The file is read on every start, so a check can change it between two presses. A failed start leaves the process running and both connections configured: the SDK keeps a failed start as FAILED until the
// next start or stop. One resource type, `fixture::v1::Item`, makes the controller valid; it lists three records whose names depend on the connection.
//
//nolint:exhaustruct // A fixture sets the fields its one resource type needs; the SDK's other fields take their zero values on purpose.
package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/activityscript"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// pluginID is the fixture plugin this process belongs to: the SDK refuses to start when it is not the id in the plugin.yaml next to the binary.
const pluginID = "fixture-f-conn"

const (
	northID = "north-57a082bd74"
	southID = "south-0c3d9e1f42"

	// northDescription and southDescription are what each connection says of itself besides its name: the SDK's `Description`, which the host passes through as `connection.description`.
	northDescription = "Fixture · region one"
	southDescription = "Fixture · region two"

	resourceType = "fixture::v1::Item"

	// connectionModeFile is the file in the plugin's own directory (next to bin/) that says how the south connection starts.
	connectionModeFile = "connection-mode"

	// northDelay is how long north takes to start.
	northDelay = 300 * time.Millisecond
	// hangFor is how long a start that was told to hang waits.
	hangFor = 20 * time.Second

	// unreachableWithPath is the sentence the `unreachable-path` mode fails with. The path in it is what the host's public-text rules refuse (a path
	// into a user's home directory), so none of this text may reach a window: the seam looks for `/Users/seam/.config/fixture/address` and `Its address is in`.
	unreachableWithPath = "The server did not answer. Its address is in /Users/seam/.config/fixture/address."

	// coverageComplete is the coverage every answer of this process says.
	coverageComplete = "complete"
)

// northLabels are the labels the process puts on north (the SDK's `Labels`, which the host passes through and a landing reads as `connection.labels`): two that are text, and a number, which the host leaves out because a label is text. South has
// none, which the host's list says as null.
func northLabels() map[string]any {
	const replicas = 3

	return map[string]any{"env": "fixture", "tier": "one", "replicas": replicas}
}

// itemsOf are the three records each connection lists, by connection ID; none for an ID the process does not serve.
func itemsOf(connection string) []string {
	switch connection {
	case northID:
		return []string{"orders-api", "ledger-sync", "billing-sync"}
	case southID:
		return []string{"harbor-gate", "tide-table", "keel-check"}
	}

	return nil
}

type client struct{ connection string }

func main() {
	controller, err := resource.NewController(resource.Config[client]{
		Catalog:       catalog,
		Registrations: []resource.Registration[client]{{Type: resourceType, Enumerate: enumerate, Get: get}},
		Lifecycle: &resource.Lifecycle[client]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{
					{ID: northID, Name: "north", Description: northDescription, Labels: northLabels()},
					{ID: southID, Name: "south", Description: southDescription},
				}, nil
			},
			CreateClient:  create,
			DestroyClient: func(context.Context, *client) error { return nil },
			CheckConnection: func(_ context.Context, connection types.Connection, _ *client) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{Connection: &connection, Status: types.ConnectionStatusConnected}, nil
			},
		},
	})
	if err != nil {
		panic(err)
	}
	defer controller.Close()

	plugin := sdk.NewPlugin(sdk.PluginOpts{ID: pluginID})
	plugin.RegisterCapability("resource", &resourceplugin.GRPCPlugin{Impl: controller, SettingsProvider: plugin.SettingsProvider})
	// Reports the activity the check scripts in the file `activity-script`, once the host has bound the reporter.
	defer activityscript.Start(plugin.Activities())()
	plugin.Serve()
}

// create is a start: north after its delay, south as the mode file says.
func create(ctx context.Context, connection types.Connection) (*client, error) {
	switch connection.ID {
	case northID:
		return wait(ctx, connection.ID, northDelay)
	case southID:
		switch connectionMode() {
		case "unauthorized":
			return nil, resource.NewError("UNAUTHORIZED", "The server refused the credentials.")
		case "unreachable":
			return nil, resource.NewError("UNAVAILABLE", "The server did not answer.")
		case "unreachable-path":
			return nil, resource.NewError("UNAVAILABLE", unreachableWithPath)
		case "hang":
			return wait(ctx, connection.ID, hangFor)
		}
		return &client{connection: connection.ID}, nil
	}
	return nil, resource.NewError("NOT_FOUND", "unknown connection")
}

// wait answers a client after `delay`, or the context's error when it ends first.
func wait(ctx context.Context, connection string, delay time.Duration) (*client, error) {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return &client{connection: connection}, nil
	}
}

// connectionMode is what the file next to bin/ says, "" when there is none.
func connectionMode() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}

	text, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "..", connectionModeFile))
	if err != nil {
		return ""
	}

	return strings.TrimSpace(string(text))
}

func representation() resource.Representation {
	return resource.Representation{ID: "native", Revision: "1"}
}

func catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	if err := ctx.Err(); err != nil {
		return resource.Catalog{}, err
	}
	if itemsOf(request.Route.Connection) == nil {
		return resource.Catalog{}, resource.NewError("NOT_FOUND", "unknown connection")
	}
	return resource.Catalog{Provider: pluginID, Revision: "1", Coverage: resource.Coverage{Kind: coverageComplete}, Types: []resource.ResourceType{{
		Type: resourceType, DisplayName: "Items",
		Representations: []resource.Representation{representation()}, DefaultRepresentation: "native",
		Capabilities: []resource.Capability{{Operation: resource.OperationEnumerate}, {Operation: resource.OperationGet}},
	}}}, nil
}

func record(target resource.ReadTarget, connection, name string) (resource.Record, error) {
	bodyJSON, err := json.Marshal(map[string]string{"name": name, "connection": connection})
	if err != nil {
		return resource.Record{}, err
	}
	body, err := resource.JSONToValue(bodyJSON)
	if err != nil {
		return resource.Record{}, err
	}
	return resource.Record{
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: name}},
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
	names := itemsOf(input.Target.Route.Connection)
	records := make([]resource.Record, 0, len(names))
	for _, name := range names {
		item, err := record(input.Target, input.Target.Route.Connection, name)
		if err != nil {
			return resource.SourcePage{}, err
		}
		records = append(records, item)
	}
	count := "3"
	return resource.SourcePage{Records: records, Count: resource.Count{Kind: "exact", Value: &count}, Coverage: resource.Coverage{Kind: coverageComplete}, Consistency: "bestEffort"}, nil
}

func get(ctx context.Context, _ *client, input resource.GetRequest) (resource.Record, error) {
	if err := ctx.Err(); err != nil {
		return resource.Record{}, err
	}
	address := input.Reference.Address
	for _, name := range itemsOf(input.Route.Connection) {
		if name == address.ID && address.Type == resourceType {
			return record(resource.ReadTarget{Route: input.Route, Provider: address.Provider, Authority: address.Authority, Type: address.Type, Representation: input.Representation}, input.Route.Connection, name)
		}
	}
	return resource.Record{}, resource.NewError("NOT_FOUND", "unknown record")
}
