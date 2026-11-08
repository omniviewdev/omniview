// Testbench is a test-only provider. It never contacts external services.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/state"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

const (
	pluginID     = "testbench"
	connectionID = "isolated"
	resourceType = "testbench::v1::Diagnostics"
)

type client struct{}
type provider struct {
	mu    sync.Mutex
	delay time.Duration
}

func main() {
	// Refuse production fallback, including during discovery, before SDK startup.
	if os.Getenv(state.WorkspaceFileEnvironment) == "" || os.Getenv(state.StateDirectoryEnvironment) == "" {
		panic("testbench requires an isolated development workspace and state root")
	}
	if _, err := state.ResolveRoot(); err != nil {
		panic(err)
	}
	p := &provider{}
	if value := os.Getenv("OMNIVIEW_TESTBENCH_CONNECTION_DELAY"); value != "" {
		delay, err := time.ParseDuration(value)
		if err != nil || delay < 0 {
			panic("OMNIVIEW_TESTBENCH_CONNECTION_DELAY must be a non-negative Go duration")
		}
		p.delay = delay
	}
	controller, err := resource.NewController(resource.Config[client]{
		Catalog:       p.catalog,
		Registrations: []resource.Registration[client]{{Connection: connectionID, Type: resourceType, Enumerate: p.enumerate, Get: p.get}},
		Lifecycle: &resource.Lifecycle[client]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{{ID: connectionID, Name: "Test-only isolated testbench"}}, nil
			},
			CreateClient:  p.connect,
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
	plugin.Serve()
}

func (p *provider) connect(ctx context.Context, connection types.Connection) (*client, error) {
	if connection.ID != connectionID {
		return nil, resource.NewError("NOT_FOUND", "unknown testbench connection")
	}
	timer := time.NewTimer(p.delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return &client{}, nil
	}
}

func representation() resource.Representation {
	return resource.Representation{ID: "native", Revision: "1", Schema: resource.SchemaBinding{State: "absent"}}
}

func (p *provider) catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	if err := ctx.Err(); err != nil {
		return resource.Catalog{}, err
	}
	if request.Route.Connection != connectionID {
		return resource.Catalog{}, resource.NewError("NOT_FOUND", "unknown testbench connection")
	}
	return resource.Catalog{Provider: pluginID, Revision: "1", Coverage: resource.Coverage{Kind: "complete"}, Types: []resource.ResourceType{{
		Type: resourceType, DisplayName: "Test-only state diagnostics",
		Representations: []resource.Representation{representation()}, DefaultRepresentation: "native",
		Capabilities: []resource.Capability{{Operation: resource.OperationEnumerate}, {Operation: resource.OperationGet}},
	}}}, nil
}

// Each read proves access by updating and reading back a private state file and
// an SDK capability store. Errors propagate; no synthetic success is returned.
func (p *provider) diagnostics(ctx context.Context, target resource.ReadTarget) (resource.Record, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return resource.Record{}, err
	}
	root, err := state.ResolveRoot()
	if err != nil {
		return resource.Record{}, err
	}
	pluginRoot, err := state.OpenPluginRoot(pluginID)
	if err != nil {
		return resource.Record{}, err
	}
	defer pluginRoot.Close()
	dataRoot, err := state.OpenDirectory(pluginRoot, "data", true)
	if err != nil {
		return resource.Record{}, err
	}
	defer dataRoot.Close()
	if err := state.RejectSymlink(dataRoot, "testbench-state"); err != nil {
		return resource.Record{}, err
	}
	file, err := dataRoot.OpenFile("testbench-state", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return resource.Record{}, err
	}
	defer file.Close()
	stateCount, err := increment(file)
	if err != nil {
		return resource.Record{}, fmt.Errorf("state read/write: %w", err)
	}
	store, err := utils.GetStore("testbench", pluginID)
	if err != nil {
		return resource.Record{}, err
	}
	defer store.Close()
	storeCount, err := increment(store)
	if err != nil {
		return resource.Record{}, fmt.Errorf("storage read/write: %w", err)
	}
	storePath, err := utils.GetPluginStorePath(pluginID)
	if err != nil {
		return resource.Record{}, err
	}
	bodyJSON, err := json.Marshal(map[string]any{
		"testOnly": true, "pluginID": pluginID, "sdkVersion": "v0.16.0",
		"capabilities": []string{"resource"}, "operations": []string{"enumerate", "get"},
		"stateIsolationContract": config.StateIsolationCapability,
		"stateRoot":              root, "pluginRoot": pluginRoot.Name(), "dataRoot": dataRoot.Name(), "storageRoot": storePath,
		"stateReadWrite": true, "storageReadWrite": true,
		"stateCounter": stateCount, "storageCounter": storeCount,
		"connectionStartDelay": p.delay.String(),
	})
	if err != nil {
		return resource.Record{}, err
	}
	body, err := resource.JSONToValue(bodyJSON)
	if err != nil {
		return resource.Record{}, err
	}
	return resource.Record{
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: "diagnostics"}},
		Body:      body, Representation: representation(), Coverage: resource.Coverage{Kind: "complete"},
	}, nil
}

func increment(file *os.File) (string, error) {
	data, err := io.ReadAll(io.LimitReader(file, 64))
	if err != nil {
		return "", err
	}
	var count uint64
	if len(data) != 0 {
		if err := json.Unmarshal(data, &count); err != nil {
			return "", err
		}
	}
	if count == ^uint64(0) {
		return "", fmt.Errorf("testbench counter exhausted")
	}
	value := fmt.Sprint(count + 1)
	if err := file.Truncate(0); err != nil {
		return "", err
	}
	if _, err := file.WriteAt([]byte(value), 0); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	readback := make([]byte, len(value))
	if _, err := file.ReadAt(readback, 0); err != nil {
		return "", err
	}
	if string(readback) != value {
		return "", fmt.Errorf("testbench readback mismatch")
	}
	return value, nil
}

func (p *provider) enumerate(ctx context.Context, _ *client, input resource.EnumerateRequest) (resource.SourcePage, error) {
	if input.Cursor != nil {
		return resource.SourcePage{}, resource.NewError("INVALID_REQUEST", "testbench has no continuation cursor")
	}
	record, err := p.diagnostics(ctx, input.Target)
	if err != nil {
		return resource.SourcePage{}, err
	}
	count := "1"
	return resource.SourcePage{Records: []resource.Record{record}, Count: resource.Count{Kind: "exact", Value: &count}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
}

func (p *provider) get(ctx context.Context, _ *client, input resource.GetRequest) (resource.Record, error) {
	address := input.Reference.Address
	if address.ID != "diagnostics" || address.Type != resourceType || len(address.Scope) != 0 || input.Reference.Incarnation != nil {
		return resource.Record{}, resource.NewError("NOT_FOUND", "unknown testbench record")
	}
	return p.diagnostics(ctx, resource.ReadTarget{Route: input.Route, Provider: address.Provider, Authority: address.Authority, Type: address.Type, Representation: input.Representation})
}
