package resourcecatalog

import (
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// dialectRules captures the per-dialect normalization differences (spec §3).
type dialectRules struct {
	dialect string
	// openAPI marks the OpenAPI 3.0 Schema Object: roots are the
	// components.schemas entries, nullable/discriminator are keywords, boolean
	// exclusive bounds, and no definition containers.
	openAPI bool
	// keepsRefSiblings keeps keywords next to $ref (2020-12 only).
	keepsRefSiblings bool
	// rootDefinitions is the definition container whose top-level entries are
	// normalization roots ("" for OpenAPI).
	rootDefinitions string
}

func dialectRulesFor(dialect string) (dialectRules, error) {
	switch dialect {
	case resourcev2.DialectJSONSchema202012:
		return dialectRules{dialect: dialect, keepsRefSiblings: true, rootDefinitions: "$defs"}, nil
	case resourcev2.DialectJSONSchemaDraft07:
		return dialectRules{dialect: dialect, rootDefinitions: "definitions"}, nil
	case resourcev2.DialectOpenAPI30:
		return dialectRules{dialect: dialect, openAPI: true}, nil
	default:
		return dialectRules{}, resourcev2.NewError(codeUnsupported, "unsupported schema dialect")
	}
}

// sameSchemaDialect compares a document's $schema with a binding dialect,
// ignoring the http/https scheme and a trailing empty fragment on both sides.
func sameSchemaDialect(documentSchema, bindingDialect string) bool {
	return canonicalDialectURI(documentSchema) == canonicalDialectURI(bindingDialect)
}

func canonicalDialectURI(uri string) string {
	if rest, ok := strings.CutPrefix(uri, "https://"); ok {
		uri = rest
	} else if rest, ok := strings.CutPrefix(uri, "http://"); ok {
		uri = rest
	}
	return strings.TrimSuffix(uri, "#")
}
