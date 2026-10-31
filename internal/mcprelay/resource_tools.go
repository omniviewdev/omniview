package mcprelay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

type ResourceRoute struct {
	PluginID, PluginName string
	Route                resourcev2.AccessRoute
}

// ResourceBinding is retained host provenance, never decoded from tool arguments.
type ResourceBinding struct {
	PluginID         string
	Route            resourcev2.AccessRoute
	Type             string
	Operation        string
	Descriptor       resourcev2.ResourceType
	Observation      resource.Observation
	Target           resourcev2.ReadTarget
	Verb             string
	Language         string
	Action           string
	TypeAction       bool
	Dimensions       []string
	Logs             ResourceLogsReader
	QuerySchema      *resourcev2.Schema
	ActionDescriptor *resourcev2.ActionDescriptor
}

type resourceArguments struct {
	Reference        *resourcev2.ResourceReference `json:"reference,omitempty"`
	Scope            resourcev2.QueryScope         `json:"scope,omitempty"`
	Representation   string                        `json:"representation,omitempty"`
	Input            resourcev2.Value              `json:"input,omitempty"`
	Query            resourcev2.Value              `json:"query,omitempty"`
	ExpectedRevision *string                       `json:"expectedRevision,omitempty"`
	Limit            uint32                        `json:"limit,omitempty"`
	Cursor           *string                       `json:"cursor,omitempty"`
	TailLines        int64                         `json:"tailLines,omitempty"`
	Target           string                        `json:"target,omitempty"`
	ResourceData     *resourcev2.Value             `json:"resourceData,omitempty"`
	Dimension        string                        `json:"dimension,omitempty"`
}

type catalogObserver interface {
	ObserveCatalog(context.Context, string, resourcev2.AccessRoute) (resourcev2.Catalog, resource.Observation, error)
	ResolveToolTarget(context.Context, string, resourcev2.AccessRoute, string) (resourcev2.ReadTarget, error)
}

// Resource names hash a length-delimited tuple, never concatenate user names.
func resourceToolName(parts ...string) string {
	encoded, _ := json.Marshal(parts)
	digest := sha256.Sum256(encoded)
	return "resource_" + hex.EncodeToString(digest[:])
}

func BuildResourceCatalog(ctx context.Context, service resource.Service, routes []ResourceRoute) ([]ToolInfo, error) {
	return BuildResourceCatalogWithLogs(ctx, service, routes, nil)
}

