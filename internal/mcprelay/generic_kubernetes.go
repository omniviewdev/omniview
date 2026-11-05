package mcprelay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// genericKubernetesOperation identifies a catalog operation without trusting a
// caller to supply provider bindings, target authority, or capability metadata.
type genericKubernetesOperation struct {
	name, group, operation, verb string
	readOnly                     bool
	selector                     string
	routeLane                    bool
}

var genericKubernetesOperations = []genericKubernetesOperation{
	{name: "catalog", group: "discover", operation: "resource.Catalog", readOnly: true, routeLane: true},
	{name: "get", group: "read", operation: "resource.Get", readOnly: true},
	{name: "enumerate", group: "read", operation: "resource.Enumerate", readOnly: true},
	{name: "native_query", group: "read", operation: "resource.NativeQuery", readOnly: true, selector: "language"},
	{name: "create", group: "write", operation: "resource.Mutate", verb: "create"},
	{name: "update", group: "write", operation: "resource.Mutate", verb: "update"},
	{name: "delete", group: "write", operation: "resource.Mutate", verb: "delete"},
	{name: "action", group: "action", operation: "resource.Action", selector: "action"},
	{name: "scope_values", group: "discover", operation: "resource.ScopeValues", readOnly: true, routeLane: true},
	{name: "events", group: "telemetry", operation: opGetResourceEvents, readOnly: true, routeLane: true},
	{name: "health", group: "telemetry", operation: opGetHealth, readOnly: true, routeLane: true},
	{name: "related", group: "read", operation: opGraphRelated, readOnly: true, routeLane: true},
	{name: "metrics", group: "telemetry", operation: opMetricQuery, readOnly: true},
	{name: "logs", group: "telemetry", operation: "logs.CreateSession", readOnly: true},
}

var genericKubernetesGroups = []string{"discover", "read", "write", "action", "telemetry"}

// Keep these private so published descriptors cannot mutate the identity check.
var genericKubernetesExpected = genericKubernetesTools()

func genericKubernetesTools() []ToolInfo {
	out := make([]ToolInfo, 0, len(genericKubernetesGroups))
	for _, group := range genericKubernetesGroups {
		properties := map[string]any{
			"connection_id": map[string]any{"type": "string", "minLength": 1},
			"operation":     map[string]any{"type": "string"},
			"resource_type": map[string]any{"type": "string", "minLength": 1, "description": "Exact resource type from the Kubernetes resource catalog."},
			"arguments":     map[string]any{"type": "object", "description": "Arguments for the selected live resource tool, excluding connection_id."},
		}
		var alternatives []any
		for _, op := range genericKubernetesOperations {
			if op.group != group {
				continue
			}
			required := []string{"operation"}
			if op.operation != "resource.ScopeValues" && op.operation != "resource.Catalog" {
				required = append(required, "resource_type")
			}
			if op.selector != "" {
				properties[op.selector] = map[string]any{"type": "string", "minLength": 1}
				required = append(required, op.selector)
			}
			alternatives = append(alternatives, map[string]any{
				"properties": map[string]any{"operation": map[string]any{"const": op.name}},
				"required":   required,
			})
		}
		readOnly := group != "write" && group != "action"
		name := "kubernetes_resource_" + group
		out = append(out, ToolInfo{
			MCPName: name, PluginID: "kubernetes", PluginName: "Kubernetes", Name: "resource_" + group,
			Title:       "Kubernetes resource " + group,
			Description: "Call kubernetes_resource_discover with operation catalog to discover live types, operations and argument schemas. Start the selected connection if needed, then invoke the matching advertised operation. Resource references retain their catalog authority.",
			Scope:       ScopeConnection, ReadOnly: readOnly, Destructive: !readOnly,
			Idempotent: readOnly, OpenWorld: true, Status: StatusOK,
			InputSchema: map[string]any{"type": "object", "properties": properties, "required": []string{"connection_id", "operation", "arguments"}, "oneOf": alternatives, "additionalProperties": false},
		})
	}
	return out
}

func genericKubernetesOperationFor(t ToolInfo) (genericKubernetesOperation, bool) {
	if t.PluginID != "kubernetes" || t.Resource != nil || t.BuiltIn {
		return genericKubernetesOperation{}, false
	}
	for i, expected := range genericKubernetesExpected {
		if reflect.DeepEqual(t, expected) {
			return genericKubernetesOperation{group: genericKubernetesGroups[i]}, true
		}
	}
	return genericKubernetesOperation{}, false
}

