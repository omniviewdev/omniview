package query

import (
	"bytes"
	"context"
	"encoding/json"
	"sync"

	"cel.dev/cel-go/cel"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ParsedPredicate contains either CEL's parsed AST or a validated Builder document.
// Checking and execution are deliberately separate operations.
type ParsedPredicate struct {
	CEL     *cel.Ast
	Builder *BuilderDocument
}
type BuilderDocument struct {
	Version string          `json:"version"`
	Root    json.RawMessage `json:"root"`
}

var parserOnce sync.Once
var parserEnv *cel.Env
var parserInitErr error

func predicateParser() (*cel.Env, error) {
	parserOnce.Do(func() {
		parserEnv, parserInitErr = cel.NewEnv(cel.CrossTypeNumericComparisons(true), cel.ParserRecursionLimit(64), cel.ParserExpressionSizeLimit(16384))
	})
	if parserInitErr != nil {
		return nil, resourcev2.NewError("INTERNAL", "predicate parser initialization failed")
	}
	return parserEnv, nil
}

// PredicateParser returns the parse-only CEL environment of profile
// omniview.resource-predicate.v1, with its parser recursion and size limits.
// Authoring parses drafts with the same environment that admits saved queries,
// so there is one parser configuration. The environment is immutable and shared.
func PredicateParser() (*cel.Env, error) { return predicateParser() }

// Parse parses a previously admitted predicate without evaluating or type-checking it.
func Parse(ctx context.Context, q QuerySpec) (ParsedPredicate, error) {
	if err := ctx.Err(); err != nil {
		return ParsedPredicate{}, contextError(err)
	}
	p := q.Predicate
	switch p.Language {
	case "cel":
		if p.Profile != "omniview.resource-predicate.v1" || p.Version != "" || p.Document != nil || p.Source == "" {
			return ParsedPredicate{}, invalid("invalid CEL predicate")
		}
		if len(p.Source) > 16384 {
			return ParsedPredicate{}, limit("predicate source too large")
		}
		env, err := predicateParser()
		if err != nil {
			return ParsedPredicate{}, err
		}
		ast, issues := env.Parse(p.Source)
		if issues.Err() != nil {
			return ParsedPredicate{}, invalid("invalid CEL syntax")
		}
		if err := ctx.Err(); err != nil {
			return ParsedPredicate{}, contextError(err)
		}
		return ParsedPredicate{CEL: ast}, nil
	case "builder":
		if p.Version != "omniview.builder.v1" || p.Profile != "" || p.Source != "" || len(p.Document) == 0 {
			return ParsedPredicate{}, invalid("invalid builder predicate")
		}
		if _, err := objectFields(p.Document, []string{"version", "root"}, nil); err != nil {
			return ParsedPredicate{}, err
		}
		var doc BuilderDocument
		if err := strictDecode(p.Document, &doc); err != nil || doc.Version != "omniview.builder.v1" || len(doc.Root) == 0 {
			return ParsedPredicate{}, invalid("invalid builder document")
		}
		if err := validateBuilderNode(doc.Root, q.Declarations, map[string]bool{}, 0); err != nil {
			return ParsedPredicate{}, err
		}
		if err := ctx.Err(); err != nil {
			return ParsedPredicate{}, contextError(err)
		}
		return ParsedPredicate{Builder: &doc}, nil
	default:
		return ParsedPredicate{}, invalid("unknown predicate language")
	}
}
func contextError(err error) error {
	if err == context.DeadlineExceeded {
		return resourcev2.NewError("TIMEOUT", "query parsing deadline exceeded")
	}
	return resourcev2.NewError("CANCELLED", "query parsing cancelled")
}
func strictDecode(data []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	return d.Decode(out)
}

type builderPath struct {
	Root     json.RawMessage   `json:"root"`
	Segments DocumentFieldPath `json:"segments"`
}
type builderCondition struct {
	Kind  string          `json:"kind"`
	Path  builderPath     `json:"path"`
	Value json.RawMessage `json:"value"`
}
type builderOperand struct {
	Kind  string            `json:"kind"`
	Name  string            `json:"name,omitempty"`
	Type  *BindingType      `json:"type,omitempty"`
	Value *resourcev2.Value `json:"value,omitempty"`
}
type builderNode struct {
	Kind     string             `json:"kind"`
	Path     *builderPath       `json:"path,omitempty"`
	State    string             `json:"state,omitempty"`
	Op       string             `json:"op,omitempty"`
	Operand  *builderOperand    `json:"operand,omitempty"`
	When     []builderCondition `json:"when,omitempty"`
	Children []json.RawMessage  `json:"children,omitempty"`
	Child    json.RawMessage    `json:"child,omitempty"`
	Element  string             `json:"element,omitempty"`
}

func validateBuilderPath(p *builderPath, scope map[string]bool) error {
	if p == nil || p.Segments == nil {
		return invalid("invalid builder path")
	}
	if err := validatePath(p.Segments); err != nil {
		return err
	}
	var root string
	if json.Unmarshal(p.Root, &root) == nil {
		if root != "resource" {
			return invalid("invalid builder root")
		}
		return nil
	}
	var ref struct {
		Element string `json:"element"`
	}
	if strictDecode(p.Root, &ref) != nil || !scope[ref.Element] {
		return invalid("unknown builder element")
	}
	return nil
}
func validateBuilderNode(raw json.RawMessage, decl map[string]BindingType, scope map[string]bool, depth int) error {
	if depth > 32 {
		return limit("builder too deep")
	}
	var n builderNode
	if strictDecode(raw, &n) != nil {
		return invalid("invalid builder node")
	}
	var required, optional []string
	switch n.Kind {
	case "state":
		required = []string{"kind", "path", "state"}
	case "value":
		required = []string{"kind", "path", "op", "operand"}
		optional = []string{"when"}
	case "all", "any":
		required = []string{"kind", "children"}
	case "not":
		required = []string{"kind", "child"}
	case "exists":
		required = []string{"kind", "path", "element", "child"}
		optional = []string{"when"}
	default:
		return invalid("unknown builder node")
	}
	fields, err := objectFields(raw, required, optional)
	if err != nil {
		return err
	}
	if path, ok := fields["path"]; ok {
		if err := validateBuilderPathShape(path); err != nil {
			return err
		}
	}
	if conditions, ok := fields["when"]; ok {
		var list []json.RawMessage
		if json.Unmarshal(conditions, &list) != nil || list == nil {
			return invalid("invalid builder conditions")
		}
		for _, condition := range list {
			c, err := objectFields(condition, []string{"kind", "path", "value"}, nil)
			if err != nil {
				return err
			}
			if err = validateBuilderPathShape(c["path"]); err != nil {
				return err
			}
		}
	}
	if n.Kind == "value" {
		var operand map[string]json.RawMessage
		switch n.Operand.Kind {
		case "parameter":
			operand, err = objectFields(fields["operand"], []string{"kind", "name"}, nil)
		case "literal":
			operand, err = objectFields(fields["operand"], []string{"kind", "type", "value"}, nil)
		default:
			return invalid("invalid operand")
		}
		if err != nil {
			return err
		}
		if n.Operand.Kind == "literal" {
			if err = validateTypeShape(operand["type"], 0); err != nil {
				return err
			}
		}
	}
	switch n.Kind {
	case "state":
		if n.State != "absent" && n.State != "present" && n.State != "null" && n.State != "nonNull" {
			return invalid("invalid builder state")
		}
		if n.Op != "" || n.Operand != nil || n.When != nil || n.Children != nil || n.Child != nil || n.Element != "" {
			return invalid("invalid state fields")
		}
		return validateBuilderPath(n.Path, scope)
	case "value":
		if n.Op != "equal" && n.Op != "notEqualPresent" || n.Operand == nil || n.State != "" || n.Children != nil || n.Child != nil || n.Element != "" {
			return invalid("invalid value node")
		}
		if err := validateBuilderPath(n.Path, scope); err != nil {
			return err
		}
		o := n.Operand
		switch o.Kind {
		case "parameter":
			if o.Name == "" || o.Type != nil || o.Value != nil {
				return invalid("invalid parameter operand")
			}
			if _, ok := decl[o.Name]; !ok {
				return invalid("unknown parameter")
			}
		case "literal":
			if o.Name != "" || o.Type == nil || o.Value == nil {
				return invalid("invalid literal operand")
			}
			if err := checkBinding(*o.Type, *o.Value, 0); err != nil {
				return err
			}
		default:
			return invalid("invalid operand")
		}
	case "all", "any":
		if len(n.Children) == 0 || n.Path != nil || n.State != "" || n.Op != "" || n.Operand != nil || n.When != nil || n.Child != nil || n.Element != "" {
			return invalid("invalid builder group")
		}
		for _, child := range n.Children {
			if err := validateBuilderNode(child, decl, scope, depth+1); err != nil {
				return err
			}
		}
		return nil
	case "not":
		if len(n.Child) == 0 || n.Path != nil || n.State != "" || n.Op != "" || n.Operand != nil || n.When != nil || n.Children != nil || n.Element != "" {
			return invalid("invalid negation")
		}
		return validateBuilderNode(n.Child, decl, scope, depth+1)
	case "exists":
		if n.Path == nil || len(n.Child) == 0 || !parameterName.MatchString(n.Element) || reservedNames[n.Element] || scope[n.Element] || n.State != "" || n.Op != "" || n.Operand != nil || n.Children != nil {
			return invalid("invalid exists node")
		}
		if _, ok := decl[n.Element]; ok {
			return invalid("builder element shadows parameter")
		}
		if err := validateBuilderPath(n.Path, scope); err != nil {
			return err
		}
	default:
		return invalid("unknown builder node")
	}
	for _, c := range n.When {
		if c.Kind != "discriminatorEquals" {
			return invalid("invalid builder condition")
		}
		if err := validateBuilderPath(&c.Path, scope); err != nil {
			return err
		}
		var v any
		if json.Unmarshal(c.Value, &v) != nil {
			return invalid("invalid discriminator")
		}
		switch v.(type) {
		case string, bool:
		default:
			return invalid("invalid discriminator")
		}
	}
	if n.Kind == "exists" {
		next := make(map[string]bool, len(scope)+1)
		for k, v := range scope {
			next[k] = v
		}
		next[n.Element] = true
		return validateBuilderNode(n.Child, decl, next, depth+1)
	}
	return nil
}