func BuildResourceCatalogWithLogs(ctx context.Context, service resource.Service, routes []ResourceRoute, logs ResourceLogsReader) ([]ToolInfo, error) {
	observer, ok := service.(catalogObserver)
	if !ok {
		return nil, nil
	}
	var out []ToolInfo
	var failures []error
	for _, route := range routes {
		catalog, observation, err := observer.ObserveCatalog(ctx, route.PluginID, route.Route)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		retained := resource.WithObservation(ctx, observation)
		features, err := service.Features(ctx, route.PluginID)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		dimensions := map[string]bool{}
		for _, descriptor := range catalog.Types {
			representation := descriptor.ModelRepresentation
			if representation == "" {
				representation = descriptor.DefaultRepresentation
			}
			target, err := observer.ResolveToolTarget(retained, route.PluginID, route.Route, descriptor.Type)
			if err != nil {
				failures = append(failures, err)
				continue
			}
			target.Representation = representation
			if handlers, ok := logs.(interface {
				GetSupportedResources(string) []sdklogs.Handler
			}); ok {
				for _, handler := range handlers.GetSupportedResources(route.PluginID) {
					if handler.Resource == descriptor.Type {
						binding := ResourceBinding{PluginID: route.PluginID, Route: route.Route, Type: descriptor.Type, Descriptor: descriptor, Observation: observation, Target: target, Operation: "logs.CreateSession", Logs: logs}
						out = append(out, resourceToolInfo(route, binding, "logs"))
						break
					}
				}
			}
			if features.Has(resourcev2.FeatureScopeValues) {
				for _, dimension := range descriptor.QueryDimensions {
					dimensions[dimension.Name] = true
				}
			}
			seen := map[resourcev2.Operation]bool{}
			for _, capability := range descriptor.Capabilities {
				if seen[capability.Operation] {
					continue
				}
				seen[capability.Operation] = true
				binding := ResourceBinding{PluginID: route.PluginID, Route: route.Route, Type: descriptor.Type, Descriptor: descriptor, Observation: observation, Target: target}
				binding.Target.Scope = capability.Scope
				switch capability.Operation {
				case resourcev2.OperationGet:
					binding.Operation = "resource.Get"
				case resourcev2.OperationEnumerate:
					binding.Operation = "resource.Enumerate"
				case resourcev2.OperationNativeQuery:
					binding.Operation = "resource.NativeQuery"
					for _, language := range descriptor.NativeQueries {
						next := binding
						next.Language = language.Language
						schema := language.InputSchema
						next.QuerySchema = &schema
						out = append(out, resourceToolInfo(route, next, string(capability.Operation)+"_"+language.Language))
					}
					continue
				case resourcev2.OperationCreate:
					binding.Operation = "resource.Mutate"
					binding.Verb = "create"
				case resourcev2.OperationMutationUpdate:
					binding.Operation = "resource.Mutate"
					binding.Verb = "update"
				case resourcev2.OperationDelete:
					binding.Operation = "resource.Mutate"
					binding.Verb = "delete"
				case resourcev2.OperationAction:
					actions, err := service.GetActions(retained, route.PluginID, route.Route, descriptor.Type)
					if err != nil {
						failures = append(failures, err)
						continue
					}
					for _, action := range actions {
						// MCP calls are finite unary results. Streaming actions require a session consumer.
						if action.Streaming {
							continue
						}
						next := binding
						next.Operation = "resource.Action"
						next.Action = action.ID
						next.TypeAction = action.Scope == resourcev2.ActionScopeType
						retainedAction := action
						next.ActionDescriptor = &retainedAction
						encoded, err := json.Marshal(retainedAction)
						if err != nil {
							failures = append(failures, err)
							continue
						}
						if err := json.Unmarshal(encoded, &retainedAction); err != nil {
							failures = append(failures, err)
							continue
						}
						out = append(out, resourceToolInfo(route, next, "action_"+action.ID))
					}
					continue
				default:
					continue
				}
				out = append(out, resourceToolInfo(route, binding, string(capability.Operation)))
			}
		}
		if features.Has(resourcev2.FeatureScopeValues) && len(dimensions) > 0 {
			names := make([]string, 0, len(dimensions))
			for name := range dimensions {
				names = append(names, name)
			}
			sort.Strings(names)
			binding := ResourceBinding{PluginID: route.PluginID, Route: route.Route, Observation: observation, Operation: "resource.ScopeValues", Dimensions: names}
			info := resourceToolInfo(route, binding, "scope_values")
			info.Description = "Provider scope-value discovery lane for declared route dimensions. A query dimension does not promise suggestions: unsupported dimensions return UNSUPPORTED. Empty success means an empty discovery result, not complete resource membership."
			out = append(out, info)
		}
	}
	return out, errors.Join(failures...)
}

