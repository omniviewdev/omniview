package mcprelay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type ResourceRoute struct {
	PluginID, PluginName string
	Route                resourcev2.AccessRoute
}

// ResourceBinding is retained host provenance, never decoded from tool arguments.
type ResourceBinding struct {
	PluginID          string
	Route             resourcev2.AccessRoute
	Type              string
	Operation         string
	Descriptor        resourcev2.ResourceType
	Observation       resource.Observation
	Target            resourcev2.ReadTarget
	Verb              string
	Language          string
	Action            string
	TypeAction        bool
	Dimensions        []string
	Logs              ResourceLogsReader
	QuerySchema       *resourcev2.Schema
	ActionDescriptor  *resourcev2.ActionDescriptor
	Metrics           ResourceMetricsReader
	Graph             ResourceGraphReader
	MetricDescriptors []sdkmetric.MetricDescriptor
	// Types binds route-level lanes to every advertised readable type.
	Types map[string]RouteType
}

// RouteType is one catalog type admitted by a route-level lane.
type RouteType struct {
	Descriptor resourcev2.ResourceType
	Target     resourcev2.ReadTarget
}

// Host read lanes advertised beside the catalog operations.
const (
	opGet               = "resource.Get"
	opGetResourceEvents = "resource.GetResourceEvents"
	opGetHealth         = "resource.GetHealth"
	opGraphRelated      = "graph.GetRelated"
	opMetricQuery       = "metric.Query"

	eventLimitDefault     = 50
	eventLimitMax         = 256
	metricStepMaxSeconds  = 86400
	metricStepDivisions   = 100
	metricMaxPoints       = 10000
	metricShapeCurrent    = "current"
	metricShapeTimeseries = "timeseries"
)

func isReadLane(operation string) bool {
	switch operation {
	case opGetResourceEvents, opGetHealth, opGraphRelated, opMetricQuery:
		return true
	}
	return false
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
	MetricIDs        []string                      `json:"metricIDs"`
	Shape            string                        `json:"shape"`
	StartTime        string                        `json:"startTime"`
	EndTime          string                        `json:"endTime"`
	StepSeconds      uint32                        `json:"stepSeconds"`
	Direction        string                        `json:"direction"`
	RelationshipType *string                       `json:"relationshipType"`
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
	var readers ResourceReaders
	return BuildResourceCatalogWithReaders(ctx, service, routes, readers)
}

//nolint:cyclop,funlen,gocognit,gocyclo // One pass keeps observation provenance in one place.
func BuildResourceCatalogWithReaders(
	ctx context.Context, service resource.Service, routes []ResourceRoute, readers ResourceReaders,
) ([]ToolInfo, error) {
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
		routeTypes := map[string]RouteType{}
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
			if rt, readable := routeType(descriptor, target); readable {
				routeTypes[descriptor.Type] = rt
			}
			if info, advertised := metricToolInfo(route, readers.Metrics, descriptor, observation, target); advertised {
				out = append(out, info)
			}
			logs := readers.Logs
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
						out = append(out, actionToolInfo(route, next, "action_"+action.ID))
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
		out = append(out, routeLaneTools(route, observation, features, routeTypes, readers.Graph)...)
	}
	return out, errors.Join(failures...)
}

// routeType binds a readable catalog type for route-level lanes.
func routeType(descriptor resourcev2.ResourceType, target resourcev2.ReadTarget) (RouteType, bool) {
	for _, capability := range descriptor.Capabilities {
		if capability.Operation != resourcev2.OperationGet {
			continue
		}
		target.Representation = descriptor.DefaultRepresentation
		if target.Representation == "" && len(descriptor.Representations) > 0 {
			target.Representation = descriptor.Representations[0].ID
		}
		return RouteType{Descriptor: descriptor, Target: target}, true
	}
	var none RouteType
	return none, false
}

