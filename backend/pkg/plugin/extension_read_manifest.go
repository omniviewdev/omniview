package plugin

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"io"
	"maps"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"

	"golang.org/x/mod/semver"
)

// Only these indexes survive native admission. No label, locator, predicate
// value, page or executable bytes are needed to recheck a selected read.
type admittedReadManifest struct {
	points map[string]*signedReadPoint
	edges  map[readTarget]signedReadEdge
}

// The enclosing manifest supplies the offer's verified installation ID.
type readTarget struct{ point, localOffer string }

type signedReadPoint struct {
	contract  string
	read      string
	operation string
	row       map[string]string
}

type signedReadEdge struct {
	contract   string
	conditions []string
}

// This is the compiled wire shape, not an API to accept plugin/renderer
// parameters. Keep native admission in agreement with the SDK's wire.ts.
type readManifestWire struct {
	SchemaVersion float64         `json:"schemaVersion"`
	ID            string          `json:"id"`
	Points        []readWirePoint `json:"points"`
	Offers        []readWireOffer `json:"offers"`
	Bindings      []readWireEdge  `json:"bindings"`
}

type readWireSchema struct {
	ID  string            `json:"id"`
	Row map[string]string `json:"row"`
}

type readWireDefinition struct {
	ID       string            `json:"id"`
	Label    string            `json:"label"`
	Kind     string            `json:"kind"`
	Protocol string            `json:"protocol"`
	Fields   map[string]string `json:"fields"`
	Schema   map[string]string `json:"schema"`
	Optional []string          `json:"optional"`
	Read     *readWireSchema   `json:"read"`
}

type readWireLocator struct {
	Package string `json:"package"`
	Version string `json:"version"`
	Export  string `json:"export"`
}

type readWirePoint struct {
	readWireDefinition
	Placement  string          `json:"placement"`
	Contract   readWireLocator `json:"contract"`
	WarmOnPage *string         `json:"warmOnPage"`
}

type readWireOffer struct {
	readWireDefinition
	Requests    []string          `json:"requests"`
	RequestRead *bool             `json:"requestRead"`
	Action      map[string]string `json:"action"`
}

type readComparison struct {
	Field  string `json:"field"`
	Equals any    `json:"equals"`
}

type readWireEdge struct {
	Offer  string           `json:"offer"`
	Target string           `json:"target"`
	When   []readComparison `json:"when"`
}

const (
	publishedUtilization = "visuals/utilization@1"
	readFieldLimit       = 64
	readComparisonLimit  = 4
	readTextLimit        = 256
	readEndpointLimit    = extensionSegmentLimit + len("/") + extensionSegmentLimit
	objectMemberTokens   = 2 // JSON names and values are separate tokens.

	extensionKindSection    = "section"
	extensionKindMenu       = "menu"
	extensionKindView       = "view"
	extensionActionInfo     = "info"
	extensionActionOpenView = "openView"
	extensionDetailTab      = "detail-tab"
	readFieldString         = "string"
	readFieldNumber         = "number"
)

// Bound containers before the typed decoder allocates them. No v1 member
// accepts null, even for an optional member (absence and null differ).
func boundedReadManifest(data []byte) bool {
	if len(data) == 0 || len(data) > extensionManifestLimit {
		return false
	}
	// The typed decode rejects duplicates. This budget pass needs no key sets.
	d := jsontext.NewDecoder(bytes.NewReader(data), jsontext.AllowDuplicateNames(true))
	var limit [6]int64 // wire.ts: at most five nested containers
	var when bool
	for {
		depth := d.StackDepth()
		parent, n := d.StackIndex(depth)
		t, err := d.ReadToken()
		if err != nil {
			return errors.Is(err, io.EOF) && depth == 0
		}
		k := t.Kind()
		if k == 'n' || depth != 0 && n >= limit[depth] && k != '}' && k != ']' {
			return false
		}
		if k == '[' || k == '{' {
			if depth+1 == len(limit) {
				return false
			}
			switch {
			case k == '{':
				limit[depth+1] = objectMemberTokens * readFieldLimit
			case depth == 1:
				limit[depth+1] = extensionListLimit
			case when:
				limit[depth+1] = readComparisonLimit
			default:
				limit[depth+1] = readFieldLimit
			}
		}
		when = depth == 3 && parent == '{' && n%objectMemberTokens == 0 && k == '"' && t.String() == "when"
	}
}