func resourceToolInfo(route ResourceRoute, binding ResourceBinding, label string) ToolInfo {
	properties := map[string]any{"connection_id": map[string]any{"type": "string", "enum": []string{route.Route.Connection}}}
	required := []string{"connection_id"}
	if binding.Operation == "resource.ScopeValues" {
		properties["dimension"] = map[string]any{"type": "string", "enum": binding.Dimensions}
		required = append(required, "dimension")
	}
	reference := binding.Operation == "resource.Get" || binding.Operation == "resource.Mutate" || binding.Operation == "logs.CreateSession" || (binding.Operation == "resource.Action" && !binding.TypeAction)
	if reference {
		properties["reference"] = referenceSchema(binding)
		required = append(required, "reference")
	}
	if binding.Operation == "resource.Enumerate" || binding.Operation == "resource.NativeQuery" || binding.TypeAction {
		properties["scope"] = scopeSchema(binding.Descriptor)
	}
	if binding.Operation == "resource.Get" || binding.Operation == "resource.Enumerate" || binding.Operation == "resource.NativeQuery" {
		representations := make([]string, 0, len(binding.Descriptor.Representations))
		for _, representation := range binding.Descriptor.Representations {
			representations = append(representations, representation.ID)
		}
		properties["representation"] = map[string]any{"type": "string", "enum": representations}
		if binding.Target.Representation == "" {
			required = append(required, "representation")
		}
	}
	if binding.Operation == "resource.Enumerate" || binding.Operation == "resource.NativeQuery" {
		properties["limit"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 500}
		properties["cursor"] = map[string]any{"type": "string", "maxLength": 128, "description": "Opaque single-use continuation, valid for five minutes. Bound to this session, target, query, route, representation and advertised source observation."}
	}
	if binding.Operation == "resource.NativeQuery" {
		properties["query"] = taggedValueSchema()
		required = append(required, "query")
	}
	if binding.QuerySchema != nil {
		properties["query"] = taggedSchema(*binding.QuerySchema)
	}
	if binding.Operation == "resource.Mutate" {
		properties["expectedRevision"] = map[string]any{"type": "string"}
		properties["input"] = taggedValueSchema()
		required = append(required, "input")
	}
	if binding.Operation == "resource.Action" {
		properties["input"] = taggedValueSchema()
		required = append(required, "input")
	}
	if binding.ActionDescriptor != nil && binding.ActionDescriptor.ParamsSchema != nil {
		properties["input"] = taggedSchema(*binding.ActionDescriptor.ParamsSchema)
	}
	if binding.Operation == "logs.CreateSession" {
		properties["tailLines"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 5000}
		properties["target"] = map[string]any{"type": "string"}
		properties["resourceData"] = taggedValueSchema()
	}
	readOnly := binding.Operation == "resource.Get" || binding.Operation == "resource.Enumerate" || binding.Operation == "resource.NativeQuery" || binding.Operation == "resource.ScopeValues" || binding.Operation == "logs.CreateSession"
	return ToolInfo{MCPName: resourceToolName(route.PluginID, route.Route.Connection, binding.Type, label), PluginID: route.PluginID, PluginName: route.PluginName, Name: label, Title: binding.Descriptor.DisplayName + " " + label, Description: fmt.Sprintf("%s on %s through route %s. Values use canonical tagged resource Value encoding; source metadata is not host query membership.", label, binding.Type, route.Route.Connection), Scope: ScopeConnection, ReadOnly: readOnly, Destructive: !readOnly, Idempotent: readOnly, OpenWorld: true, InputSchema: map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}, Status: StatusOK, Resource: &binding}
}

func taggedValueSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"null", "bool", "string", "int64", "uint64", "double", "timestamp", "list", "map"}}, "value": map[string]any{}}, "required": []string{"kind"}, "additionalProperties": false, "description": "Canonical tagged resource Value. Int64/uint64 payloads are decimal strings; timestamps retain nanoseconds and double payloads retain negative zero."}
}
func scopeSchema(descriptor resourcev2.ResourceType) map[string]any {
	names := make([]string, 0, len(descriptor.QueryDimensions))
	for _, dimension := range descriptor.QueryDimensions {
		names = append(names, dimension.Name)
	}
	dimensionSchema := map[string]any{"type": "string"}
	if len(names) > 0 {
		dimensionSchema["enum"] = names
	}
	return map[string]any{"type": "array", "minItems": len(names), "maxItems": len(names), "items": map[string]any{"type": "object", "properties": map[string]any{"dimension": dimensionSchema, "match": map[string]any{"type": "string", "enum": []string{"any", "oneOf"}}, "values": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}, "required": []string{"dimension", "match"}, "additionalProperties": false}}
}
func referenceSchema(binding ResourceBinding) map[string]any {
	names := make([]string, 0, len(binding.Descriptor.IdentityDimensions))
	for _, dimension := range binding.Descriptor.IdentityDimensions {
		names = append(names, dimension.Name)
	}
	dimensionSchema := map[string]any{"type": "string"}
	if len(names) > 0 {
		dimensionSchema["enum"] = names
	}
	scope := map[string]any{"type": "array", "minItems": len(names), "maxItems": len(names), "items": map[string]any{"type": "object", "properties": map[string]any{"dimension": dimensionSchema, "value": map[string]any{"type": "string"}}, "required": []string{"dimension", "value"}, "additionalProperties": false}}
	return map[string]any{"type": "object", "properties": map[string]any{"address": map[string]any{"type": "object", "properties": map[string]any{"provider": map[string]any{"const": binding.Target.Provider}, "authority": map[string]any{"const": binding.Target.Authority}, "type": map[string]any{"const": binding.Type}, "scope": scope, "id": map[string]any{"type": "string", "minLength": 1}}, "required": []string{"provider", "authority", "type", "scope", "id"}, "additionalProperties": false}, "incarnation": map[string]any{"type": "string"}}, "required": []string{"address"}, "additionalProperties": false}
}