func isGenericKubernetesTool(t ToolInfo) bool {
	_, ok := genericKubernetesOperationFor(t)
	return ok
}

func genericKubernetesSelectedOperation(group string, raw []byte) (genericKubernetesOperation, error) {
	var selection struct {
		Operation string `json:"operation"`
	}
	if err := json.Unmarshal(raw, &selection); err != nil {
		return genericKubernetesOperation{}, err
	}
	for _, candidate := range genericKubernetesOperations {
		if candidate.group == group && candidate.name == selection.Operation {
			return candidate, nil
		}
	}
	return genericKubernetesOperation{}, errors.New("invalid operation")
}

type genericKubernetesArguments struct {
	Operation    string          `json:"operation"`
	ResourceType string          `json:"resource_type"`
	Arguments    json.RawMessage `json:"arguments"`
	Language     string          `json:"language"`
	Action       string          `json:"action"`
}

func parseGenericKubernetesArguments(op genericKubernetesOperation, raw []byte) (genericKubernetesArguments, error) {
	var request genericKubernetesArguments
	if err := rejectDuplicateFields(raw); err != nil {
		return request, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if request.Operation != op.name {
		return request, errors.New("invalid operation")
	}
	if len(request.Arguments) == 0 || string(request.Arguments) == "null" {
		return request, errors.New("arguments must be an object")
	}
	if request.ResourceType == "" && op.operation != "resource.ScopeValues" && op.operation != "resource.Catalog" {
		return request, errors.New("resource_type is required")
	}
	if (op.selector == "language" && request.Language == "") || (op.selector == "action" && request.Action == "") {
		return request, fmt.Errorf("%s is required", op.selector)
	}
	if (op.selector != "language" && request.Language != "") || (op.selector != "action" && request.Action != "") {
		return request, errors.New("unexpected operation selector")
	}
	return request, nil
}

// resolveGenericKubernetesTool chooses only a freshly observed catalog binding.
// The returned arguments have been checked against that binding's complete MCP schema.
func resolveGenericKubernetesTool(op genericKubernetesOperation, connectionID string, raw []byte, catalog []ToolInfo) (ToolInfo, []byte, error) {
	request, err := parseGenericKubernetesArguments(op, raw)
	if err != nil {
		return ToolInfo{}, nil, err
	}
	var original map[string]json.RawMessage
	if err := json.Unmarshal(request.Arguments, &original); err != nil || original == nil {
		return ToolInfo{}, nil, errors.New("arguments must be an object")
	}
	if _, exists := original[connectionIDArg]; exists {
		return ToolInfo{}, nil, errors.New("arguments must not contain connection_id")
	}
	if op.routeLane && op.operation != "resource.ScopeValues" && op.operation != "resource.Catalog" {
		var reference struct {
			Address struct {
				Type string `json:"type"`
			} `json:"address"`
		}
		if err := json.Unmarshal(original["reference"], &reference); err != nil || reference.Address.Type != request.ResourceType {
			return ToolInfo{}, nil, errors.New("reference type does not match resource_type")
		}
	}
	var args map[string]any
	if err := json.Unmarshal(request.Arguments, &args); err != nil || args == nil {
		return ToolInfo{}, nil, errors.New("arguments must be an object")
	}
	var selected *ToolInfo
	for i := range catalog {
		tool := &catalog[i]
		b := tool.Resource
		if tool.Status != StatusOK || tool.PluginID != "kubernetes" || b == nil || b.PluginID != "kubernetes" || b.Route.Connection != connectionID || b.Operation != op.operation || b.Verb != op.verb {
			continue
		}
		if b.Types != nil {
			if _, ok := b.Types[request.ResourceType]; !ok {
				continue
			}
		} else if op.operation != "resource.ScopeValues" && b.Type != request.ResourceType {
			continue
		}
		if op.selector == "language" && b.Language != request.Language || op.selector == "action" && b.Action != request.Action {
			continue
		}
		if selected != nil {
			return ToolInfo{}, nil, errors.New("ambiguous resource operation in catalog")
		}
		selected = tool
	}
	if selected == nil {
		return ToolInfo{}, nil, errors.New("resource operation is not advertised for this connection and type")
	}
	args[connectionIDArg] = connectionID
	schemaJSON, err := json.Marshal(selected.InputSchema)
	if err != nil {
		return ToolInfo{}, nil, err
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(schemaJSON, &schema); err != nil {
		return ToolInfo{}, nil, err
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return ToolInfo{}, nil, err
	}
	if err := resolved.Validate(args); err != nil {
		return ToolInfo{}, nil, fmt.Errorf("arguments do not match live resource schema: %w", err)
	}
	encoded, err := json.Marshal(original)
	if err != nil {
		return ToolInfo{}, nil, err
	}
	return *selected, encoded, nil
}

type genericKubernetesDescriptor struct {
	Name         string         `json:"name"`
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	ReadOnly     bool           `json:"read_only"`
	Destructive  bool           `json:"destructive"`
	ResourceType string         `json:"resource_type,omitempty"`
	Operation    string         `json:"operation"`
	Language     string         `json:"language,omitempty"`
	Action       string         `json:"action,omitempty"`
	InputSchema  map[string]any `json:"input_schema"`
}

func genericKubernetesCatalogDescriptors(catalog []ToolInfo) []genericKubernetesDescriptor {
	descriptors := make([]genericKubernetesDescriptor, 0, len(catalog))
	for _, item := range catalog {
		b := item.Resource
		if item.Status != StatusOK || item.PluginID != "kubernetes" || b == nil || b.PluginID != "kubernetes" {
			continue
		}
		for _, op := range genericKubernetesOperations {
			if b.Operation != op.operation || b.Verb != op.verb {
				continue
			}
			descriptor := genericKubernetesDescriptor{
				Name: "kubernetes_resource_" + op.group, Title: item.Title, Description: item.Description,
				ReadOnly: item.ReadOnly, Destructive: item.Destructive, ResourceType: b.Type,
				Operation: op.name, Language: b.Language, Action: b.Action, InputSchema: item.InputSchema,
			}
			if b.Types == nil {
				descriptors = append(descriptors, descriptor)
				break
			}
			types := make([]string, 0, len(b.Types))
			for resourceType := range b.Types {
				types = append(types, resourceType)
			}
			sort.Strings(types)
			for _, resourceType := range types {
				descriptor.ResourceType = resourceType
				descriptors = append(descriptors, descriptor)
			}
			break
		}
	}
	return descriptors
}

func (r *Relay) dispatchGenericKubernetes(ctx context.Context, t ToolInfo, connection *sdktypes.Connection, argsJSON []byte) (*mcp.CallToolResult, error) {
	group, ok := genericKubernetesOperationFor(t)
	if !ok || connection == nil || connection.ID == "" || r.connections == nil {
		return nil, errors.New("invalid generic Kubernetes invocation")
	}
	op, err := genericKubernetesSelectedOperation(group.group, argsJSON)
	if err != nil {
		return errorResult(err.Error()), nil
	}
	if _, err := parseGenericKubernetesArguments(op, argsJSON); err != nil {
		return errorResult(err.Error()), nil
	}
	if _, err := r.connections.StartConnection(ctx, "kubernetes", connection.ID); err != nil {
		return nil, err
	}
	route := ResourceRoute{PluginID: "kubernetes", PluginName: "Kubernetes", Route: resourcev2.AccessRoute{Connection: connection.ID}}
	catalog, err := BuildResourceCatalogWithReaders(ctx, r.connections, []ResourceRoute{route}, ResourceReaders{Logs: r.logs, Metrics: r.metrics, Graph: r.graph})
	if err != nil {
		return nil, err
	}
	finalizeCatalog(catalog)
	if op.operation == "resource.Catalog" {
		encoded, err := json.Marshal(map[string]any{"tools": genericKubernetesCatalogDescriptors(catalog)})
		if err != nil {
			return nil, err
		}
		return &mcp.CallToolResult{StructuredContent: json.RawMessage(encoded)}, nil
	}
	tool, args, err := resolveGenericKubernetesTool(op, connection.ID, argsJSON, catalog)
	if err != nil {
		return errorResult(err.Error()), nil
	}
	return r.dispatchResolvedKubernetes(ctx, tool, args)
}