func readOwnerID(id string) bool {
	return id != "host" && id != "visuals" && id != "navigation" && extensionSegment(id)
}

func readEndpoint(name string) (string, string, bool) {
	if len(name) > readEndpointLimit {
		return "", "", false
	}
	owner, local, ok := strings.Cut(name, "/")
	return owner, local, ok && readOwnerID(owner) && extensionSegment(local)
}

func privateReadNamespace(id string) (string, bool) {
	name, major, ok := strings.Cut(id, "@")
	if !ok || len(major) == 0 || len(major) > 9 || major[0] == '0' {
		return "", false
	}
	for i := range len(major) {
		if major[i] < '0' || major[i] > '9' {
			return "", false
		}
	}
	owner, _, ok := readEndpoint(name)
	return owner, ok
}

func boundedReadText(s string) bool {
	if len(s) <= readTextLimit {
		return true
	}
	units := 0
	for _, r := range s {
		units += utf16.RuneLen(r)
		if units > readTextLimit {
			return false
		}
	}
	return true
}

func blankReadLabel(s string) bool {
	// ECMAScript trim includes BOM, but not NEXT LINE.
	return strings.TrimFunc(s, func(r rune) bool { return r == '\uFEFF' || r != '\u0085' && unicode.IsSpace(r) }) == ""
}

var (
	readRegistryName = regexp.MustCompile(`^(?:[a-z0-9][a-z0-9._-]*|@[a-z0-9._-]+/[a-z0-9._-]+)$`)
	readExportName   = regexp.MustCompile(`^[a-zA-Z_$][a-zA-Z0-9_$]{0,127}$`)
)

func (l readWireLocator) valid() bool {
	if len(l.Package) > 214 || !readRegistryName.MatchString(l.Package) || l.Package == "node_modules" || l.Package == "favicon.ico" {
		return false
	}
	if scope, name, scoped := strings.Cut(l.Package, "/"); scoped && (scope == "@." || scope == "@.." || name == "." || name == "..") {
		return false
	}
	core, _, _ := strings.Cut(l.Version, "-")
	core, _, _ = strings.Cut(core, "+")
	if len(l.Version) > 128 || strings.Count(core, ".") != 2 || !semver.IsValid("v"+l.Version) || !readExportName.MatchString(l.Export) {
		return false
	}
	switch l.Export {
	case "__proto__", "constructor", "prototype", "arguments", "await", "break", "case", "catch", "class", "const", "continue", "debugger", defaultExportName, "delete", "do", "else", "enum", "eval", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield":
		return false
	}
	return true
}

func readFields(fields map[string]string) bool {
	if fields == nil || len(fields) > readFieldLimit {
		return false
	}
	for name, kind := range fields {
		if !extensionSegment(name) || kind != readFieldString && kind != readFieldNumber {
			return false
		}
	}
	return true
}

func (d *readWireDefinition) keys(keys []string) bool {
	if keys == nil || len(keys) > readFieldLimit {
		return false
	}
	slices.Sort(keys)
	for i, key := range keys {
		publishedKey := d.Protocol == publishedUtilization && (key == "used" || key == "capacity")
		if !publishedKey && d.Fields[key] == "" || i > 0 && keys[i-1] == key {
			return false
		}
	}
	return true
}

func (d *readWireDefinition) valid(pointOwner string) bool {
	if !extensionSegment(d.ID) || !boundedReadText(d.Label) || blankReadLabel(d.Label) {
		return false
	}
	if d.Protocol == publishedUtilization {
		return d.Kind == extensionKindSection && d.Fields == nil && d.Schema == nil && d.Optional == nil && d.Read == nil
	}
	owner, ok := privateReadNamespace(d.Protocol)
	if !ok || pointOwner != "" && pointOwner != owner || !readFields(d.Fields) {
		return false
	}
	if d.Kind == extensionKindSection {
		return d.Read == nil && d.Optional == nil && len(d.Schema) == 2 && d.Schema["label"] == readFieldString && d.Schema["value"] == readFieldString
	}
	if d.Schema != nil || d.Kind != extensionKindMenu && d.Kind != extensionKindView || d.Optional != nil && (len(d.Optional) == 0 || !d.keys(d.Optional)) {
		return false
	}
	if d.Read == nil {
		return true
	}
	readOwner, ok := privateReadNamespace(d.Read.ID)
	return d.Kind == extensionKindView && ok && owner == readOwner && len(d.Read.Row) != 0 && readFields(d.Read.Row)
}