// routeLaneTools emits at most one events, health and related tool per route.
func routeLaneTools(
	route ResourceRoute,
	observation resource.Observation,
	features resourcev2.FeatureSet,
	types map[string]RouteType,
	graphReader ResourceGraphReader,
) []ToolInfo {
	if len(types) == 0 {
		return nil
	}
	var lane ResourceBinding
	lane.PluginID, lane.Route, lane.Observation, lane.Types = route.PluginID, route.Route, observation, types
	pluginTitle := route.PluginName
	if pluginTitle == "" {
		pluginTitle = route.PluginID
	}
	var out []ToolInfo
	add := func(operation, label, description string) {
		next := lane
		next.Operation = operation
		if operation == opGraphRelated {
			next.Graph = graphReader
		}
		info := resourceToolInfo(route, next, label)
		info.Title = pluginTitle + " " + label
		info.Description = description
		out = append(out, info)
	}
	if features.Has(resourcev2.FeatureHealth) {
		add(opGetResourceEvents, "events", "Recent native events for one resource of any type on this route. "+
			"Returns UNSUPPORTED for types without native event retrieval.")
		add(opGetHealth, "health", "Provider health assessment for one resource. "+
			"Returns UNSUPPORTED for types without a health assessor; null means not assessed.")
	}
	if features.Has(resourcev2.FeatureRelationships) && graphReader != nil {
		add(opGraphRelated, "related", "Related resources from the host relationship graph (references only). "+
			"Read cited resources with their get tools.")
	}
	return out
}

// metricToolInfo advertises a metric tool when the route plugin handles the type.
func metricToolInfo(
	route ResourceRoute,
	reader ResourceMetricsReader,
	descriptor resourcev2.ResourceType,
	observation resource.Observation,
	target resourcev2.ReadTarget,
) (ToolInfo, bool) {
	var none ToolInfo
	if reader == nil {
		return none, false
	}
	metrics := finiteMetrics(metricHandler(reader, route.PluginID, descriptor.Type))
	if len(metrics) == 0 {
		return none, false
	}
	var binding ResourceBinding
	binding.PluginID, binding.Route = route.PluginID, route.Route
	binding.Type, binding.Descriptor = descriptor.Type, descriptor
	binding.Observation, binding.Target, binding.Operation = observation, target, opMetricQuery
	binding.Metrics, binding.MetricDescriptors = reader, metrics
	info := resourceToolInfo(route, binding, "metrics")
	_, _, info.Description = metricSchema(binding)
	return info, true
}

// actionToolInfo carries provider action metadata to the model.
func actionToolInfo(route ResourceRoute, binding ResourceBinding, label string) ToolInfo {
	info := resourceToolInfo(route, binding, label)
	d := binding.ActionDescriptor
	if binding.Operation != "resource.Action" || d == nil {
		return info
	}
	if d.Label != "" {
		info.Title = binding.Descriptor.DisplayName + ": " + d.Label
	}
	description := "(action " + d.ID + " on " + binding.Type + " through route " + route.Route.Connection + ".)"
	if text := strings.TrimSpace(d.Description); text != "" {
		description = text + " " + description
	}
	if d.Dangerous {
		description += " The provider marks this action dangerous: it can disrupt workloads or lose data."
	}
	info.Description = description + " Values use canonical tagged resource Value encoding."
	return info
}

// finiteMetrics keeps metrics that offer a current or timeseries shape.
func finiteMetrics(metrics []sdkmetric.MetricDescriptor) []sdkmetric.MetricDescriptor {
	var out []sdkmetric.MetricDescriptor
	for _, metric := range metrics {
		for _, shape := range metric.SupportedShapes {
			if metricShapeName(shape) != "" {
				out = append(out, metric)
				break
			}
		}
	}
	return out
}

// metricHandler returns the route plugin's metric descriptors for one type.
func metricHandler(reader ResourceMetricsReader, pluginID, resourceType string) []sdkmetric.MetricDescriptor {
	var metrics []sdkmetric.MetricDescriptor
	seen := make(map[string]bool)
	for _, provider := range reader.GetProvidersForResource(resourceType) {
		if provider.PluginID != pluginID {
			continue
		}
		for _, handler := range provider.Handlers {
			if handler.Resource == resourceType {
				for _, metric := range handler.Metrics {
					if !seen[metric.ID] {
						metrics = append(metrics, metric)
						seen[metric.ID] = true
					}
				}
			}
		}
	}
	return metrics
}

