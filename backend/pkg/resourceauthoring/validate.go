package resourceauthoring

import (
	"bytes"
	"encoding/json"
	"io"
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

// maxSafeInteger is the largest document revision a JavaScript client can
// represent exactly.
const maxSafeInteger = 1<<53 - 1

func invalid(message string) error { return resourcev2.NewError("INVALID_REQUEST", message) }

// UnmarshalJSON decodes a request strictly: duplicate members, unknown
// members, invalid Unicode and trailing data are rejected before any field is
// trusted. Bounds that need a policy are checked by ValidateRequest.
func (r *CompletionRequest) UnmarshalJSON(data []byte) error {
	if err := resourcev2.ValidateJSON(data); err != nil {
		return err
	}
	type plain CompletionRequest
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return invalid("Invalid completion request.")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return invalid("Invalid completion request.")
	}
	*r = CompletionRequest(value)
	return nil
}

// identifier admits a client-chosen or opaque string: non-empty, bounded, valid
// UTF-8 and free of control characters.
func identifier(value string, max int, what string) error {
	if value == "" {
		return invalid(what + " is required.")
	}
	return opaque(value, max, what)
}

func opaque(value string, max int, what string) error {
	if len(value) > max {
		return resourcev2.NewError("RESOURCE_LIMIT", what+" exceeds its byte limit.")
	}
	if !utf8.ValidString(value) {
		return invalid(what + " is not valid UTF-8.")
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return invalid(what + " contains a control character.")
		}
	}
	return nil
}

// ValidateRequest admits the parts of a request that need no catalog: version,
// profile, identifiers, source bytes and Unicode, the cursor unit and position,
// declarations and the suggestion bound. The target is admitted against the
// catalog by the caller. Nothing is clamped silently: an offset outside the
// source or inside a scalar is rejected.
func ValidateRequest(r CompletionRequest, policy Policy) error {
	if r.Version != Version {
		return resourcev2.NewError("UNSUPPORTED", "Unsupported authoring version.")
	}
	if r.Profile != PredicateProfile {
		return resourcev2.NewError("UNSUPPORTED", "Unsupported predicate profile.")
	}
	if err := identifier(r.RequestID, policy.MaxIdentifierBytes, "Request id"); err != nil {
		return err
	}
	if err := identifier(r.DocumentID, policy.MaxIdentifierBytes, "Document id"); err != nil {
		return err
	}
	if r.DocumentRevision > maxSafeInteger {
		return invalid("Document revision exceeds the exact integer range of JavaScript.")
	}
	if len(r.Source) > policy.MaxSourceBytes {
		return resourcev2.NewError("RESOURCE_LIMIT", "Source exceeds the byte limit.")
	}
	if !utf8.ValidString(r.Source) {
		return invalid("Source is not valid UTF-8.")
	}
	if r.Cursor.Unit != UnitUTF8Byte {
		return invalid("Cursor unit must be utf8-byte.")
	}
	if err := ValidateOffset(r.Source, r.Cursor.Offset); err != nil {
		return err
	}
	if len(r.Declarations) > policy.MaxDeclarations {
		return resourcev2.NewError("RESOURCE_LIMIT", "Too many declarations.")
	}
	if err := query.ValidateDeclarations(r.Declarations); err != nil {
		return err
	}
	if r.MaxSuggestions < 1 {
		return invalid("Maximum suggestions must be positive.")
	}
	if r.Target.Route.Connection == "" {
		return invalid("An explicit access route is required.")
	}
	if err := identifier(r.Target.Type, policy.MaxIdentifierBytes, "Type"); err != nil {
		return err
	}
	if err := opaque(r.Target.Representation, policy.MaxIdentifierBytes, "Representation"); err != nil {
		return err
	}
	for _, expected := range []struct{ value, what string }{
		{r.CatalogRevision, "Catalog revision"},
		{r.RepresentationRevision, "Representation revision"},
		{r.SchemaRevision, "Schema revision"},
		{r.EnvironmentRevision, "Environment revision"},
		{r.AccessGeneration, "Access generation"},
	} {
		if err := opaque(expected.value, policy.MaxIdentifierBytes*2, expected.what); err != nil {
			return err
		}
	}
	return nil
}
