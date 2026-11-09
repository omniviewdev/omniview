// Package resourceauthoring is the host language service for resource
// predicates (profile omniview.resource-predicate.v1). It answers one question
// per request: which edits are valid at this cursor, given the admitted
// resource schema, the declared parameters and the draft text?
//
// Ownership (P01 §4/§8.2, P07 §1): the host catalog (resourcecatalog) is the
// only schema authority, the CEL parser is the only syntax authority, and this
// package is the only authoring authority. Clients render its output and apply
// its edits; they never walk schemas, canonicalize paths or implement union
// narrowing. Nothing here evaluates a predicate or owns a second catalog.
//
// Units. Every offset on the wire is a zero-based, half-open UTF-8 byte offset
// into the exact source of the request's document revision (unit "utf8-byte").
// The CEL parser reports Unicode scalar offsets and browser editors count
// UTF-16 code units; units.go converts between all three against an exact
// source and rejects offsets that split a scalar or a surrogate pair.
//
// Parser context. A tolerant lexer only delimits tokens and operand chains. The
// grammatical role of the cursor (member, index, value, operator or expression
// position) is derived from the token before it, every operand is parsed by the
// real CEL parser and resolved from that AST, and macro element variables are
// bound from the parsed receiver of the enclosing macro call. Suggestions are
// valid only where that role and the schema agree.
package resourceauthoring