func metricUnitName(unit sdkmetric.MetricUnit) string {
	switch unit {
	case sdkmetric.UnitNone:
		return "none"
	case sdkmetric.UnitBytes:
		return "bytes"
	case sdkmetric.UnitKB:
		return "KB"
	case sdkmetric.UnitMB:
		return "MB"
	case sdkmetric.UnitGB:
		return "GB"
	case sdkmetric.UnitPercentage:
		return "percent"
	case sdkmetric.UnitMillis:
		return "milliseconds"
	case sdkmetric.UnitSeconds:
		return "seconds"
	case sdkmetric.UnitCount:
		return "count"
	case sdkmetric.UnitOpsPerSec:
		return "ops/s"
	case sdkmetric.UnitBytesPerSec:
		return "bytes/s"
	case sdkmetric.UnitMillicores:
		return "millicores"
	case sdkmetric.UnitCores:
		return "cores"
	}
	return "unknown"
}

// metricShapeName names the finite shapes; aggregate is not offered to agents.
func metricShapeName(shape sdkmetric.MetricShape) string {
	switch shape {
	case sdkmetric.ShapeCurrent:
		return metricShapeCurrent
	case sdkmetric.ShapeTimeseries:
		return metricShapeTimeseries
	case sdkmetric.ShapeAggregate:
		return ""
	}
	return ""
}

func metricSchema(binding ResourceBinding) (map[string]any, []string, string) {
	ids := make([]string, 0, len(binding.MetricDescriptors))
	available := make([]string, 0, len(binding.MetricDescriptors))
	shapeSet := map[string]bool{}
	for _, metric := range binding.MetricDescriptors {
		ids = append(ids, metric.ID)
		available = append(available, fmt.Sprintf("%s (%s, %s)", metric.ID, metric.Name, metricUnitName(metric.Unit)))
		for _, shape := range metric.SupportedShapes {
			if name := metricShapeName(shape); name != "" {
				shapeSet[name] = true
			}
		}
	}
	shapes := make([]string, 0, len(shapeSet))
	for name := range shapeSet {
		shapes = append(shapes, name)
	}
	sort.Strings(shapes)
	properties := map[string]any{
		"metricIDs": map[string]any{
			"type": "array", "minItems": 1, "items": map[string]any{"type": "string", "enum": ids},
		},
		"shape":       map[string]any{"type": "string", "enum": shapes},
		"startTime":   map[string]any{"type": "string", "description": "RFC 3339; required for timeseries"},
		"endTime":     map[string]any{"type": "string", "description": "RFC 3339; required for timeseries"},
		"stepSeconds": map[string]any{"type": "integer", "minimum": 1, "maximum": metricStepMaxSeconds},
	}
	description := "Metrics for one " + binding.Descriptor.DisplayName +
		". Available: " + strings.Join(available, "; ") + "."
	return properties, []string{"metricIDs", "shape"}, description
}

func resourceToolInfo(route ResourceRoute, binding ResourceBinding, label string) ToolInfo {
	properties := map[string]any{"connection_id": map[string]any{"type": "string", "enum": []string{route.Route.Connection}}}
	required := []string{"connection_id"}
	if binding.Operation == "resource.ScopeValues" {
		properties["dimension"] = map[string]any{"type": "string", "enum": binding.Dimensions}
		required = append(required, "dimension")
	}
	if binding.Types != nil {
		properties["reference"] = routeReferenceSchema(binding)
		required = append(required, "reference")
	} else if binding.requiresReference() {
		properties["reference"] = referenceSchema(binding)
		required = append(required, "reference")
	}
	switch binding.Operation {
	case opGetResourceEvents:
		properties["limit"] = map[string]any{"type": "integer", "minimum": 1, "maximum": eventLimitMax}
	case opGraphRelated:
		properties["direction"] = map[string]any{"type": "string", "enum": []string{"outgoing", "incoming", "both"}}
		properties["relationshipType"] = map[string]any{"type": "string"}
		required = append(required, "direction")
	case opMetricQuery:
		metricProperties, metricRequired, _ := metricSchema(binding)
		maps.Copy(properties, metricProperties)
		required = append(required, metricRequired...)
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
	readOnly = readOnly || isReadLane(binding.Operation)
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

func (binding *ResourceBinding) requiresReference() bool {
	switch binding.Operation {
	case "resource.Get", "resource.Mutate", "logs.CreateSession", opMetricQuery:
		return true
	case "resource.Action":
		return !binding.TypeAction
	}
	return false
}

// routeReferenceSchema admits a reference to any type bound by a route-level lane.
func routeReferenceSchema(binding ResourceBinding) map[string]any {
	types := make([]string, 0, len(binding.Types))
	providers, authorities, dimensions := map[string]bool{}, map[string]bool{}, map[string]bool{}
	maxScope := 0
	for name, rt := range binding.Types {
		types = append(types, name)
		providers[rt.Target.Provider] = true
		authorities[rt.Target.Authority] = true
		for _, dimension := range rt.Descriptor.IdentityDimensions {
			dimensions[dimension.Name] = true
		}
		maxScope = max(maxScope, len(rt.Descriptor.IdentityDimensions))
	}
	sort.Strings(types)
	names := make([]string, 0, len(dimensions))
	for name := range dimensions {
		names = append(names, name)
	}
	sort.Strings(names)
	dimensionSchema := map[string]any{"type": "string"}
	if len(names) > 0 {
		dimensionSchema["enum"] = names
	}
	scope := map[string]any{"type": "array", "minItems": 0, "maxItems": maxScope, "items": map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"dimension": dimensionSchema, "value": map[string]any{"type": "string"}},
		"required":             []string{"dimension", "value"},
		"additionalProperties": false,
	}}
	address := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"provider":  constOrEnum(providers),
			"authority": constOrEnum(authorities),
			"type":      map[string]any{"type": "string", "enum": types},
			"scope":     scope,
			"id":        map[string]any{"type": "string", "minLength": 1},
		},
		"required":             []string{"provider", "authority", "type", "scope", "id"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"address": address, "incarnation": map[string]any{"type": "string"}},
		"required":             []string{"address"},
		"additionalProperties": false,
	}
}

