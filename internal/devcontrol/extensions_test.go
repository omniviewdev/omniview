//go:build devcontrol

package devcontrol

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/omniviewdev/omniview/backend/extensiondiagnostics"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

type extensionQueryFunc func(context.Context, string, string, extensiondiagnostics.Options) (json.RawMessage, error)

func (f extensionQueryFunc) Query(ctx context.Context, window, operation string, options extensiondiagnostics.Options) (json.RawMessage, error) {
	return f(ctx, window, operation, options)
}

func (f extensionQueryFunc) Windows(context.Context) ([]extensiondiagnostics.RuntimeInfo, error) {
	return []extensiondiagnostics.RuntimeInfo{{WindowName: "browser-3"}}, nil
}

func TestExtensionsAuthenticatedDispatchFiltersAndLookup(t *testing.T) {
	s, _, _ := fixtureServer(t)
	calls := 0
	s.adapters.Extensions = extensionQueryFunc(func(ctx context.Context, window, operation string, options extensiondiagnostics.Options) (json.RawMessage, error) {
		calls++
		if _, ok := ctx.Deadline(); !ok {
			t.Error("query has no deadline")
		}
		if calls == 1 && (window != "main" || operation != "snapshot" || options.PluginID != "plugin" || options.PointID != "point" || !options.IssuesOnly || options.IncludeSensitive) {
			t.Errorf("snapshot options: %s %s %+v", window, operation, options)
		}
		if calls == 2 && (window != "w-second" || operation != "lookup" || options.ResourceKey != "resource" || !options.IncludeSensitive) {
			t.Errorf("lookup options: %s %s %+v", window, operation, options)
		}
		return json.RawMessage(`{"schemaVersion":1,"windowName":"` + window + `"}`), nil
	})
	response := send(t, s, "extensions.inspect", map[string]any{"pluginId": "plugin", "pointId": "point", "issuesOnly": true}, nil)
	if response.Status != "succeeded" || response.OperationID != "" || calls != 1 {
		t.Fatalf("inspect dispatch: %+v calls=%d", response, calls)
	}
	response = send(t, s, "extensions.lookup", map[string]any{"windowName": "w-second", "pointId": "point", "pluginId": "plugin", "resourceKey": "resource", "includeSensitive": true, "timeoutMS": 1000}, nil)
	if response.Status != "succeeded" || calls != 2 {
		t.Fatalf("lookup dispatch: %+v calls=%d", response, calls)
	}
	for _, change := range []func(*http.Request, *devcontract.Request){
		func(r *http.Request, _ *devcontract.Request) { r.Header.Set("Authorization", "Bearer wrong") },
		func(_ *http.Request, r *devcontract.Request) { r.Generation = "stale" },
	} {
		response = send(t, s, "extensions.inspect", EmptyParams{}, change)
		if response.Status != "failed" || calls != 2 {
			t.Fatalf("identity fence bypassed: %+v calls=%d", response, calls)
		}
	}
}

func TestExtensionsStrictSchemaUnavailableAndCancellation(t *testing.T) {
	s, _, _ := fixtureServer(t)
	response := send(t, s, "extensions.inspect", EmptyParams{}, nil)
	if response.Error == nil || response.Error.Code != "extensions_unavailable" {
		t.Fatalf("missing runtime: %+v", response)
	}
	for _, test := range []struct {
		operation string
		params    map[string]any
	}{
		{"extensions.lookup", map[string]any{"pointId": "point", "pluginId": "plugin"}},
		{"extensions.inspect", map[string]any{"script": "alert(1)"}},
		{"extensions.inspect", map[string]any{"timeoutMS": -1}},
		{"extensions.inspect", map[string]any{"timeoutMS": 30001}},
		{"extensions.inspect", map[string]any{"resourceKey": "resource"}},
		{"extensions.lookup", map[string]any{"pointId": "point", "pluginId": "plugin", "resourceKey": "resource", "issuesOnly": true}},
	} {
		response = send(t, s, test.operation, test.params, nil)
		if response.Error == nil || response.Error.Code != "invalid_params" {
			t.Fatalf("invalid query accepted: %+v", response)
		}
	}
	s.adapters.Extensions = extensionQueryFunc(func(ctx context.Context, _, _ string, _ extensiondiagnostics.Options) (json.RawMessage, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	response = send(t, s, "extensions.inspect", map[string]any{"timeoutMS": 1}, nil)
	if response.Error == nil || response.Error.Code != "timeout" {
		t.Fatalf("timeout: %+v", response)
	}
	s.cancel()
	response = send(t, s, "extensions.inspect", EmptyParams{}, nil)
	if response.Status != "failed" {
		t.Fatalf("host shutdown did not cancel query: %+v", response)
	}
}

func TestExtensionsUnsupportedLookupHasSafeDistinctCode(t *testing.T) {
	s, _, _ := fixtureServer(t)
	s.adapters.Extensions = extensionQueryFunc(func(context.Context, string, string, extensiondiagnostics.Options) (json.RawMessage, error) {
		return nil, extensiondiagnostics.ErrUnsupported
	})
	response := send(t, s, "extensions.lookup", map[string]any{"pointId": "unsupported", "pluginId": "plugin", "resourceKey": "resource"}, nil)
	if response.Error == nil || response.Error.Code != "extensions_unsupported" || errorExit(response.Error.Code) != 2 {
		t.Fatalf("unsupported lookup: %+v", response)
	}
}

func TestExtensionsWindowsAuthenticatedDiscovery(t *testing.T) {
	s, _, _ := fixtureServer(t)
	s.adapters.Extensions = extensionQueryFunc(nil)
	response := send(t, s, "extensions.windows", EmptyParams{}, nil)
	var windows []extensiondiagnostics.RuntimeInfo
	if response.Status != "succeeded" || json.Unmarshal(response.Result, &windows) != nil || len(windows) != 1 || windows[0].WindowName != "browser-3" {
		t.Fatalf("runtime discovery: %+v", response)
	}
	response = send(t, s, "extensions.windows", map[string]any{"script": "eval"}, nil)
	if response.Error == nil || response.Error.Code != "invalid_params" {
		t.Fatalf("discovery accepted arbitrary parameters: %+v", response)
	}
	response = send(t, s, "extensions.windows", EmptyParams{}, func(request *http.Request, _ *devcontract.Request) {
		request.Header.Set("Authorization", "Bearer wrong")
	})
	if response.Error == nil || response.Error.Code != "unauthorized" {
		t.Fatalf("unauthorized runtime discovery: %+v", response)
	}
}
