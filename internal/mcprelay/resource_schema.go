package mcprelay

import (
	"fmt"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Tagged schemas describe canonical transport, not a lossy projection to JSON
// numbers. Numeric bounds remain enforced by the native schema validator.
func taggedSchema(schema resourcev2.Schema) map[string]any {
	properties := make(map[string]any, len(schema.Properties))
	for name, property := range schema.Properties {
		properties[name] = taggedProperty(property)
	}
	payload := map[string]any{"type": "object", "properties": properties}
	if len(schema.Required) > 0 {
		payload["required"] = schema.Required
	}
	return taggedBranch("map", payload)
}
func taggedBranch(kind string, payload map[string]any) map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{"kind": map[string]any{"const": kind}, "value": payload}, "required": []string{"kind", "value"}, "additionalProperties": false}
}
func taggedProperty(property resourcev2.SchemaProperty) map[string]any {
	var result map[string]any
	switch property.Type {
	case resourcev2.SchemaString:
		payload := map[string]any{"type": "string"}
		if len(property.Enum) > 0 {
			payload["enum"] = property.Enum
		}
		result = taggedBranch("string", payload)
	case resourcev2.SchemaBoolean:
		result = taggedBranch("bool", map[string]any{"type": "boolean"})
	case resourcev2.SchemaInteger:
		result = map[string]any{"oneOf": []any{taggedBranch("int64", map[string]any{"type": "string", "pattern": "^-?(0|[1-9][0-9]*)$"}), taggedBranch("uint64", map[string]any{"type": "string", "pattern": "^(0|[1-9][0-9]*)$"}), taggedBranch("double", map[string]any{"type": "integer"})}}
	case resourcev2.SchemaNumber:
		result = map[string]any{"oneOf": []any{taggedBranch("int64", map[string]any{"type": "string"}), taggedBranch("uint64", map[string]any{"type": "string"}), taggedBranch("double", map[string]any{"type": "number"})}}
	case resourcev2.SchemaObject:
		result = taggedSchema(resourcev2.Schema{Properties: property.Properties, Required: property.Required})
	case resourcev2.SchemaArray:
		result = taggedBranch("list", map[string]any{"type": "array", "items": taggedValueSchema()})
	default:
		result = taggedValueSchema()
	}
	description := property.Description
	if property.Minimum != nil {
		description += fmt.Sprintf(" Native numeric minimum: %g.", *property.Minimum)
	}
	if property.Maximum != nil {
		description += fmt.Sprintf(" Native numeric maximum: %g.", *property.Maximum)
	}
	if description != "" {
		result["description"] = description
	}
	return result
}
