package mcprelay

import (
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
	Generation uint64
	Resource *ResourceBinding `json:"-"`
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
	seen := map[string]bool{}
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
				if seen[info.MCPName] {
					info.Status = StatusConflict
				} else {
					seen[info.MCPName] = true
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
	schema, ok := objectSchema(d.InputSchema)
	if !ok {
		info.Status = StatusInvalidSchema
		return info
	}
	if len(d.OutputSchema) > 0 {
		if output, valid := objectSchema(d.OutputSchema); valid {
			info.OutputSchema = output
		}
	}
	if info.Scope == ScopeConnection {
		injectConnectionID(schema, pluginID, pluginName)
	}
	info.InputSchema = schema
	return info
}

func objectSchema(raw json.RawMessage) (map[string]any, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, false
	}
	if schema["type"] != "object" {
		return nil, false
	}
	return schema, true
}

func injectConnectionID(schema map[string]any, pluginID, pluginName string) {
	properties, _ := schema["properties"].(map[string]any)
	if properties == nil {
		properties = map[string]any{}
	}
	properties[connectionIDArg] = map[string]any{
		"type": "string",
		"description": "ID of the " + pluginName + " connection to target. Call " +
			pluginID + "_" + listConnectionsTool + " to list IDs.",
	}
	schema["properties"] = properties

	required := []any{}
	if existing, ok := schema["required"].([]any); ok {
		required = existing
	}
	for _, name := range required {
		if name == connectionIDArg {
			schema["required"] = required
			return
		}
	}
	schema["required"] = append(required, connectionIDArg)
}

func listConnectionsInfo(pluginID, pluginName string) ToolInfo {
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
		Status:  StatusOK,
	}
}
