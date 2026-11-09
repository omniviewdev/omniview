package resourceauthoring

import "time"

// PolicyVersion identifies the authoring limits (P01 §9 "Authoring" row).
const PolicyVersion = "omniview.authoring-policy.v1"

// Policy bounds one completion request and the document registry. Every limit
// is a finite safety ceiling; a request can lower MaxSuggestions but never
// raise any of them.
type Policy struct {
	// MaxSuggestions is the item ceiling of one response (P01: 128).
	MaxSuggestions int
	// MaxResponseBytes bounds the encoded response (P01: 65536).
	MaxResponseBytes int
	// MaxSourceBytes bounds the draft (P01 CEL source: 16384).
	MaxSourceBytes int
	// MaxDeclarations bounds the typed parameters (P01: 128).
	MaxDeclarations int
	// MaxPathDepth bounds the schema path of one operand, and with it the
	// number of catalog navigations a request performs.
	MaxPathDepth int
	// MaxDocumentationBytes bounds title and description text per item.
	MaxDocumentationBytes int
	// MaxIdentifierBytes bounds request, document and identity strings.
	MaxIdentifierBytes int
	// Deadline is the request deadline (P01: 250ms), covering catalog
	// admission, resolution and completion. Zero disables it.
	Deadline time.Duration
	// MaxDocuments bounds tracked documents; the least recently used are
	// evicted. DocumentIdleTTL expires idle entries.
	MaxDocuments    int
	DocumentIdleTTL time.Duration
}

// DefaultPolicy returns the reference ceilings of P01 §9.
func DefaultPolicy() Policy {
	return Policy{
		MaxSuggestions:        128,
		MaxResponseBytes:      65536,
		MaxSourceBytes:        16384,
		MaxDeclarations:       128,
		MaxPathDepth:          32,
		MaxDocumentationBytes: 512,
		MaxIdentifierBytes:    256,
		Deadline:              250 * time.Millisecond,
		MaxDocuments:          1024,
		DocumentIdleTTL:       10 * time.Minute,
	}
}

// Valid reports whether every ceiling is positive, except Deadline which may be
// zero in tests that supply their own context.
func (p Policy) Valid() bool {
	return p.MaxSuggestions > 0 && p.MaxResponseBytes > 0 && p.MaxSourceBytes > 0 &&
		p.MaxDeclarations > 0 && p.MaxPathDepth > 0 && p.MaxDocumentationBytes > 0 &&
		p.MaxIdentifierBytes > 0 && p.Deadline >= 0 && p.MaxDocuments > 0 && p.DocumentIdleTTL > 0
}
