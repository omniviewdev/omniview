package activity

import (
	"slices"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func cloneRecord(record sdk.Record) sdk.Record {
	record.Source = cloneSource(record.Source)
	record.Presentation = clonePresentation(record.Presentation)
	if record.Task != nil {
		task := *record.Task
		record.Task = &task
	}
	if record.Alert != nil {
		alert := *record.Alert
		record.Alert = &alert
	}
	return record
}

func cloneSource(source sdk.Source) sdk.Source {
	if source.Resource != nil {
		resource := cloneNavigationIntent(*source.Resource)
		source.Resource = &resource
	}
	return source
}

func cloneChange(change sdk.Change) sdk.Change {
	if change.Record != nil {
		record := cloneRecord(*change.Record)
		change.Record = &record
	}
	change.RemovedIDs = slices.Clone(change.RemovedIDs)
	return change
}

func clonePresentation(presentation sdk.Presentation) sdk.Presentation {
	if presentation.Progress != nil {
		progress := *presentation.Progress
		presentation.Progress = &progress
	}
	presentation.Metrics = slices.Clone(presentation.Metrics)
	presentation.Actions = slices.Clone(presentation.Actions)
	for i := range presentation.Actions {
		action := &presentation.Actions[i]
		if action.Target != nil {
			target := cloneNavigationIntent(*action.Target)
			action.Target = &target
		}
		if action.Intent != nil {
			intent := *action.Intent
			intent.Request = cloneActionRequest(intent.Request)
			action.Intent = &intent
		}
	}
	return presentation
}

func cloneNavigationIntent(intent resourcev2.ResourceNavigationIntent) resourcev2.ResourceNavigationIntent {
	intent.Reference = cloneReference(intent.Reference)
	return intent
}

func cloneReference(reference resourcev2.ResourceReference) resourcev2.ResourceReference {
	reference.Address.Scope = slices.Clone(reference.Address.Scope)
	if reference.Incarnation != nil {
		incarnation := *reference.Incarnation
		reference.Incarnation = &incarnation
	}
	return reference
}

func cloneActionRequest(request resourcev2.ActionRequest) resourcev2.ActionRequest {
	request.Reference = cloneReference(request.Reference)
	request.Input = cloneValue(request.Input)
	if request.TypeTarget != nil {
		target := *request.TypeTarget
		target.Scope = slices.Clone(target.Scope)
		for i := range target.Scope {
			if target.Scope[i].Values != nil {
				values := slices.Clone(*target.Scope[i].Values)
				target.Scope[i].Values = &values
			}
		}
		request.TypeTarget = &target
	}
	if request.ExpectedDescriptor != nil {
		descriptor := *request.ExpectedDescriptor
		descriptor.ParamsSchema = cloneSchema(descriptor.ParamsSchema)
		descriptor.OutputSchema = cloneSchema(descriptor.OutputSchema)
		request.ExpectedDescriptor = &descriptor
	}
	return request
}

func cloneValue(value resourcev2.Value) resourcev2.Value {
	if value.List != nil {
		list := make([]resourcev2.Value, len(value.List))
		for i := range value.List {
			list[i] = cloneValue(value.List[i])
		}
		value.List = list
	}
	if value.Map != nil {
		values := make(map[string]resourcev2.Value, len(value.Map))
		for key, item := range value.Map {
			values[key] = cloneValue(item)
		}
		value.Map = values
	}
	return value
}

func cloneSchema(schema *resourcev2.Schema) *resourcev2.Schema {
	if schema == nil {
		return nil
	}
	return &resourcev2.Schema{
		Properties: cloneSchemaProperties(schema.Properties),
		Required:   slices.Clone(schema.Required),
	}
}

func cloneSchemaProperties(properties map[string]resourcev2.SchemaProperty) map[string]resourcev2.SchemaProperty {
	if properties == nil {
		return nil
	}
	result := make(map[string]resourcev2.SchemaProperty, len(properties))
	for key, property := range properties {
		property.Enum = slices.Clone(property.Enum)
		property.Required = slices.Clone(property.Required)
		property.Properties = cloneSchemaProperties(property.Properties)
		if property.Minimum != nil {
			minimum := *property.Minimum
			property.Minimum = &minimum
		}
		if property.Maximum != nil {
			maximum := *property.Maximum
			property.Maximum = &maximum
		}
		result[key] = property
	}
	return result
}
