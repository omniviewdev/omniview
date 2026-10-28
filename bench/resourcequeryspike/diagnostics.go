package main

import (
	"unicode/utf8"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common"
)

type ByteDiagnostic struct {
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Unit    string `json:"unit"`
	Message string `json:"message"`
}

func codepointToByte(source string, codepoint int) (int, error) {
	if codepoint < 0 || !utf8.ValidString(source) {
		return 0, fail("INTERNAL", "invalid native source position")
	}
	index := 0
	for offset := range source {
		if index == codepoint {
			return offset, nil
		}
		index++
	}
	if index == codepoint {
		return len(source), nil
	}
	return 0, fail("INTERNAL", "native position exceeds exact source revision")
}

// No execution binding values are accepted/required for authoring checks.
func AnalyzeDraftEnvironment(r DraftRequest) (Draft, error) {
	out, err := AnalyzeDraft(r.Source, r.Cursor)
	if err != nil {
		return out, err
	}
	if r.DocumentRevision == "" || r.EnvironmentRevision == "" {
		return out, fail("INVALID_REQUEST", "draft revision identity required")
	}
	out.DocumentRevision, out.EnvironmentRevision = r.DocumentRevision, r.EnvironmentRevision
	out.Diagnostics = []ByteDiagnostic{}
	if len(r.Declarations) > 128 {
		return out, fail("RESOURCE_LIMIT", "draft declaration budget")
	}
	opts := []cel.EnvOption{cel.Variable("resource", cel.DynType), cel.CrossTypeNumericComparisons(true), cel.ParserRecursionLimit(64), cel.ParserExpressionSizeLimit(maxSourceBytes)}
	for name, t := range r.Declarations {
		if !validParameter(name) {
			return out, fail("INVALID_REQUEST", "invalid authoring parameter")
		}
		ct, err := bindingCELType(t, 0)
		if err != nil {
			return out, err
		}
		opts = append(opts, cel.Variable(name, ct))
	}
	env, err := cel.NewEnv(opts...)
	if err != nil {
		return out, fail("INVALID_REQUEST", "draft environment rejected")
	}
	_, issues := env.Compile(r.Source)
	if issues == nil || issues.Err() == nil {
		return out, nil
	}
	nativeSource := common.NewStringSource(r.Source, "p01-draft")
	for _, e := range issues.Errors() {
		cp, ok := nativeSource.LocationOffset(e.Location)
		if !ok {
			return out, fail("INTERNAL", "native diagnostic location unavailable")
		}
		start, err := codepointToByte(r.Source, int(cp))
		if err != nil {
			return out, err
		}
		end := start
		if start < len(r.Source) {
			_, width := utf8.DecodeRuneInString(r.Source[start:])
			end += width
		}
		out.Diagnostics = append(out.Diagnostics, ByteDiagnostic{Start: start, End: end, Unit: "utf8-byte", Message: e.Message})
	}
	return out, nil
}
