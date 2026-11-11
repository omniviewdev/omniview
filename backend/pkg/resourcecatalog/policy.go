// Package resourcecatalog is the host's authoritative resource schema catalog.
//
// It normalizes raw provider schema documents (JSON Schema 2020-12, JSON Schema
// draft-07 and the OpenAPI 3.0 Schema Object) into a bounded structural model,
// shares immutable normalized documents by content digest, and scopes demanded
// target observations to one authenticated plugin/generation/connection/epoch.
// Support revisions reconcile unchanged targets instead of retiring schema
// ownership. This is the host's sole schema normalizer and validation authority.
package resourcecatalog

import resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

// PolicyVersion names the measured catalog policy. Raising any ceiling requires
// a reviewed policy revision.
const PolicyVersion = "omniview.schema-policy.v1"

// Policy holds the finite safety ceilings applied by normalization, retention,
// navigation and admission. Hosts may lower them; exceeding one yields
// RESOURCE_LIMIT (or truncation for the navigation fields).
type Policy struct {
	// MaxDocumentBytes bounds raw document bytes before decoding.
	MaxDocumentBytes int
	// MaxDocumentNodes bounds normalized nodes, synthesized nodes included.
	MaxDocumentNodes int
	// MaxDefinitions bounds entries of all definition containers in a document.
	MaxDefinitions int
	// MaxDepth bounds structural nesting of schema-valued source locations.
	MaxDepth int
	// MaxRefChain bounds consecutive $ref hops to the first non-$ref target.
	MaxRefChain int
	// MaxUnionBranches bounds branches of one allOf, anyOf or oneOf.
	MaxUnionBranches int
	// MaxEnumValues bounds entries of one enum.
	MaxEnumValues int
	// MaxNavigationVisits bounds node expansions per navigation request.
	MaxNavigationVisits int
	// MaxNavigationFields bounds listed fields per navigation request.
	MaxNavigationFields int
	// MaxAdmissionWork bounds admission work units per Admit call.
	MaxAdmissionWork int
	// MaxRetainedDocuments bounds normalized documents retained by one catalog.
	MaxRetainedDocuments int
	// MaxRetainedBytes bounds retained bytes across all documents of one catalog.
	MaxRetainedBytes int64
}

// DefaultPolicy returns the omniview.schema-policy.v1 ceilings (spec §9).
func DefaultPolicy() Policy {
	return Policy{
		MaxDocumentBytes:     resourcev2.MaxDocumentBytes,
		MaxDocumentNodes:     262144,
		MaxDefinitions:       1024,
		MaxDepth:             64,
		MaxRefChain:          2,
		MaxUnionBranches:     8,
		MaxEnumValues:        256,
		MaxNavigationVisits:  4096,
		MaxNavigationFields:  128,
		MaxAdmissionWork:     1 << 20,
		MaxRetainedDocuments: 256,
		MaxRetainedBytes:     256 << 20,
	}
}