func (p *readWirePoint) valid(owner string) bool {
	if !p.readWireDefinition.valid(owner) || !p.Contract.valid() {
		return false
	}
	if p.Kind == extensionKindSection {
		return p.Placement == "overview-section" && (p.WarmOnPage == nil || extensionSegment(*p.WarmOnPage))
	}
	if p.WarmOnPage != nil {
		return false
	}
	if p.Kind == extensionKindMenu {
		return p.Placement == "context-menu"
	}
	return p.Placement == extensionDetailTab || p.Placement == "sidebar" && len(p.Fields) == 0 && p.Read == nil
}

func (o *readWireOffer) valid() bool {
	if !o.readWireDefinition.valid("") || !o.keys(o.Requests) || o.RequestRead != nil && (!*o.RequestRead || o.Read == nil) {
		return false
	}
	if o.Kind != extensionKindMenu {
		return o.Action == nil && o.ID != defaultExportName
	}
	if o.Action["kind"] == extensionActionInfo {
		return len(o.Action) == 1 && o.ID != defaultExportName
	}
	_, _, ok := readEndpoint(o.Action["point"])
	return ok && len(o.Action) == 3 && o.Action["kind"] == extensionActionOpenView && extensionSegment(o.Action["offer"])
}

// A private protocol major and a read major each have exactly one definition
// within a source. A conflict anywhere rejects that source, not just one edge.
type readDefinitions struct {
	protocols map[string]*readWireDefinition
	reads     map[string]map[string]string
}

func (m *readDefinitions) remember(d *readWireDefinition) bool {
	if d.Read != nil {
		if row := m.reads[d.Read.ID]; row != nil && !maps.Equal(row, d.Read.Row) {
			return false
		}
		m.reads[d.Read.ID] = d.Read.Row
	}
	prev := m.protocols[d.Protocol]
	if prev == nil {
		m.protocols[d.Protocol] = d
		return true
	}
	return prev.Kind == d.Kind && maps.Equal(prev.Fields, d.Fields) && slices.Equal(prev.Optional, d.Optional) &&
		(prev.Read == nil && d.Read == nil || prev.Read != nil && d.Read != nil && prev.Read.ID == d.Read.ID)
}

func readPairs(fields map[string]string) [][2]string {
	pairs := make([][2]string, 0, len(fields))
	for k, v := range fields {
		pairs = append(pairs, [2]string{k, v})
	}
	slices.SortFunc(pairs, func(a, b [2]string) int { return strings.Compare(a[0], b[0]) })
	return pairs
}

