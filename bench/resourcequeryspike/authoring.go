package main

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"cel.dev/cel-go/cel"
)

func LowerClause(c Clause) (string, error) {
	if len(c.Path) == 0 || len(c.Path) > maxDepth {
		return "", fail("INVALID_REQUEST", "builder member path required")
	}
	path := "resource"
	guards := []string{}
	for _, member := range c.Path {
		if member == "" || !utf8.ValidString(member) {
			return "", fail("INVALID_REQUEST", "invalid builder path")
		}
		quoted, _ := json.Marshal(member)
		parent := path
		path += "[" + string(quoted) + "]"
		guards = append(guards, "(type("+parent+") == map && "+string(quoted)+" in "+parent+")", path+" != null")
	}
	// dyn fixture paths require explicit ancestor/null guards.
	presentGuards := append([]string{}, guards[:len(guards)-1]...)
	present := "(" + strings.Join(presentGuards, " && ") + ")"
	nonNull := "(" + strings.Join(guards, " && ") + ")"
	switch c.Kind {
	case "absent":
		return "!(" + present + ")", nil
	case "present":
		return present, nil
	case "null":
		return "(" + present + " && " + path + " == null)", nil
	case "nonNull":
		return nonNull, nil
	case "equal", "not", "notEqualPresent":
		if !validParameter(c.Parameter) {
			return "", fail("INVALID_REQUEST", "builder parameter identifier required")
		}
		positive := "(" + nonNull + " && " + path + " == " + c.Parameter + ")"
		if c.Kind == "not" {
			return "!(" + positive + ")", nil
		}
		if c.Kind == "notEqualPresent" {
			return "(" + nonNull + " && " + path + " != " + c.Parameter + ")", nil
		}
		return positive, nil
	default:
		return "", fail("UNSUPPORTED", "builder clause outside finite supported subset")
	}
}

type Draft struct {
	Valid               bool             `json:"valid"`
	Context             string           `json:"context"`
	Start               int              `json:"start"`
	End                 int              `json:"end"`
	Unit                string           `json:"unit"`
	UTF16Start          int              `json:"utf16Start"`
	Diagnostic          string           `json:"diagnostic,omitempty"`
	DocumentRevision    string           `json:"documentRevision"`
	EnvironmentRevision string           `json:"environmentRevision"`
	Diagnostics         []ByteDiagnostic `json:"diagnostics"`
}

func ByteToUTF16(source string, offset int) (int, error) {
	if !utf8.ValidString(source) || offset < 0 || offset > len(source) || !utf8.ValidString(source[:offset]) {
		return 0, fail("INVALID_REQUEST", "cursor splits UTF-8 or exceeds source")
	}
	units := 0
	for _, r := range source[:offset] {
		units++
		if r > 0xffff {
			units++
		}
	}
	return units, nil
}

// AnalyzeDraft performs bounded lexical cursor recovery and real native CEL
// parsing. It does not claim schema-backed completion, grammar recovery, or a
// checked AST for an incomplete draft. It never evaluates repaired source.
func AnalyzeDraft(source string, cursor int) (Draft, error) {
	out := Draft{Unit: "utf8-byte", Start: cursor, End: cursor}
	if len(source) > maxSourceBytes {
		return out, fail("RESOURCE_LIMIT", "draft source bytes")
	}
	units, err := ByteToUTF16(source, cursor)
	if err != nil {
		return out, err
	}
	out.UTF16Start = units
	env, err := cel.NewEnv(cel.Variable("resource", cel.DynType), cel.CrossTypeNumericComparisons(true), cel.ParserRecursionLimit(64), cel.ParserExpressionSizeLimit(maxSourceBytes))
	if err != nil {
		return out, fail("INTERNAL", "draft environment")
	}
	_, issues := env.Parse(source)
	out.Valid = issues == nil || issues.Err() == nil
	if !out.Valid {
		out.Diagnostic = "incomplete or invalid CEL source; draft remains editable"
	}
	// Only recover unquoted member chains rooted at resource. Advanced quoted
	// paths remain intact in text and are explicitly outside this recognizer.
	prefix := source[:cursor]
	start := len(prefix)
	for start > 0 {
		b := prefix[start-1]
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '_' || b == '.' {
			start--
		} else {
			break
		}
	}
	token := prefix[start:]
	if token == "resource" || strings.HasPrefix(token, "resource.") {
		parts := strings.Split(token, ".")
		valid := true
		for i, p := range parts {
			if p == "" && i == len(parts)-1 {
				continue
			}
			if !identifier.MatchString(p) {
				valid = false
			}
		}
		if valid && len(parts) > 1 {
			out.Context = strings.Join(parts[:len(parts)-1], ".")
			out.Start = cursor - len(parts[len(parts)-1])
			for out.End < len(source) {
				b := source[out.End]
				if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '_' {
					out.End++
				} else {
					break
				}
			}
			out.UTF16Start, _ = ByteToUTF16(source, out.Start)
		}
	}
	return out, nil
}
