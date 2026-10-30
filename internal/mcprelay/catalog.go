package mcprelay

import (
	"bytes"
	"encoding/json"
	"regexp"
	"sort"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

const (
	ScopePlugin     = "plugin"
	ScopeConnection = "connection"

	StatusOK            = "ok"
	StatusInvalidName   = "invalid-name"
	StatusInvalidSchema = "invalid-schema"
	StatusConflict      = "conflict"

	listConnectionsTool = "list_connections"
	connectionIDArg     = "connection_id"
)

// mcpToolNamePattern is the go-sdk tool name charset.
var mcpToolNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}$`)

// ToolInfo is one relay-visible tool after namespacing and schema injection.
type ToolInfo struct {
	MCPName      string
	PluginID     string
	PluginName   string
	Name         string
	Title        string
	Description  string
	Scope        string
	ReadOnly     bool
	Destructive  bool
	Idempotent   bool
	OpenWorld    bool
	InputSchema  map[string]any
	OutputSchema map[string]any
	BuiltIn      bool
	Status       string
	Generation   uint64
	Resource     *ResourceBinding `json:"-"`
}

// BuildCatalog namespaces every plugin tool, injects connection_id into
// connection-scoped schemas and adds one list_connections tool per plugin
// with connection-scoped tools. The result is sorted by plugin, then name.
func BuildCatalog(all map[string]tools.PluginTools) []ToolInfo {
	pluginIDs := make([]string, 0, len(all))
	for id := range all {
		pluginIDs = append(pluginIDs, id)
	}
	sort.Strings(pluginIDs)

	var catalog []ToolInfo
	seen := map[string]int{}
	for _, pluginID := range pluginIDs {
		entry := all[pluginID]
		pluginName := entry.Meta.Name
		if pluginName == "" {
			pluginName = pluginID
		}
		descriptors := append([]sdktools.Descriptor(nil), entry.Tools...)
		sort.SliceStable(descriptors, func(i, j int) bool { return descriptors[i].Name < descriptors[j].Name })

		var infos []ToolInfo
		hasConnectionScoped := false
		for _, d := range descriptors {
			info := toolInfo(pluginID, pluginName, d)
			info.Generation = entry.Generation
			if info.Scope == ScopeConnection {
				hasConnectionScoped = true
			}
			infos = append(infos, info)
		}
		if hasConnectionScoped {
			infos = append([]ToolInfo{listConnectionsInfo(pluginID, pluginName)}, infos...)
		}
		for _, info := range infos {
			if info.Status == StatusOK {
				if previous, exists := seen[info.MCPName]; exists {
					if info.BuiltIn && !catalog[previous].BuiltIn {
						catalog[previous].Status = StatusConflict
						seen[info.MCPName] = len(catalog)
					} else {
						info.Status = StatusConflict
					}
				} else {
					seen[info.MCPName] = len(catalog)
				}
			}
			catalog = append(catalog, info)
		}
	}
	return catalog
}

func toolInfo(pluginID, pluginName string, d sdktools.Descriptor) ToolInfo {
	annotations := d.Annotations.Resolve()
	info := ToolInfo{
		MCPName:     pluginID + "_" + d.Name,
		PluginID:    pluginID,
		PluginName:  pluginName,
		Name:        d.Name,
		Title:       d.Title,
		Description: d.Description,
		Scope:       string(d.Scope),
		ReadOnly:    annotations.ReadOnly,
		Destructive: annotations.Destructive,
		Idempotent:  annotations.Idempotent,
		OpenWorld:   annotations.OpenWorld,
		Status:      StatusOK,
	}
	if !mcpToolNamePattern.MatchString(info.MCPName) {
		info.Status = StatusInvalidName
		return info
	}
	if err := sdktools.ValidateDescriptor(d); err != nil {
		info.Status = StatusInvalidSchema
		return info
	}
	schema, ok := objectSchema(d.InputSchema)
	if !ok {
		info.Status = StatusInvalidSchema
		return info
	}
	if len(d.OutputSchema) > 0 {
		output, valid := objectSchema(d.OutputSchema)
		if !valid {
			info.Status = StatusInvalidSchema
			return info
		}
		info.OutputSchema = output
	}
	if info.Scope == ScopeConnection && !injectConnectionID(schema, pluginID, pluginName) {
		info.Status = StatusInvalidSchema
		return info
	}
	info.InputSchema = schema
	return info
}

func objectSchema(raw json.RawMessage) (map[string]any, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var schema map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&schema); err != nil {
		return nil, false
	}
	if schema["type"] != "object" || !mcpSchemaNumbersSupported(schema) {
		return nil, false
	}
	return schema, true
}

// MCP's registration decoder uses float64 internally. Reject numeric overflow
// before registration, but retain json.Number for exact schema publication.
func mcpSchemaNumbersSupported(value any) bool {
	switch value := value.(type) {
	case json.Number:
		_, err := value.Float64()
		return err == nil
	case map[string]any:
		for _, child := range value {
			if !mcpSchemaNumbersSupported(child) {
				return false
			}
		}
	case []any:
		for _, child := range value {
			if !mcpSchemaNumbersSupported(child) {
				return false
			}
		}
	}
	return true
}

func injectConnectionID(schema map[string]any, pluginID, pluginName string) bool {
	properties := map[string]any{}
	if existing, present := schema["properties"]; present {
		var ok bool
		properties, ok = existing.(map[string]any)
		if !ok || properties == nil {
			return false
		}
	}
	if _, present := properties[connectionIDArg]; present {
		return false
	}
	required := []any{}
	if existing, present := schema["required"]; present {
		var ok bool
		required, ok = existing.([]any)
		if !ok {
			return false
		}
		for _, value := range required {
			name, ok := value.(string)
			if !ok || name == connectionIDArg {
				return false
			}
		}
	}
	properties[connectionIDArg] = map[string]any{
		"type": "string",
		"description": "ID of the " + pluginName + " connection to target. Call " +
			pluginID + "_" + listConnectionsTool + " to list IDs.",
	}
	schema["properties"] = properties

	schema["required"] = append(required, connectionIDArg)
	return true
}

func listConnectionsInfo(pluginID, pluginName string) ToolInfo {
	status := StatusOK
	if !mcpToolNamePattern.MatchString(pluginID + "_" + listConnectionsTool) {
		status = StatusInvalidName
	}
	return ToolInfo{
		MCPName:    pluginID + "_" + listConnectionsTool,
		PluginID:   pluginID,
		PluginName: pluginName,
		Name:       listConnectionsTool,
		Title:      "List " + pluginName + " connections",
		Description: "List " + pluginName + " connections the AI tools may target, " +
			"with the tools enabled on each.",
		Scope:    ScopePlugin,
		ReadOnly: true,
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
		BuiltIn: true,
		Status:  status,
	}
}