func readFingerprint(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Hash the exact UTF-8 JSON tuples from ui-next/plugins/host/extensionContract.ts.
// Every string here is a validated ASCII ID/type. v2 marshals nil slices as [].
func sealRead(d *readWireDefinition) *signedReadPoint {
	read, err := json.Marshal([2]any{d.Read.ID, readPairs(d.Read.Row)})
	if err != nil {
		return nil
	}
	point, err := json.Marshal([7]any{extensionDetailTab, d.Protocol, d.Kind, readPairs(d.Fields), d.Optional, nil, jsontext.Value(read)})
	if err != nil {
		return nil
	}
	return &signedReadPoint{contract: readFingerprint(point), read: readFingerprint(read), operation: d.Read.ID, row: d.Read.Row}
}

func (e *readWireEdge) valid(source string, points map[string]*readWirePoint, o *readWireOffer) bool {
	owner, local, ok := readEndpoint(e.Target)
	if !ok || o == nil {
		return false
	}
	if owner == source {
		p := points[local]
		if p == nil || p.Protocol != o.Protocol || p.Placement == "sidebar" && e.When != nil {
			return false
		}
	}
	if o.Protocol != publishedUtilization && !strings.HasPrefix(o.Protocol, owner+"/") ||
		o.Action["kind"] == extensionActionOpenView && !strings.HasPrefix(o.Action["point"], owner+"/") {
		return false
	}
	return e.validComparisons(o)
}

func (e *readWireEdge) validComparisons(o *readWireOffer) bool {
	if e.When == nil {
		return true
	}
	if o.Kind == extensionKindSection || len(e.When) < 1 || len(e.When) > readComparisonLimit {
		return false
	}
	for i, c := range e.When {
		if _, ok := slices.BinarySearch(o.Requests, c.Field); !ok {
			return false
		}
		for j := range i {
			if e.When[j].Field == c.Field {
				return false
			}
		}
		switch v := c.Equals.(type) {
		case string:
			if o.Fields[c.Field] != readFieldString || !boundedReadText(v) {
				return false
			}
		case float64: // json/v2 refuses nonfinite JSON numbers
			if o.Fields[c.Field] != readFieldNumber {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func admitReadManifest(r *extensionReceipt, data []byte) *admittedReadManifest {
	var w readManifestWire
	if !boundedReadManifest(data) || json.Unmarshal(data, &w, json.RejectUnknownMembers(true)) != nil || w.SchemaVersion != 1 ||
		!readOwnerID(r.ID) || r.ID != w.ID || w.Points == nil || w.Offers == nil || w.Bindings == nil {
		return nil
	}
	points := make(map[string]*readWirePoint, len(w.Points))
	offers := make(map[string]*readWireOffer, len(w.Offers))
	locators := make(map[readWireLocator]bool, len(w.Points))
	defs := readDefinitions{protocols: make(map[string]*readWireDefinition), reads: make(map[string]map[string]string)}
	for i := range w.Points {
		p := &w.Points[i]
		if points[p.ID] != nil || locators[p.Contract] || !p.valid(r.ID) || !defs.remember(&p.readWireDefinition) {
			return nil
		}
		points[p.ID], locators[p.Contract] = p, true
	}
	var features, views []string
	for i := range w.Offers {
		o := &w.Offers[i]
		if offers[o.ID] != nil || !o.valid() || !defs.remember(&o.readWireDefinition) {
			return nil
		}
		offers[o.ID] = o
		switch {
		case o.Kind == extensionKindView:
			views = append(views, o.ID)
		case o.Kind == extensionKindSection || o.Action["kind"] == extensionActionInfo:
			features = append(features, o.ID)
		}
	}
	if !matchesReadRole(r.Features, features) || !matchesReadRole(r.Views, views) {
		return nil
	}
	return w.indexReads(points, offers)
}

func (w *readManifestWire) indexReads(points map[string]*readWirePoint, offers map[string]*readWireOffer) *admittedReadManifest {
	index := &admittedReadManifest{points: make(map[string]*signedReadPoint), edges: make(map[readTarget]signedReadEdge)}
	seals := make(map[string]*signedReadPoint)
	seal := func(d *readWireDefinition) *signedReadPoint {
		if cached := seals[d.Protocol]; cached != nil {
			return cached
		}
		sealed := sealRead(d)
		seals[d.Protocol] = sealed
		return sealed
	}
	for _, p := range points {
		if p.Placement != extensionDetailTab || p.Read == nil {
			continue
		}
		sealed := seal(&p.readWireDefinition)
		if sealed == nil {
			return nil
		}
		index.points[p.ID] = sealed
	}
	targets := make(map[readTarget]bool, len(w.Bindings))
	bound := make(map[string]bool, len(offers))
	for i := range w.Bindings {
		e := &w.Bindings[i]
		b := readTarget{point: e.Target, localOffer: e.Offer}
		o := offers[e.Offer]
		if targets[b] || !e.valid(w.ID, points, o) {
			return nil
		}
		targets[b], bound[e.Offer] = true, true
		if o.RequestRead != nil {
			sealed := seal(&o.readWireDefinition)
			if sealed == nil {
				return nil
			}
			index.edges[b] = signedReadEdge{contract: sealed.contract, conditions: e.conditionFields()}
		}
	}
	if !allOffersBound(offers, bound, targets) {
		return nil
	}
	return index
}

func (e *readWireEdge) conditionFields() []string {
	fields := make([]string, len(e.When))
	for i, c := range e.When {
		fields[i] = c.Field
	}
	return fields
}

func allOffersBound(offers map[string]*readWireOffer, bound map[string]bool, targets map[readTarget]bool) bool {
	for id, o := range offers {
		if !bound[id] {
			return false
		}
		if o.Action["kind"] != extensionActionOpenView {
			continue
		}
		dest := readTarget{point: o.Action["point"], localOffer: o.Action["offer"]}
		if !targets[dest] || offers[dest.localOffer].Kind != extensionKindView {
			return false
		}
	}
	return true
}

func matchesReadRole(file *extensionFile, names []string) bool {
	if file == nil || len(names) == 0 {
		return file == nil && len(names) == 0
	}
	slices.Sort(names)
	return slices.Equal(names, file.Exports)
}
