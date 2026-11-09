package resourceauthoring

import (
	"sort"
	"strconv"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// Rank groups: lower sorts first. Within a group, an exact-case prefix match
// precedes a case-insensitive one; the catalog's own order (required own fields
// by name, then branch fields by name) breaks ties because the sort is stable.
const (
	rankFields   = 0
	rankMethods  = 2
	rankOther    = 4
	rankLogic    = 6
	matchExact   = 0
	matchFolded  = 1
	rankEnum     = 0
	rankLiteral  = 2
	rankParam    = 4
	rankRoot     = 0
	rankVariable = 2
	rankFunction = 4
	rankRootless = 6
)

// matchRank matches candidate against the typed prefix: exact-case prefix,
// then case-insensitive prefix. An empty prefix matches everything.
func matchRank(candidate, prefix string) (int, bool) {
	if prefix == "" || strings.HasPrefix(candidate, prefix) {
		return matchExact, true
	}
	if strings.HasPrefix(strings.ToLower(candidate), strings.ToLower(prefix)) {
		return matchFolded, true
	}
	return 0, false
}

// canonicalPath renders a document path under its explicit "resource" root.
func canonicalPath(segments []segment) string {
	var out strings.Builder
	out.WriteString(RootResource)
	for _, s := range segments {
		switch s.kind {
		case "field":
			if celIdentifier(s.name) {
				out.WriteString("." + s.name)
			} else {
				out.WriteString("[" + celQuote(s.name) + "]")
			}
		default:
			out.WriteString("[0]")
		}
	}
	return out.String()
}

func (c *completer) spaceBefore(pos int) bool {
	return pos > 0 && !isSpaceByte(c.source[pos-1])
}

// freshVar names a macro element variable that shadows nothing in scope.
func (c *completer) freshVar() string {
	for _, name := range []string{"e", "item", "x", "y", "z"} {
		if _, bound := c.scopes[name]; bound {
			continue
		}
		if _, declared := c.in.Request.Declarations[name]; declared {
			continue
		}
		return name
	}
	return "e1"
}

// ---- member position -------------------------------------------------------

func (c *completer) memberItems() {
	if c.op == nil || !c.resolved {
		return
	}
	prefix := c.slot.prefix
	if c.listing != nil {
		c.noteListing(c.listing)
		for _, entry := range c.listing.Fields {
			if entry.Segment.Kind != resourcecatalog.SegmentField {
				continue
			}
			rank, ok := matchRank(entry.Segment.Name, prefix)
			if !ok {
				continue
			}
			item := itemFor(entry, entry.Segment.Name, KindField, c.in.Policy.MaxDocumentationBytes)
			var dynamic bool
			item.Edit, dynamic = c.memberEdit(entry.Segment.Name)
			if dynamic {
				// Reached through dyn(): CEL checks that access dynamically.
				item.Checking = resourcecatalog.CELCheckingDynamic
			}
			item.Rootless = c.op.root == RootImplicit
			c.add(item, rankFields+rank)
		}
	}
	if c.facts == nil {
		return
	}
	for _, spec := range methodSpecs {
		if !spec.apply(c.class) {
			continue
		}
		if rank, ok := matchRank(spec.label, prefix); ok {
			c.add(c.methodItem(spec, false), rankMethods+rank)
		}
	}
}

// rootIsStruct reports whether the document root is a typed object in CEL, by
// the same shape resolution the CEL mapping uses.
func rootIsStruct(schema *resourcecatalog.Schema) bool {
	shape, ok := resourcecatalog.CELShape(schema.Document, schema.Root)
	if !ok {
		return false
	}
	node := &schema.Document.Nodes[shape]
	return node.Types == resourcecatalog.TypeObject && (len(node.Properties) > 0 || node.Additional == resourcecatalog.AdditionalForbidden)
}

// parentIsStruct reports whether the operand is a typed object in CEL. The
// checker lets a typed object be selected from but not indexed:
// resource["name"] is a type error. When the parent's type is unknown, a typed
// object is assumed, which is safe because dyn(...) accepts any value.
func (c *completer) parentIsStruct() bool {
	if c.op == nil || c.op.root == RootParameter || c.op.root == "" {
		return false
	}
	if c.facts == nil {
		if len(c.op.segments) == 0 && c.in.Schema != nil {
			return rootIsStruct(c.in.Schema)
		}
		return true
	}
	return c.class.object && !c.class.isMap && c.facts.CELChecking != resourcecatalog.CELCheckingDynamic
}

// parentText is the operand as it must appear in an edit that rewrites it.
func (c *completer) parentText() string {
	if c.op.root == RootImplicit {
		return canonicalPath(c.op.segments)
	}
	return c.op.text
}

// memberText selects name from parent in the one syntax that checks: a dot for
// an identifier, index syntax for a map or dyn parent, and dyn(parent)[name] for
// a typed object, which CEL cannot index.
func memberText(parent string, parentStruct bool, name string) string {
	switch {
	case celIdentifier(name):
		return parent + "." + name
	case parentStruct:
		return "dyn(" + parent + ")[" + celQuote(name) + "]"
	}
	return parent + "[" + celQuote(name) + "]"
}

// memberEdit replaces the member token after the dot, or the whole access when
// the name needs another syntax (index form replaces the dot; dyn() wraps the
// parent). A path typed without its root is rewritten under "resource". The
// boolean reports a dyn() access.
func (c *completer) memberEdit(name string) (Edit, bool) {
	end := c.slot.replaceEnd
	switch {
	case celIdentifier(name):
		if c.op.root == RootImplicit {
			return Edit{Start: c.op.start, End: end, Text: c.parentText() + "." + name}, false
		}
		return Edit{Start: c.slot.replaceStart, End: end, Text: name}, false
	case c.parentIsStruct():
		return Edit{Start: c.op.start, End: end, Text: memberText(c.parentText(), true, name)}, true
	}
	if c.op.root == RootImplicit {
		return Edit{Start: c.op.start, End: end, Text: memberText(c.parentText(), false, name)}, false
	}
	return Edit{Start: c.a.sig[c.slot.prev].start, End: end, Text: "[" + celQuote(name) + "]"}, false
}

// indexEdit completes an index key. On a map or dyn operand the key replaces the
// string literal being typed. A typed object cannot be indexed, so the whole
// access is rewritten into the form that checks, taking a closing bracket that
// directly follows the literal with it.
func (c *completer) indexEdit(name string) Edit {
	start, end := c.slot.replaceStart, c.slot.replaceEnd
	if !c.parentIsStruct() {
		return Edit{Start: start, End: end, Text: celQuote(name)}
	}
	if end < len(c.source) && c.source[end] == ']' {
		end++
	}
	return Edit{Start: c.op.start, End: end, Text: memberText(c.parentText(), true, name)}
}

// methodText returns the call text without a leading dot and the caret offset
// inside it.
func (c *completer) methodText(spec opSpec) (string, int) {
	switch spec.label {
	case "startsWith", "endsWith", "contains", "matches":
		return spec.label + `("")`, len(spec.label) + 2
	case "exists", "all", "exists_one":
		text := spec.label + "(" + c.freshVar() + ", )"
		return text, len(text) - 1
	}
	text := spec.label + "()"
	return text, len(text)
}

// methodItem inserts a call on the operand: after the dot at a member position,
// or including the dot after a complete operand at an operator position.
func (c *completer) methodItem(spec opSpec, atOperator bool) Item {
	text, caret := c.methodText(spec)
	start, end := c.slot.replaceStart, c.slot.replaceEnd
	if atOperator {
		start = c.op.end
		text, caret = "."+text, caret+1
	}
	if c.op.root == RootImplicit {
		prefix := canonicalPath(c.op.segments)
		if !atOperator {
			prefix += "."
		}
		start = c.op.start
		text, caret = prefix+text, caret+len(prefix)
	}
	item := Item{
		Label:         spec.label,
		Kind:          spec.kind,
		Detail:        spec.detail,
		Documentation: spec.doc,
		Arity:         spec.arity,
		Edit:          Edit{Start: start, End: end, Text: text, Selection: &Range{Start: caret, End: caret}},
	}
	if c.facts != nil {
		item.Checking = c.facts.CELChecking
	}
	return item
}

// ---- operator position ----------------------------------------------------

func (c *completer) operatorItems() {
	prefix := c.slot.prefix
	if c.op == nil {
		// An operand that is not a path or call, such as an "in [...]" list,
		// can still end a complete clause.
		if c.chainStart >= 0 && c.a.clauseComplete(c.chainStart) {
			c.logicItems(prefix)
		}
		return
	}
	if c.facts == nil {
		return
	}
	if c.a.clauseComplete(c.chainStart) || c.op.scalar == "bool" {
		// A complete clause, or a boolean call result such as exists(): only a
		// connective can follow.
		c.logicItems(prefix)
		return
	}
	for _, spec := range comparisonSpecs {
		if !spec.apply(c.class) {
			continue
		}
		if rank, ok := matchRank(spec.label, prefix); ok {
			c.add(c.binaryItem(spec), rankOther+rank)
		}
	}
	for _, spec := range nullSpecs {
		if !spec.apply(c.class) {
			continue
		}
		if rank, ok := matchRank(spec.label, prefix); ok {
			c.add(c.nullItem(spec), rankOther+2+rank)
		}
	}
	for _, spec := range methodSpecs {
		if !spec.apply(c.class) {
			continue
		}
		if rank, ok := matchRank(spec.label, prefix); ok {
			c.add(c.methodItem(spec, true), rankMethods+rankOther+rank)
		}
	}
	if c.hasApplies() {
		if rank, ok := matchRank(hasSpec.label, prefix); ok {
			c.add(c.hasItem(), rankMethods+rankOther+2+rank)
		}
	}
	if c.class.boolean {
		c.logicItems(prefix)
	}
}

// hasApplies reports whether has(operand) is valid CEL for this operand: the
// macro accepts only a plain field selection, never an index, a call or a
// parameter.
func (c *completer) hasApplies() bool {
	if c.op == nil || !c.op.selects || c.op.root == RootParameter || len(c.op.segments) == 0 {
		return false
	}
	return c.op.segments[len(c.op.segments)-1].kind == "field"
}

func (c *completer) logicItems(prefix string) {
	for _, spec := range []opSpec{andSpec, orSpec} {
		rank, ok := matchRank(spec.label, prefix)
		if !ok {
			continue
		}
		start := c.slot.replaceStart
		text := spec.label + " "
		if c.spaceBefore(start) {
			text = " " + text
		}
		item := Item{
			Label: spec.label, Kind: spec.kind, Detail: spec.detail, Documentation: spec.doc, Arity: spec.arity,
			Edit: Edit{Start: start, End: c.slot.replaceEnd, Text: text, Selection: &Range{Start: len(text), End: len(text)}},
		}
		c.add(item, rankLogic+rank)
	}
}

// operatorLead returns where a binary operator edit starts and the text that
// precedes the operator: an operand typed without its root is rewritten.
func (c *completer) operatorLead() (int, string) {
	if c.op.root == RootImplicit {
		return c.op.start, canonicalPath(c.op.segments) + " "
	}
	start := c.slot.replaceStart
	if c.spaceBefore(start) {
		return start, " "
	}
	return start, ""
}

// placeholder is the operand text a binary operator leaves for the user, with
// the caret offset inside it. Types without a safe empty literal leave none.
func (c *completer) placeholder(label string) (string, int) {
	if label == "in" {
		return "[]", 1
	}
	switch {
	case c.class.timestamp && !c.class.any && !c.class.str:
		return `timestamp("")`, len(`timestamp("`)
	case c.class.str && !c.class.any && !c.class.timestamp && !c.class.integer && !c.class.number && !c.class.boolean:
		return `""`, 1
	}
	return "", 0
}

func (c *completer) binaryItem(spec opSpec) Item {
	start, lead := c.operatorLead()
	placeholder, caret := c.placeholder(spec.label)
	trailing := " "
	if end := c.slot.replaceEnd; c.a.followsOperand(end) {
		// The operator is being retyped before an operand that already exists.
		placeholder, caret = "", 0
		if end < len(c.source) && isSpaceByte(c.source[end]) {
			trailing = ""
		}
	}
	text := lead + spec.label + trailing + placeholder
	selection := len(text) - len(placeholder) + caret
	return Item{
		Label: spec.label, Kind: spec.kind, Detail: spec.detail, Documentation: spec.doc, Arity: spec.arity,
		Checking: c.facts.CELChecking,
		Edit:     Edit{Start: start, End: c.slot.replaceEnd, Text: text, Selection: &Range{Start: selection, End: selection}},
	}
}

func (c *completer) nullItem(spec opSpec) Item {
	start, lead := c.operatorLead()
	text := lead + spec.label
	return Item{
		Label: spec.label, Kind: spec.kind, Detail: spec.detail, Documentation: spec.doc, Arity: spec.arity,
		Checking: c.facts.CELChecking,
		Edit:     Edit{Start: start, End: c.slot.replaceEnd, Text: text, Selection: &Range{Start: len(text), End: len(text)}},
	}
}

// hasItem replaces the operand clause with has(operand), the unary presence
// form. The edit covers the operand and the gap or partial token after it.
func (c *completer) hasItem() Item {
	operandText := c.op.text
	if c.op.root == RootImplicit {
		operandText = canonicalPath(c.op.segments)
	}
	text := "has(" + operandText + ")"
	return Item{
		Label: hasSpec.label, Kind: hasSpec.kind, Detail: hasSpec.detail, Documentation: hasSpec.doc, Arity: hasSpec.arity,
		Checking: c.facts.CELChecking,
		Edit:     Edit{Start: c.op.start, End: max(c.op.end, c.slot.replaceEnd), Text: text, Selection: &Range{Start: len(text), End: len(text)}},
	}
}

// ---- value position ---------------------------------------------------------

// enumLiteral renders a schema enum value as a CEL literal. Fields CEL types
// as uint need the "u" suffix; values that only fit uint64 always do.
func enumLiteral(v resourcev2.Value, uintField bool) (label, literal string, ok bool) {
	switch v.Kind {
	case "string":
		return v.String, celQuote(v.String), true
	case "bool":
		text := strconv.FormatBool(v.Bool)
		return text, text, true
	case "int64":
		suffix := ""
		if uintField {
			suffix = "u"
		}
		return v.Int, v.Int + suffix, true
	case "uint64":
		if n, err := strconv.ParseUint(v.Uint, 10, 64); err == nil && n <= 1<<63-1 && !uintField {
			return v.Uint, v.Uint, true
		}
		return v.Uint, v.Uint + "u", true
	case "double":
		text := strconv.FormatFloat(v.Double, 'g', -1, 64)
		if !strings.ContainsAny(text, ".eE") && !strings.Contains(text, "Inf") && !strings.Contains(text, "NaN") {
			text += ".0"
		}
		return text, text, true
	case "null":
		return "null", "null", true
	}
	return "", "", false
}

func (c *completer) valueItems() {
	if c.op == nil || c.facts == nil {
		return
	}
	touchString := c.slot.touch >= 0 && c.a.sig[c.slot.touch].kind == tokString
	prefix := c.slot.prefix
	start, end := c.slot.replaceStart, c.slot.replaceEnd
	lead := ""
	if !touchString && start > 0 && !isSpaceByte(c.source[start-1]) && !strings.ContainsRune("([,", rune(c.source[start-1])) {
		lead = " "
	}
	uintField := c.facts.Format == "uint32" || c.facts.Format == "uint64"
	value := func(label, literal, kind string, group, rank int) {
		item := Item{
			Label: label, Kind: kind, Detail: typeLabel(*c.facts), Type: typeInfoOf(*c.facts), Checking: c.facts.CELChecking,
			Edit: Edit{Start: start, End: end, Text: lead + literal},
		}
		c.add(item, group+rank)
	}
	for _, v := range c.facts.Enum {
		if touchString && v.Kind != "string" {
			continue
		}
		label, literal, ok := enumLiteral(v, uintField)
		if !ok {
			continue
		}
		if rank, ok := matchRank(label, prefix); ok {
			value(label, literal, KindEnumValue, rankEnum, rank)
		}
	}
	if touchString {
		return
	}
	if len(c.facts.Enum) == 0 && c.class.boolean && !c.class.any {
		for _, literal := range []string{"true", "false"} {
			if rank, ok := matchRank(literal, prefix); ok {
				value(literal, literal, KindLiteral, rankLiteral, rank)
			}
		}
	}
	if len(c.facts.Enum) == 0 && !c.slot.inList && (c.slot.cmp == "==" || c.slot.cmp == "!=") && c.class.nullable {
		if rank, ok := matchRank("null", prefix); ok {
			value("null", "null", KindLiteral, rankLiteral, rank)
		}
	}
	for _, name := range sortedNames(c.in.Request.Declarations) {
		typ := c.in.Request.Declarations[name]
		if !c.compatible(typ) {
			continue
		}
		if rank, ok := matchRank(name, prefix); ok {
			item := Item{
				Label: name, Kind: KindParameter, Detail: bindingLabel(typ), Type: typeInfoOf(bindingFacts(typ)), Checking: resourcecatalog.CELCheckingStatic,
				Edit: Edit{Start: start, End: end, Text: lead + name},
			}
			c.add(item, rankParam+rank)
		}
	}
}

// compatible reports whether a declared parameter has a type the operand can be
// compared with.
func (c *completer) compatible(typ query.BindingType) bool {
	for typ.Kind == "nullable" && typ.Value != nil {
		typ = *typ.Value
	}
	format := c.facts.Format
	switch typ.Kind {
	case "string":
		return c.class.any || c.class.str
	case "bool":
		return c.class.any || c.class.boolean
	case "int64":
		// CEL rejects an int compared with a uint at check time, so a typed
		// integer field takes only the matching parameter type.
		return c.class.any || c.class.number || c.class.integer && format != "uint32" && format != "uint64"
	case "uint64":
		return c.class.any || c.class.number || c.class.integer && (format == "" || format == "uint32" || format == "uint64")
	case "double":
		return c.class.any || c.class.number
	case "timestamp":
		return c.class.any || c.class.timestamp
	}
	return false
}

func sortedNames(declarations map[string]query.BindingType) []string {
	names := make([]string, 0, len(declarations))
	for name := range declarations {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// ---- index position ------------------------------------------------------------

func (c *completer) indexItems() {
	if c.op == nil || !c.resolved || c.listing == nil {
		return
	}
	c.noteListing(c.listing)
	prefix := c.slot.prefix
	for _, entry := range c.listing.Fields {
		if entry.Segment.Kind != resourcecatalog.SegmentField {
			continue
		}
		rank, ok := matchRank(entry.Segment.Name, prefix)
		if !ok {
			continue
		}
		item := itemFor(entry, entry.Segment.Name, KindField, c.in.Policy.MaxDocumentationBytes)
		item.Edit = c.indexEdit(entry.Segment.Name)
		if c.parentIsStruct() && !celIdentifier(entry.Segment.Name) {
			item.Checking = resourcecatalog.CELCheckingDynamic
		}
		c.add(item, rankFields+rank)
	}
}

// ---- expression position -------------------------------------------------------------

func (c *completer) expressionItems() {
	prefix := c.slot.prefix
	start, end := c.slot.replaceStart, c.slot.replaceEnd
	plain := func(label, kind, detail string, group, rank int, text string) {
		c.add(Item{Label: label, Kind: kind, Detail: detail, Edit: Edit{Start: start, End: end, Text: text}}, group+rank)
	}
	if rank, ok := matchRank(RootResource, prefix); ok {
		plain(RootResource, KindRoot, "resource document", rankRoot, rank, RootResource)
	}
	scoped := make([]string, 0, len(c.scopes))
	for name := range c.scopes {
		scoped = append(scoped, name)
	}
	sort.Strings(scoped)
	for _, name := range scoped {
		if rank, ok := matchRank(name, prefix); ok {
			plain(name, KindVariable, "element variable", rankVariable, rank, name)
		}
	}
	for _, name := range sortedNames(c.in.Request.Declarations) {
		if rank, ok := matchRank(name, prefix); ok {
			item := Item{
				Label: name, Kind: KindParameter, Detail: bindingLabel(c.in.Request.Declarations[name]),
				Type: typeInfoOf(bindingFacts(c.in.Request.Declarations[name])), Checking: resourcecatalog.CELCheckingStatic,
				Edit: Edit{Start: start, End: end, Text: name},
			}
			c.add(item, rankVariable+2+rank)
		}
	}
	if rank, ok := matchRank(hasSpec.label, prefix); ok {
		c.add(Item{
			Label: hasSpec.label, Kind: hasSpec.kind, Detail: hasSpec.detail, Documentation: hasSpec.doc, Arity: hasSpec.arity,
			Edit: Edit{Start: start, End: end, Text: "has()", Selection: &Range{Start: 4, End: 4}},
		}, rankFunction+rank)
	}
	c.rootlessFields(prefix, start, end)
}

// rootlessFields offers top-level document fields for a typed prefix, so a
// user who types "spec" gets resource.spec. Nothing is offered for an empty
// prefix, which would list the whole document root in every popup, and a name
// that is a parameter, an element variable or "resource" keeps its own meaning.
func (c *completer) rootlessFields(prefix string, start, end int) {
	if prefix == "" || c.in.Schema == nil {
		return
	}
	resolver := newResolver(c.ctx, c.in.Schema, c.in.Navigation, c.in.Policy.MaxPathDepth)
	nav, err := resolver.navigate(nil)
	if err != nil {
		return
	}
	c.noteListing(&nav)
	for _, entry := range nav.Fields {
		name := entry.Segment.Name
		if entry.Segment.Kind != resourcecatalog.SegmentField || name == RootResource {
			continue
		}
		rank, ok := matchRank(name, prefix)
		if !ok {
			continue
		}
		item := itemFor(entry, name, KindField, c.in.Policy.MaxDocumentationBytes)
		item.Rootless = true
		item.Edit = Edit{Start: start, End: end, Text: memberText(RootResource, c.in.Schema != nil && rootIsStruct(c.in.Schema), name)}
		c.add(item, rankRootless+rank)
	}
}
