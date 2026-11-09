package resourceauthoring

import (
	"strings"
	"sync"

	"cel.dev/cel-go/cel"
	celast "cel.dev/cel-go/common/ast"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

// Parser context.
//
// The cursor's grammatical role comes from the token before it (a "." means a
// member position, a comparison operator a value position, and so on). The
// operand that role applies to is delimited lexically as a postfix chain, then
// parsed by the real CEL parser and resolved from its AST. Macro element
// variables are bound by parsing the receiver of each enclosing macro call.
// Neither an unparsable earlier clause nor a missing closing bracket prevents
// completion in the clause under the cursor: only the operand slice must parse.

var (
	parserOnce sync.Once
	parserEnv  *cel.Env
	parserErr  error
)

// authoringParser is the predicate profile's parser plus macro call tracking,
// which lets a parsed macro expansion be named (exists, all, filter, ...).
func authoringParser() (*cel.Env, error) {
	parserOnce.Do(func() {
		base, err := query.PredicateParser()
		if err != nil {
			parserErr = err
			return
		}
		parserEnv, parserErr = base.Extend(cel.EnableMacroCallTracking())
	})
	return parserEnv, parserErr
}

type slotKind uint8

const (
	slotNone slotKind = iota
	slotMember
	slotIndex
	slotValue
	slotOperator
	slotExpression
)

func (k slotKind) context() string {
	switch k {
	case slotMember:
		return ContextMember
	case slotIndex:
		return ContextIndex
	case slotValue:
		return ContextValue
	case slotOperator:
		return ContextOperator
	case slotExpression:
		return ContextExpression
	}
	return ContextNone
}

// group is an unmatched opening bracket before the cursor.
type group struct {
	open int  // significant token index
	kind byte // '(' '[' '{'
}

// slot is the lexical classification of the cursor.
type slot struct {
	kind   slotKind
	touch  int // significant token touching the cursor, or -1
	prev   int // significant token before the touched token (or the cursor), or -1
	cursor int
	// replace is the token range the default edit replaces; prefix is the
	// decoded text of that token before the cursor.
	replaceStart, replaceEnd int
	prefix                   string
	// Value slots: the comparison operator, or inList for an "in [...]" element.
	cmp    string
	inList bool
	// chainEnd is the significant token where the operand chain ends, or -1.
	chainEnd int
	groups   []group
}

type analyzer struct {
	source   string
	all      []token
	sig      []token // without comments
	decls    map[string]query.BindingType
	parser   *cel.Env
	comments []token
}

func newAnalyzer(source string, decls map[string]query.BindingType) (*analyzer, error) {
	parser, err := authoringParser()
	if err != nil {
		return nil, err
	}
	a := &analyzer{source: source, decls: decls, parser: parser, all: lex(source)}
	for _, t := range a.all {
		if t.kind == tokComment {
			a.comments = append(a.comments, t)
		} else {
			a.sig = append(a.sig, t)
		}
	}
	return a, nil
}

var comparisonOps = map[string]bool{"==": true, "!=": true, "<": true, "<=": true, ">": true, ">=": true}

// operatorFragments are punctuation tokens that can be an operator or the start of one.
var operatorFragments = map[string]bool{
	"=": true, "!": true, "&": true, "|": true,
	"<": true, ">": true, "==": true, "!=": true, "<=": true, ">=": true, "&&": true, "||": true,
}

func isOperandEnd(t token) bool {
	switch t.kind {
	case tokIdent:
		return t.text != "in"
	case tokNumber, tokString:
		return true
	case tokPunct:
		return t.text == ")" || t.text == "]"
	}
	return false
}

// groupsBefore returns the unmatched opening brackets among the first n tokens.
func (a *analyzer) groupsBefore(n int) []group {
	var stack []group
	for i := range min(n, len(a.sig)) {
		t := a.sig[i]
		if t.kind != tokPunct {
			continue
		}
		switch t.text {
		case "(", "[", "{":
			stack = append(stack, group{open: i, kind: t.text[0]})
		case ")", "]", "}":
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	return stack
}

// classify determines the grammatical role of the cursor.
func (a *analyzer) classify(cursor int) slot {
	s := slot{kind: slotNone, touch: -1, prev: -1, cursor: cursor, replaceStart: cursor, replaceEnd: cursor, chainEnd: -1}
	for _, c := range a.comments {
		if c.start < cursor && cursor <= c.end {
			return s
		}
	}
	touch := -1
	for i, t := range a.sig {
		switch t.kind {
		case tokString:
			if cursor >= t.contentStart && cursor <= t.contentEnd {
				touch = i
			}
		case tokIdent, tokNumber:
			if t.start <= cursor && cursor <= t.end {
				touch = i
			}
		case tokPunct:
			if operatorFragments[t.text] && t.start < cursor && cursor <= t.end {
				touch = i
			}
		}
		if touch >= 0 {
			break
		}
	}
	// Punctuation touches only where it can be a partial binary operator. A
	// complete operator with the cursor after it is the previous token.
	if touch >= 0 && a.sig[touch].kind == tokPunct {
		before := touch - 1
		t := a.sig[touch]
		if cursor == t.end && (comparisonOps[t.text] || t.text == "&&" || t.text == "||") {
			s.prev = touch
			touch = -1
		} else if before < 0 || !isOperandEnd(a.sig[before]) {
			s.prev = touch
			touch = -1
		}
	}
	s.touch = touch
	startPos := cursor
	if touch >= 0 {
		startPos = a.sig[touch].start
		if a.sig[touch].kind != tokString {
			s.replaceStart, s.replaceEnd = a.sig[touch].start, a.sig[touch].end
			s.prefix = a.source[a.sig[touch].start:cursor]
		} else {
			t := a.sig[touch]
			s.replaceStart, s.replaceEnd = t.start, t.end
			if !t.terminated {
				// An unterminated string runs to the end of the line, which
				// would swallow the rest of a mid-expression edit. Replace only
				// the word the user is typing.
				s.replaceEnd = a.wordEnd(cursor, t.end)
			}
			s.prefix = decodeString(a.source[t.contentStart:cursor], t.raw)
		}
	}
	if s.prev < 0 || touch >= 0 {
		s.prev = -1
		for i := len(a.sig) - 1; i >= 0; i-- {
			if i != touch && a.sig[i].end <= startPos {
				s.prev = i
				break
			}
		}
	}
	s.groups = a.groupsBefore(maxInt(s.prev+1, 0))
	a.role(&s)
	return s
}

// wordEnd advances from pos over the rest of the word being typed: it stops at
// whitespace, quotes, commas and closing brackets, or at limit.
func (a *analyzer) wordEnd(pos, limit int) int {
	for pos < limit {
		switch a.source[pos] {
		case ' ', '\t', '\n', '\r', '"', '\'', ',', ')', ']', '}':
			return pos
		}
		pos++
	}
	return limit
}

// followsOperand reports whether the next token at or after pos starts an
// operand, so an operator inserted before it must not add a placeholder.
func (a *analyzer) followsOperand(pos int) bool {
	for _, t := range a.sig {
		if t.start < pos {
			continue
		}
		switch t.kind {
		case tokIdent:
			return t.text != "in"
		case tokNumber, tokString:
			return true
		case tokPunct:
			return t.text == "(" || t.text == "[" || t.text == "{" || t.text == "!" || t.text == "-"
		}
		return false
	}
	return false
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// role assigns the slot kind and the operand chain end from the previous token.
func (a *analyzer) role(s *slot) {
	touchKind := tokenKind(0)
	if s.touch >= 0 {
		touchKind = a.sig[s.touch].kind
	}
	if s.prev < 0 {
		if touchKind == 0 || touchKind == tokIdent {
			s.kind = slotExpression
		}
		return
	}
	prev := a.sig[s.prev]
	switch prev.kind {
	case tokPunct:
		switch {
		case prev.text == ".":
			if touchKind == 0 || touchKind == tokIdent {
				s.kind, s.chainEnd = slotMember, s.prev-1
			}
		case prev.text == "[":
			if s.prev > 0 && a.sig[s.prev-1].isKeyword("in") {
				a.valueList(s, s.prev-2)
			} else if s.prev > 0 && isOperandEnd(a.sig[s.prev-1]) {
				if touchKind == 0 || touchKind == tokString {
					s.kind, s.chainEnd = slotIndex, s.prev-1
				}
			} else if touchKind == 0 || touchKind == tokIdent {
				s.kind = slotExpression
			}
		case prev.text == ",":
			a.afterComma(s, touchKind)
		case comparisonOps[prev.text]:
			if touchKind == tokPunct {
				return
			}
			s.kind, s.cmp, s.chainEnd = slotValue, prev.text, s.prev-1
		case prev.text == "&&" || prev.text == "||" || prev.text == "!" || prev.text == "(" || prev.text == "?" ||
			prev.text == ":" || prev.text == "+" || prev.text == "-" || prev.text == "*" || prev.text == "/" ||
			prev.text == "%" || prev.text == "{":
			if touchKind == 0 || touchKind == tokIdent {
				s.kind = slotExpression
			}
		case prev.text == ")" || prev.text == "]":
			if touchKind == 0 || touchKind == tokIdent || touchKind == tokPunct {
				s.kind, s.chainEnd = slotOperator, s.prev
			}
		}
	case tokIdent:
		if prev.text == "in" {
			if touchKind == 0 || touchKind == tokIdent {
				s.kind = slotExpression
			}
			return
		}
		if touchKind == 0 || touchKind == tokIdent || touchKind == tokPunct {
			s.kind, s.chainEnd = slotOperator, s.prev
		}
	case tokNumber, tokString:
		if touchKind == 0 || touchKind == tokIdent || touchKind == tokPunct {
			s.kind, s.chainEnd = slotOperator, s.prev
		}
	}
	// Inside an index bracket the key is the operand: "resource.tags[\"env\" ]"
	// is not a position for a comparison.
	if s.kind == slotOperator && len(s.groups) > 0 {
		top := s.groups[len(s.groups)-1]
		if top.kind == '[' && top.open > 0 && isOperandEnd(a.sig[top.open-1]) {
			s.kind, s.chainEnd = slotNone, -1
		}
	}
	// A string is only meaningful as an index key or a value.
	if touchKind == tokString && s.kind != slotIndex && s.kind != slotValue {
		s.kind = slotNone
		s.chainEnd = -1
	}
	if touchKind == tokNumber && s.kind != slotValue {
		s.kind = slotNone
		s.chainEnd = -1
	}
}

// afterComma classifies a position after a comma by the innermost open group.
func (a *analyzer) afterComma(s *slot, touchKind tokenKind) {
	if len(s.groups) == 0 {
		return
	}
	top := s.groups[len(s.groups)-1]
	switch top.kind {
	case '(':
		if touchKind == 0 || touchKind == tokIdent {
			s.kind = slotExpression
		}
	case '[':
		if top.open > 0 && a.sig[top.open-1].isKeyword("in") {
			a.valueList(s, top.open-2)
		} else if touchKind == 0 || touchKind == tokIdent {
			s.kind = slotExpression
		}
	}
}

// valueList marks an element of "<operand> in [ ... ]"; chainEnd addresses the
// token before "in".
func (a *analyzer) valueList(s *slot, chainEnd int) {
	if chainEnd < 0 {
		return
	}
	s.kind, s.inList, s.chainEnd = slotValue, true, chainEnd
}

// scanChain finds where the postfix chain ending at significant token end
// begins: IDENT, literal, call or grouped expression followed by .member,
// .call(...) and [index] steps. It balances brackets and never parses.
func (a *analyzer) scanChain(end int) (int, bool) {
	i := end
	for range len(a.sig) + 1 {
		if i < 0 || i >= len(a.sig) {
			return 0, false
		}
		t := a.sig[i]
		switch {
		case t.kind == tokIdent:
			if t.text == "in" {
				return 0, false
			}
			if i >= 1 && a.sig[i-1].isPunct(".") {
				if i < 2 || !isOperandEnd(a.sig[i-2]) {
					return 0, false
				}
				i -= 2
				continue
			}
			return i, true
		case t.kind == tokString || t.kind == tokNumber:
			return i, true
		case t.isPunct(")"):
			open := a.matchOpen(i)
			if open < 0 {
				return 0, false
			}
			if open >= 1 && a.sig[open-1].kind == tokIdent && a.sig[open-1].text != "in" {
				if open >= 2 && a.sig[open-2].isPunct(".") {
					if open < 3 || !isOperandEnd(a.sig[open-3]) {
						return 0, false
					}
					i = open - 3
					continue
				}
				return open - 1, true
			}
			return open, true
		case t.isPunct("]"):
			open := a.matchOpen(i)
			if open < 0 {
				return 0, false
			}
			if open >= 1 && isOperandEnd(a.sig[open-1]) {
				i = open - 1
				continue
			}
			return open, true
		default:
			return 0, false
		}
	}
	return 0, false
}

// matchOpen returns the opening bracket matching the closing bracket at close.
func (a *analyzer) matchOpen(close int) int {
	depth := 0
	for i := close; i >= 0; i-- {
		t := a.sig[i]
		if t.kind != tokPunct {
			continue
		}
		switch t.text {
		case ")", "]", "}":
			depth++
		case "(", "[", "{":
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// ---- operands -------------------------------------------------------------

// segment is one path step before the schema decides what it addresses.
type segment struct {
	kind string // "field", "item" or "index" (an item or a map value, by schema type)
	name string
}

// operand is a parsed expression the cursor operates on.
type operand struct {
	root     string // RootResource, RootParameter, RootElement or RootImplicit
	name     string // parameter, element variable or implicit root name
	segments []segment
	// scalar names the type of a call or literal operand: bool, int, uint,
	// double, string or null. Empty for document paths.
	scalar string
	// selects reports that the expression is a plain field selection, the
	// only shape the has() macro accepts.
	selects bool
	text    string
	start   int
	end     int
	param   *query.BindingType
}

// scopeBinding is a macro element variable bound to an array item path.
type scopeBinding struct {
	segments []segment
}

var macroNames = map[string]bool{"exists": true, "all": true, "exists_one": true, "map": true, "filter": true}

// scopes binds the element variable of every macro call that encloses the slot,
// outermost first, each by parsing the macro's receiver.
func (a *analyzer) scopes(s slot) map[string]scopeBinding {
	out := map[string]scopeBinding{}
	for _, g := range s.groups {
		if g.kind != '(' {
			continue
		}
		open := g.open
		if open < 2 || open+2 >= len(a.sig) {
			continue
		}
		name := a.sig[open-1]
		if name.kind != tokIdent || !macroNames[name.text] || !a.sig[open-2].isPunct(".") {
			continue
		}
		variable, comma := a.sig[open+1], a.sig[open+2]
		if variable.kind != tokIdent || !comma.isPunct(",") || s.cursor < comma.end {
			continue
		}
		start, ok := a.scanChain(open - 3)
		if !ok {
			continue
		}
		receiver, ok := a.operandOf(start, open-3, out)
		if !ok || receiver.scalar != "" || receiver.root == RootParameter {
			continue
		}
		path := append(append([]segment{}, receiver.segments...), segment{kind: "item"})
		out[variable.text] = scopeBinding{segments: path}
	}
	return out
}

// operandOf parses the significant tokens start..end as one expression and
// resolves it. The boolean is false when the slice does not parse or is not a
// path or a recognized call.
func (a *analyzer) operandOf(start, end int, scopes map[string]scopeBinding) (operand, bool) {
	first, last := a.sig[start], a.sig[end]
	op := operand{text: a.source[first.start:last.end], start: first.start, end: last.end}
	ast, issues := a.parser.Parse(op.text)
	if issues != nil && issues.Err() != nil {
		return op, false
	}
	native := ast.NativeRep()
	resolved, ok := a.exprOperand(native.Expr(), native, scopes)
	resolved.text, resolved.start, resolved.end = op.text, op.start, op.end
	return resolved, ok
}

func (a *analyzer) exprOperand(e celast.Expr, native *celast.AST, scopes map[string]scopeBinding) (operand, bool) {
	switch e.Kind() {
	case celast.IdentKind:
		name := e.AsIdent()
		switch {
		case name == "resource":
			return operand{root: RootResource}, true
		case scopes[name].segments != nil:
			return operand{root: RootElement, name: name, segments: append([]segment{}, scopes[name].segments...)}, true
		}
		if typ, ok := a.decls[name]; ok {
			t := typ
			return operand{root: RootParameter, name: name, param: &t}, true
		}
		return operand{root: RootImplicit, name: name, segments: []segment{{kind: "field", name: name}}, selects: true}, true
	case celast.SelectKind:
		sel := e.AsSelect()
		if sel.IsTestOnly() {
			return operand{scalar: "bool"}, true
		}
		parent, ok := a.exprOperand(sel.Operand(), native, scopes)
		if !ok || parent.scalar != "" || parent.root == RootParameter {
			return operand{}, false
		}
		parent.segments = append(parent.segments, segment{kind: "field", name: sel.FieldName()})
		parent.selects = true
		return parent, true
	case celast.CallKind:
		call := e.AsCall()
		switch call.FunctionName() {
		case "_[_]":
			args := call.Args()
			if len(args) != 2 {
				return operand{}, false
			}
			parent, ok := a.exprOperand(args[0], native, scopes)
			if !ok || parent.scalar != "" || parent.root == RootParameter {
				return operand{}, false
			}
			parent.selects = false
			switch {
			case args[1].Kind() == celast.LiteralKind && args[1].AsLiteral().Type().TypeName() == "string":
				name, _ := args[1].AsLiteral().Value().(string)
				parent.segments = append(parent.segments, segment{kind: "field", name: name})
			case args[1].Kind() == celast.LiteralKind && isIntegerLiteral(args[1]):
				parent.segments = append(parent.segments, segment{kind: "item"})
			default:
				parent.segments = append(parent.segments, segment{kind: "index"})
			}
			return parent, true
		case "size":
			return operand{scalar: "int"}, true
		case "startsWith", "endsWith", "contains", "matches",
			"_&&_", "_||_", "!_", "_==_", "_!=_", "_<_", "_<=_", "_>_", "_>=_", "@in":
			return operand{scalar: "bool"}, true
		}
		return operand{}, false
	case celast.ComprehensionKind:
		macro, ok := native.SourceInfo().GetMacroCall(e.ID())
		if !ok || macro.Kind() != celast.CallKind {
			return operand{}, false
		}
		switch macro.AsCall().FunctionName() {
		case "exists", "all", "exists_one":
			return operand{scalar: "bool"}, true
		case "filter":
			return a.exprOperand(e.AsComprehension().IterRange(), native, scopes)
		}
		return operand{}, false
	case celast.LiteralKind:
		switch e.AsLiteral().Type().TypeName() {
		case "string":
			return operand{scalar: "string"}, true
		case "int":
			return operand{scalar: "int"}, true
		case "uint":
			return operand{scalar: "uint"}, true
		case "double":
			return operand{scalar: "double"}, true
		case "bool":
			return operand{scalar: "bool"}, true
		case "null_type":
			return operand{scalar: "null"}, true
		}
	}
	return operand{}, false
}

func isIntegerLiteral(e celast.Expr) bool {
	switch e.AsLiteral().Type().TypeName() {
	case "int", "uint":
		return true
	}
	return false
}

// clauseComplete reports whether the operand chain starting at significant
// token start is already the right operand of an operator, so the clause it
// belongs to is complete and a connective, not a comparison, comes next.
func (a *analyzer) clauseComplete(start int) bool {
	if start <= 0 {
		return false
	}
	before := a.sig[start-1]
	switch before.kind {
	case tokPunct:
		return comparisonOps[before.text] || strings.ContainsAny(before.text, "+-*/%") && len(before.text) == 1
	case tokIdent:
		return before.text == "in"
	}
	return false
}