func (binding *ResourceBinding) arguments(raw []byte) (resourceArguments, resourcev2.ReadTarget, error) {
	var args resourceArguments
	if err := resourcev2.ValidateJSON(raw); err != nil {
		return args, resourcev2.ReadTarget{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&args); err != nil {
		return args, resourcev2.ReadTarget{}, err
	}
	target := binding.Target
	if args.Scope != nil {
		target.Scope = args.Scope
	}
	if args.Representation != "" {
		target.Representation = args.Representation
	}
	if args.Reference != nil {
		address := args.Reference.Address
		if address.Provider != target.Provider || address.Authority != target.Authority || address.Type != binding.Type {
			return args, target, errors.New("reference is not bound to this advertised tool")
		}
	}
	if binding.Operation == "resource.Get" || binding.Operation == "resource.Mutate" || binding.Operation == "logs.CreateSession" || (binding.Operation == "resource.Action" && !binding.TypeAction) {
		if args.Reference == nil {
			return args, target, errors.New("reference required")
		}
		if err := resourcev2.ValidateAddress(args.Reference.Address, binding.Descriptor.IdentityDimensions); err != nil {
			return args, target, err
		}
	}
	if binding.QuerySchema != nil {
		if err := resourcev2.ValidateSchemaValue(*binding.QuerySchema, args.Query); err != nil {
			return args, target, err
		}
	}
	if binding.Operation == "resource.ScopeValues" {
		declared := false
		for _, dimension := range binding.Dimensions {
			if args.Dimension == dimension {
				declared = true
				break
			}
		}
		if !declared {
			return args, target, resourcev2.NewError("UNSUPPORTED", "Scope discovery dimension is not declared on this route.")
		}
	}
	if err := resourcev2.ValidateScope(target.Scope, binding.Descriptor.QueryDimensions); err != nil {
		return args, target, err
	}
	return args, target, nil
}

func (binding *ResourceBinding) InvocationTarget(raw []byte) (invocation.Target, error) {
	args, target, err := binding.arguments(raw)
	if err != nil {
		return invocation.Target{}, err
	}
	out := invocation.Target{Provider: binding.PluginID, Connection: binding.Route.Connection, ResourceType: binding.Type}
	if binding.Operation == "resource.ScopeValues" {
		out.Scope = map[string]string{"dimension": args.Dimension}
		return out, nil
	}
	if args.Reference != nil {
		encoded, _ := json.Marshal(args.Reference.Address.Scope)
		out.Object = args.Reference.Address.ID
		out.Scope = map[string]string{"resource-scope": string(encoded), "authority": target.Authority}
	} else {
		encoded, _ := json.Marshal(target.Scope)
		out.Scope = map[string]string{"query-scope": string(encoded), "authority": target.Authority}
	}
	if binding.Verb != "" {
		out.Action = binding.Verb
	}
	if binding.Action != "" {
		out.Action = binding.Action
	}
	return out, nil
}

func DispatchResource(ctx context.Context, service resource.Service, tool ToolInfo, raw json.RawMessage) (any, error) {
	binding := tool.Resource
	if binding == nil {
		return nil, errors.New("missing resource binding")
	}
	args, target, err := binding.arguments(raw)
	if err != nil {
		return nil, err
	}
	ctx = resource.WithObservation(ctx, binding.Observation)
	switch binding.Operation {
	case "resource.ScopeValues":
		values, err := service.ScopeValues(ctx, binding.PluginID, binding.Route, args.Dimension)
		if err != nil {
			return nil, err
		}
		return ResourceScopeValuesResult{Route: binding.Route, Dimension: args.Dimension, Values: values}, nil
	case "logs.CreateSession":
		if binding.Logs == nil || args.Reference == nil {
			return nil, errors.New("resource logs unavailable")
		}
		logs, err := binding.Logs.ReadResourceLogs(ctx, binding.PluginID, sdklogs.CreateSessionOptions{ResourceKey: binding.Type, ResourceID: args.Reference.Address.ID, Reference: args.Reference, Route: &binding.Route, ResourceData: args.ResourceData, Options: sdklogs.LogSessionOptions{Follow: false, TailLines: args.TailLines, Target: args.Target}})
		if err != nil {
			return nil, err
		}
		return ResourceLogsResult{Route: binding.Route, Reference: *args.Reference, Logs: logs}, nil
	case "resource.Get":
		if args.Reference == nil {
			return nil, errors.New("reference required")
		}
		return service.Get(ctx, binding.PluginID, resource.HostGetRequest{TargetID: tool.MCPName, Request: resourcev2.GetRequest{Route: binding.Route, Reference: *args.Reference, Representation: target.Representation}})
	case "resource.Enumerate", "resource.NativeQuery":
		return collectResources(ctx, service, tool, args, target)
	case "resource.Mutate":
		if args.Reference == nil {
			return nil, errors.New("reference required")
		}
		record, err := service.Mutate(ctx, binding.PluginID, resourcev2.MutationRequest{Route: binding.Route, Reference: *args.Reference, Operation: binding.Verb, Input: args.Input, ExpectedRevision: args.ExpectedRevision})
		if err != nil {
			return nil, err
		}
		return ResourceOperationResult{Operation: binding.Verb, Route: binding.Route, Reference: args.Reference, Record: &record}, nil
	case "resource.Action":
		request := resourcev2.ActionRequest{Route: binding.Route, Action: binding.Action, Input: args.Input, ExpectedDescriptor: binding.ActionDescriptor}
		if binding.TypeAction {
			request.TypeTarget = &resourcev2.TypeActionTarget{Provider: target.Provider, Authority: target.Authority, Type: target.Type, Scope: target.Scope}
		} else if args.Reference != nil {
			request.Reference = *args.Reference
		} else {
			return nil, errors.New("reference required")
		}
		if binding.ActionDescriptor == nil {
			return nil, errors.New("action declaration missing")
		}
		if err := resourcev2.ValidateActionDescriptorRequest(request, *binding.ActionDescriptor, false); err != nil {
			return nil, err
		}
		value, err := service.Action(ctx, binding.PluginID, request)
		if err != nil {
			return nil, err
		}
		return ResourceOperationResult{Operation: binding.Operation, Route: binding.Route, TypeTarget: request.TypeTarget, Reference: args.Reference, Action: binding.Action, Value: &value}, nil
	}
	return nil, errors.New("unsupported resource tool lane")
}
