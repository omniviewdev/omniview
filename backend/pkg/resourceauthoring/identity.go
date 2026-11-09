package resourceauthoring

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

// Identity tokens are opaque equality data (P01 §8.2): a client compares them
// and never orders or parses them. Each is a digest over everything that must
// change it, prefixed with a token family and version.

func digest(prefix string, parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		hash.Write([]byte(part))
		hash.Write([]byte{0})
	}
	return prefix + hex.EncodeToString(hash.Sum(nil))[:32]
}

// AccessGeneration identifies the host-admitted access under which a schema was
// resolved: the provider generation, the connection and its source epoch, and
// the invocation principal with its generation slot. It changes when the
// provider restarts, the connection's configuration or authority changes, or the
// principal's grant generation moves. No permission epoch exists on the host yet
// beyond the principal's generation slot; when one does, it belongs in parts.
func AccessGeneration(parts ...string) string { return digest("ag1.", parts...) }

// ScopeKey is the digest of a normalized query scope: constraints in dimension
// order, values sorted and de-duplicated, so equal scopes have equal keys.
func ScopeKey(scope resourcev2.QueryScope) string {
	type constraint struct {
		Dimension string   `json:"dimension"`
		Match     string   `json:"match"`
		Values    []string `json:"values,omitempty"`
	}
	normalized := make([]constraint, 0, len(scope))
	for _, c := range scope {
		item := constraint{Dimension: c.Dimension, Match: string(c.Match)}
		if c.Values != nil {
			item.Values = slices.Compact(slices.Sorted(slices.Values(*c.Values)))
			if item.Values == nil {
				item.Values = []string{}
			}
		}
		normalized = append(normalized, item)
	}
	slices.SortFunc(normalized, func(a, b constraint) int { return strings.Compare(a.Dimension, b.Dimension) })
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return digest("sk1.", "unencodable")
	}
	return digest("sk1.", string(encoded))
}

// EnvironmentRevision is the authoring identity of the CEL environment a draft
// is checked in: the catalog-bound environment revision (snapshot,
// representation and schema revisions), the parameter declaration types, the
// language profile and this implementation. A changed declaration type
// invalidates answers even for unchanged source (P01 §4).
func EnvironmentRevision(celEnvironmentRevision string, declarations map[string]query.BindingType) string {
	encoded, err := json.Marshal(declarations)
	if err != nil {
		encoded = []byte("unencodable")
	}
	return digest("env1.", PredicateProfile, ImplementationRevision, PolicyVersion, celEnvironmentRevision, string(encoded))
}

// StaleMembers names the identity members the request expected and the host no
// longer has, in a fixed order. Empty expectations are not checked.
func StaleMembers(request CompletionRequest, current Identity) []string {
	var stale []string
	for _, check := range []struct{ name, expected, actual string }{
		{"catalogRevision", request.CatalogRevision, current.CatalogRevision},
		{"representationRevision", request.RepresentationRevision, current.RepresentationRevision},
		{"schemaRevision", request.SchemaRevision, current.SchemaRevision},
		{"environmentRevision", request.EnvironmentRevision, current.EnvironmentRevision},
		{"accessGeneration", request.AccessGeneration, current.AccessGeneration},
	} {
		if check.expected != "" && check.expected != check.actual {
			stale = append(stale, check.name)
		}
	}
	return stale
}