func constOrEnum(values map[string]bool) map[string]any {
	list := make([]string, 0, len(values))
	for value := range values {
		list = append(list, value)
	}
	sort.Strings(list)
	if len(list) == 1 {
		return map[string]any{"const": list[0]}
	}
	return map[string]any{"type": "string", "enum": list}
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
	target, descriptor, resourceType := binding.Target, binding.Descriptor, binding.Type
	if binding.Types != nil {
		if args.Reference == nil {
			return args, target, errors.New("reference required")
		}
		rt, ok := binding.Types[args.Reference.Address.Type]
		if !ok {
			return args, target, errors.New("reference type is not advertised by this tool")
		}
		target, descriptor, resourceType = rt.Target, rt.Descriptor, args.Reference.Address.Type
	}
	if args.Scope != nil {
		target.Scope = args.Scope
	}
	if args.Representation != "" {
		target.Representation = args.Representation
	}
	if args.Reference != nil {
		address := args.Reference.Address
		if address.Provider != target.Provider || address.Authority != target.Authority || address.Type != resourceType {
			return args, target, errors.New("reference is not bound to this advertised tool")
		}
	}
	if binding.Types != nil || binding.requiresReference() {
		if args.Reference == nil {
			return args, target, errors.New("reference required")
		}
		if err := resourcev2.ValidateAddress(args.Reference.Address, descriptor.IdentityDimensions); err != nil {
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
	if err := resourcev2.ValidateScope(target.Scope, descriptor.QueryDimensions); err != nil {
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
	if binding.Types != nil {
		out.ResourceType = args.Reference.Address.Type
	}
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
	case opGetResourceEvents, opGetHealth, opGraphRelated:
		return dispatchRouteLane(ctx, service, tool, args, target)
	case opMetricQuery:
		return dispatchMetrics(ctx, binding, args)
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

// dispatchRouteLane answers events, health and related reads for one reference.
func dispatchRouteLane(
	ctx context.Context,
	service resource.Service,
	tool ToolInfo,
	args resourceArguments,
	target resourcev2.ReadTarget,
) (any, error) {
	binding := tool.Resource
	request := resourcev2.GetRequest{
		Route: binding.Route, Reference: *args.Reference, Representation: target.Representation,
	}
	switch binding.Operation {
	case opGetResourceEvents:
		limit := args.Limit
		if limit == 0 {
			limit = eventLimitDefault
		}
		if limit > eventLimitMax {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Event limit must be between 1 and 256.")
		}
		events, err := service.GetResourceEvents(ctx, binding.PluginID, request, limit)
		if err != nil {
			return nil, err
		}
		return ResourceEventsResult{Route: binding.Route, Reference: *args.Reference, Events: events}, nil
	case opGetHealth:
		rec, err := service.Get(ctx, binding.PluginID, resource.HostGetRequest{TargetID: tool.MCPName, Request: request})
		if err != nil {
			return nil, err
		}
		health, err := service.GetHealth(ctx, binding.PluginID, request, rec.Record.Body)
		if err != nil {
			return nil, err
		}
		return ResourceHealthResult{Route: binding.Route, Reference: *args.Reference, Health: health}, nil
	case opGraphRelated:
		if binding.Graph == nil {
			return nil, errors.New("resource graph unavailable")
		}
		edges, err := binding.Graph.GetRelated(
			ctx, binding.PluginID, *args.Reference, binding.Route, args.Direction, args.RelationshipType,
		)
		if err != nil {
			return nil, err
		}
		const maxRelatedEdges = 1000
		truncated := len(edges) > maxRelatedEdges
		if truncated {
			edges = edges[:maxRelatedEdges]
		}
		return ResourceRelatedResult{
			Route: binding.Route, Reference: *args.Reference, Edges: edges, Truncated: truncated,
		}, nil
	}
	return nil, errors.New("unsupported resource tool lane")
}

func dispatchMetrics(ctx context.Context, binding *ResourceBinding, args resourceArguments) (any, error) {
	if binding.Metrics == nil || args.Reference == nil {
		return nil, errors.New("resource metrics unavailable")
	}
	if len(args.MetricIDs) == 0 {
		return nil, resourcev2.NewError("INVALID_REQUEST", "At least one metric ID is required.")
	}
	for _, id := range args.MetricIDs {
		known := false
		for _, metric := range binding.MetricDescriptors {
			if metric.ID == id {
				known = true
				break
			}
		}
		if !known {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Metric ID is not advertised by this tool.")
		}
	}
	var request sdkmetric.QueryRequest
	request.ResourceKey, request.ResourceID, request.Reference = binding.Type, args.Reference.Address.ID, args.Reference
	request.Route, request.MetricIDs = &binding.Route, args.MetricIDs
	if err := metricQueryShape(&request, args); err != nil {
		return nil, err
	}
	resp, err := binding.Metrics.ReadResourceMetrics(ctx, binding.PluginID, request)
	if err != nil {
		return nil, err
	}
	if resp == nil || !resp.Success {
		// Provider error text is plugin-authored and never reaches the agent.
		return nil, resourcev2.NewError("PROVIDER_ERROR", "The metric provider could not answer.")
	}
	return ResourceMetricsResult{Route: binding.Route, Reference: *args.Reference, Results: resp.Results}, nil
}

// metricQueryShape maps the agent shape and, for timeseries, its RFC 3339 window.
func metricQueryShape(request *sdkmetric.QueryRequest, args resourceArguments) error {
	if args.StepSeconds > metricStepMaxSeconds {
		return resourcev2.NewError("INVALID_REQUEST", "Metric stepSeconds must be between 1 and 86400.")
	}
	switch args.Shape {
	case metricShapeCurrent:
		request.Shape = sdkmetric.ShapeCurrent
		return nil
	case metricShapeTimeseries:
	default:
		return resourcev2.NewError("INVALID_REQUEST", "Metric shape must be current or timeseries.")
	}
	request.Shape = sdkmetric.ShapeTimeseries
	start, err := time.Parse(time.RFC3339, args.StartTime)
	if err != nil {
		return resourcev2.NewError("INVALID_REQUEST", "Timeseries startTime must be RFC 3339.")
	}
	end, err := time.Parse(time.RFC3339, args.EndTime)
	if err != nil {
		return resourcev2.NewError("INVALID_REQUEST", "Timeseries endTime must be RFC 3339.")
	}
	if !start.Before(end) {
		return resourcev2.NewError("INVALID_REQUEST", "Timeseries startTime must be before endTime.")
	}
	request.StartTime, request.EndTime = start, end
	request.Step = end.Sub(start) / metricStepDivisions
	if request.Step == 0 {
		request.Step = time.Nanosecond
	}
	if args.StepSeconds > 0 {
		request.Step = time.Duration(args.StepSeconds) * time.Second
	}
	if end.Sub(start)/request.Step > metricMaxPoints {
		return resourcev2.NewError("INVALID_REQUEST", "The time range has too many points for this step.")
	}
	return nil
}
