package resourcecatalog

import (
	"slices"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// HostEvaluation states.
const (
	HostEvaluationSchemaChecked = "schemaChecked"
	HostEvaluationDynamic       = "dynamic"
	HostEvaluationUnavailable   = "unavailable"
	HostEvaluationUnsupported   = "unsupported"
)

// TypeOverlay states what the host can check for one representation and
// what the provider declares natively. A schema never grants native
// capabilities or native filtering.
type TypeOverlay struct {
	Operations           []resourcev2.Operation // Descriptor.Capabilities operations, sorted, unique
	NativeQueryLanguages []string               // only when OperationNativeQuery is declared; else empty
	HostEvaluation       string                 // "schemaChecked"|"dynamic"|"unavailable"|"unsupported"
	HostEvaluationCode   string                 // error code when unavailable or unsupported
	Validation           string                 // "full"|"reduced"|"none"
	Unvalidated          []Constraint
}

// OverlayFor derives the overlay of entry from its resolve outcome: a
// resolved schema, an absent schema (nil, nil) or a resolve error.
func OverlayFor(entry *Entry, schema *Schema, resolveErr error) TypeOverlay {
	overlay := TypeOverlay{
		Operations:           []resourcev2.Operation{},
		NativeQueryLanguages: []string{},
		Validation:           ValidationNone,
	}
	for _, capability := range entry.Descriptor.Capabilities {
		overlay.Operations = append(overlay.Operations, capability.Operation)
	}
	slices.Sort(overlay.Operations)
	overlay.Operations = slices.Compact(overlay.Operations)
	if slices.Contains(overlay.Operations, resourcev2.OperationNativeQuery) {
		for _, query := range entry.Descriptor.NativeQueries {
			overlay.NativeQueryLanguages = append(overlay.NativeQueryLanguages, query.Language)
		}
		slices.Sort(overlay.NativeQueryLanguages)
		overlay.NativeQueryLanguages = slices.Compact(overlay.NativeQueryLanguages)
	}

	switch {
	case entry.Binding.State == schemaStateUnavailable:
		overlay.HostEvaluation = HostEvaluationUnavailable
		overlay.HostEvaluationCode = resourcev2.ErrorCode(unavailableBinding(entry.Binding))
	case resolveErr != nil:
		overlay.HostEvaluationCode = resourcev2.ErrorCode(resolveErr)
		overlay.HostEvaluation = HostEvaluationUnavailable
		if isDeterministic(resolveErr) {
			overlay.HostEvaluation = HostEvaluationUnsupported
		}
	case schema == nil:
		overlay.HostEvaluation = HostEvaluationDynamic
	default:
		overlay.HostEvaluation = HostEvaluationSchemaChecked
		overlay.Validation = schema.Validation
		overlay.Unvalidated = schema.Unvalidated
	}
	return overlay
}
