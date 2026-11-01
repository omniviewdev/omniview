package resourcecatalog

import (
	"math/big"
	"slices"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	d2020   = resourcev2.DialectJSONSchema202012
	dDraft7 = resourcev2.DialectJSONSchemaDraft07
	dOAS30  = resourcev2.DialectOpenAPI30
)

func mustNormalize(t *testing.T, dialect, raw string) *Document {
	t.Helper()
	d, err := normalizeDocument(dialect, []byte(raw), DefaultPolicy())
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	return d
}

func node(t *testing.T, d *Document, pointer string) *Node {
	t.Helper()
	id, ok := d.Lookup(pointer)
	if !ok {
		t.Fatalf("pointer %q not normalized", pointer)
	}
	return &d.Nodes[id]
}

func requireCode(t *testing.T, err error, code, messagePart string) {
	t.Helper()
	if got := resourcev2.ErrorCode(err); got != code {
		t.Fatalf("error code = %q (%v), want %q", got, err, code)
	}
	if messagePart != "" && !strings.Contains(err.Error(), messagePart) {
		t.Fatalf("error %v does not mention %q", err, messagePart)
	}
}

func hasConstraint(n *Node, pointer, keyword string) bool {
	return slices.Contains(n.Unvalidated, Constraint{Pointer: pointer, Keyword: keyword})
}

func TestNormalizeStructuralAndEnforcedKeywords(t *testing.T) {
	d := mustNormalize(t, d2020, `{
		"type": "object",
		"required": ["b", "a", "b"],
		"additionalProperties": false,
		"properties": {
			"b": {"type": ["string", "null"], "minLength": 1, "maxLength": 5, "pattern": "^x", "format": "date-time"},
			"a": {"type": "integer", "minimum": 1, "exclusiveMaximum": 10, "multipleOf": 0.5,
			      "enum": [9007199254740993, 18446744073709551615, 1.5, "s", null, true, [1], {"k": 2}]},
			"tags": {"type": "array", "items": {"type": "string"}, "minItems": 1, "uniqueItems": true},
			"labels": {"type": "object", "additionalProperties": {"type": "string"}},
			"c": {"const": 7, "title": "T", "description": "D"}
		}
	}`)
	root := node(t, d, "")
	if root.Types != TypeObject || root.Additional != AdditionalForbidden {
		t.Fatalf("root types/additional = %v/%v", root.Types, root.Additional)
	}
	if !slices.Equal(root.Required, []string{"a", "b"}) {
		t.Fatalf("required = %v", root.Required)
	}
	var names []string
	for _, p := range root.Properties {
		names = append(names, p.Name)
	}
	if !slices.Equal(names, []string{"a", "b", "c", "labels", "tags"}) {
		t.Fatalf("properties = %v", names)
	}
	b := node(t, d, "/properties/b")
	if b.Types != TypeString|TypeNull || *b.MinLength != 1 || *b.MaxLength != 5 || b.Pattern == nil || b.Format != "date-time" {
		t.Fatalf("b = %+v", b)
	}
	a := node(t, d, "/properties/a")
	if a.Minimum.Cmp(big.NewRat(1, 1)) != 0 || a.ExclusiveMinimum || a.Maximum.Cmp(big.NewRat(10, 1)) != 0 || !a.ExclusiveMaximum {
		t.Fatalf("a bounds = %v %v %v %v", a.Minimum, a.ExclusiveMinimum, a.Maximum, a.ExclusiveMaximum)
	}
	if a.MultipleOf.Cmp(big.NewRat(1, 2)) != 0 {
		t.Fatalf("multipleOf = %v", a.MultipleOf)
	}
	wantKinds := []string{"int64", "uint64", "double", "string", "null", "bool", "list", "map"}
	for i, v := range a.Enum {
		if v.Kind != wantKinds[i] {
			t.Fatalf("enum[%d] kind = %q, want %q", i, v.Kind, wantKinds[i])
		}
	}
	if a.Enum[0].Int != "9007199254740993" || a.Enum[1].Uint != "18446744073709551615" || a.Enum[2].Double != 1.5 {
		t.Fatalf("enum numbers lost precision: %+v", a.Enum[:3])
	}
	tags := node(t, d, "/properties/tags")
	if tags.Types != TypeArray || tags.Items == 0 || d.Nodes[tags.Items].Types != TypeString || *tags.MinItems != 1 || !tags.UniqueItems {
		t.Fatalf("tags = %+v", tags)
	}
	labels := node(t, d, "/properties/labels")
	if labels.Additional != AdditionalSchema || d.Nodes[labels.AdditionalOf].Types != TypeString {
		t.Fatalf("labels = %+v", labels)
	}
	c := node(t, d, "/properties/c")
	if c.Const == nil || c.Const.Kind != "int64" || c.Const.Int != "7" || c.Title != "T" || c.Description != "D" {
		t.Fatalf("c = %+v", c)
	}
	for id := 1; id < len(d.Nodes); id++ {
		if len(d.Nodes[id].Unvalidated) != 0 {
			t.Fatalf("node %q has unvalidated %v", d.Nodes[id].Pointer, d.Nodes[id].Unvalidated)
		}
	}
}

func TestNormalizeIsDeterministic(t *testing.T) {
	raw := `{"$defs":{"z":{"type":"string"},"a":{"properties":{"q":{"$ref":"#/$defs/z"},"b":{"type":"integer"}}}},"$ref":"#/$defs/a"}`
	a, b := mustNormalize(t, d2020, raw), mustNormalize(t, d2020, raw)
	if a.Digest != b.Digest || len(a.Nodes) != len(b.Nodes) {
		t.Fatal("digest or node count differ")
	}
	for i := range a.Nodes {
		if a.Nodes[i].Pointer != b.Nodes[i].Pointer {
			t.Fatalf("node %d pointer %q != %q", i, a.Nodes[i].Pointer, b.Nodes[i].Pointer)
		}
	}
	if a.Digest == documentDigest(dDraft7, []byte(raw)) {
		t.Fatal("digest must include the dialect")
	}
}

func TestNormalizeRecursiveRefIsALink(t *testing.T) {
	d := mustNormalize(t, dDraft7, `{
		"$ref": "#/definitions/tree",
		"description": "ignored sibling",
		"definitions": {"tree": {"type": "object", "properties": {"name": {"type": "string"}, "child": {"$ref": "#/definitions/tree"}}}}
	}`)
	root := node(t, d, "")
	if root.Description != "" {
		t.Fatal("draft-07 must ignore $ref siblings")
	}
	tree, _ := d.Lookup("/definitions/tree")
	if root.Ref != tree {
		t.Fatalf("root ref = %d, want %d", root.Ref, tree)
	}
	cur := tree
	for level := 0; level < 3; level++ {
		var child NodeID
		for _, p := range d.Nodes[cur].Properties {
			if p.Name == "child" {
				child = p.Node
			}
		}
		if child == 0 || d.Nodes[child].Ref != tree {
			t.Fatalf("level %d: child does not link back to tree", level)
		}
		cur = d.Nodes[child].Ref
	}
}

func TestNormalize2020KeepsRefSiblings(t *testing.T) {
	d := mustNormalize(t, d2020, `{"$defs":{"s":{"type":"string"}},"$ref":"#/$defs/s","maxLength":3}`)
	root := node(t, d, "")
	if root.Ref == 0 || root.MaxLength == nil || *root.MaxLength != 3 {
		t.Fatalf("root = %+v", root)
	}
}

func TestNormalizeRefsToNestedDefinitionsAndPercentEncoding(t *testing.T) {
	d := mustNormalize(t, d2020, `{
		"properties": {
			"x": {"definitions": {"y z": {"type": "boolean"}}},
			"r": {"$ref": "#/properties/x/definitions/y%20z"},
			"s": {"$ref": "#/$defs/a~1b"}
		},
		"$defs": {"a/b": {"type": "integer"}}
	}`)
	if d.Nodes[node(t, d, "/properties/r").Ref].Types != TypeBoolean {
		t.Fatal("nested definition ref did not resolve")
	}
	if d.Nodes[node(t, d, "/properties/s").Ref].Types != TypeInteger {
		t.Fatal("escaped definition ref did not resolve")
	}
}

func TestNormalizeRefsIntoIgnoredRefSiblings(t *testing.T) {
	tests := []struct {
		dialect, raw, refPointer, ignoredPointer, targetPointer string
	}{
		{dDraft7, `{"definitions":{"base":{},"holder":{"$ref":"#/definitions/base","properties":{"x":{"definitions":{"target":{"type":"integer"}}}}}},"$ref":"#/definitions/holder/properties/x/definitions/target"}`, "", "/definitions/holder", "/definitions/holder/properties/x/definitions/target"},
		{dOAS30, `{"components":{"schemas":{"Base":{},"Holder":{"$ref":"#/components/schemas/Base","properties":{"x":{"type":"integer"}}},"Use":{"$ref":"#/components/schemas/Holder/properties/x"}}}}`, "/components/schemas/Use", "/components/schemas/Holder", "/components/schemas/Holder/properties/x"},
	}
	for _, tc := range tests {
		t.Run(tc.dialect, func(t *testing.T) {
			d := mustNormalize(t, tc.dialect, tc.raw)
			target := node(t, d, tc.targetPointer)
			if target.Types != TypeInteger || d.Nodes[node(t, d, tc.refPointer).Ref].Pointer != tc.targetPointer {
				t.Fatalf("reference did not resolve to integer target: %+v", target)
			}
			if len(node(t, d, tc.ignoredPointer).Properties) != 0 {
				t.Fatal("ignored sibling properties became constraints")
			}
		})
	}
}

func TestNormalizeCountsDefinitionsInsideIgnoredRefSibling(t *testing.T) {
	raw := `{"definitions":{"base":{},"holder":{"$ref":"#/definitions/base","properties":{"x":{"definitions":{"nested":{}}}}}}}`
	policy := DefaultPolicy()
	policy.MaxDefinitions = 2
	_, err := normalizeDocument(dDraft7, []byte(raw), policy)
	requireCode(t, err, codeResourceLimit, "MaxDefinitions")
}

func TestNormalizeRejectsBadRefs(t *testing.T) {
	cases := map[string]string{
		"unresolved":    `{"properties":{"a":{"$ref":"#/$defs/missing"}}}`,
		"not a schema":  `{"properties":{"a":{"$ref":"#/properties"}}}`,
		"pure cycle":    `{"$defs":{"a":{"$ref":"#/$defs/b"},"b":{"$ref":"#/$defs/a"}}}`,
		"self cycle":    `{"$defs":{"a":{"$ref":"#/$defs/a"}}}`,
		"allOf cycle":   `{"$defs":{"a":{"allOf":[{"$ref":"#/$defs/a"}]}}}`,
		"non-string":    `{"$ref":5}`,
		"bad schema":    `{"properties":{"a":5}}`,
		"empty anyOf":   `{"anyOf":[]}`,
		"bad type":      `{"type":"float"}`,
		"bad minLength": `{"minLength":-1}`,
		"bad multiple":  `{"multipleOf":0}`,
		"duplicate key": `{"type":"string","type":"integer"}`,
		"empty enum":    `{"enum":[]}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := normalizeDocument(d2020, []byte(raw), DefaultPolicy())
			requireCode(t, err, codeInvalidRequest, "")
		})
	}
}

func TestNormalizeIntegralValueBoundaries(t *testing.T) {
	cases := []struct {
		token, kind string
	}{
		{"-9223372036854775808", "int64"},
		{"9223372036854775807", "int64"},
		{"9223372036854775808", "uint64"},
		{"18446744073709551615", "uint64"},
		{"-9223372036854775809", ""},
		{"18446744073709551616", ""},
		{"999999999999999999999999999999999999999999999", ""},
	}
	for _, tc := range cases {
		for _, keyword := range []string{"enum", "const"} {
			t.Run(keyword+"/"+tc.token, func(t *testing.T) {
				value := tc.token
				pointer := "/const"
				if keyword == "enum" {
					value = "[" + value + "]"
					pointer = "/enum/0"
				}
				d, err := normalizeDocument(d2020, []byte(`{"`+keyword+`":`+value+`}`), DefaultPolicy())
				if tc.kind == "" {
					requireCode(t, err, codeInvalidRequest, pointer)
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				n := node(t, d, "")
				var got resourcev2.Value
				if keyword == "enum" {
					got = n.Enum[0]
				} else {
					got = *n.Const
				}
				if got.Kind != tc.kind || (got.Int != tc.token && got.Uint != tc.token) {
					t.Fatalf("value = %+v, want exact %s %s", got, tc.kind, tc.token)
				}
			})
		}
	}
}

func TestNormalizeNestedIntegralOverflow(t *testing.T) {
	for _, raw := range []string{
		`{"enum":[{"nested":[18446744073709551616]}]}`,
		`{"const":{"nested":[-9223372036854775809]}}`,
	} {
		_, err := normalizeDocument(d2020, []byte(raw), DefaultPolicy())
		requireCode(t, err, codeInvalidRequest, "/nested/0")
	}
}

func TestNormalizeNonIntegralTokensRemainDouble(t *testing.T) {
	d := mustNormalize(t, d2020, `{"enum":[1.0,1e0,18446744073709551616.0],"const":-9223372036854775809e0}`)
	n := node(t, d, "")
	for _, value := range n.Enum {
		if value.Kind != "double" {
			t.Fatalf("non-integral token = %+v", value)
		}
	}
	if n.Const.Kind != "double" {
		t.Fatalf("non-integral const = %+v", n.Const)
	}
}

func TestNormalizePrefixItemsReducesItemsToAny(t *testing.T) {
	for _, items := range []string{`{"type":"integer"}`, `false`, `true`} {
		t.Run(items, func(t *testing.T) {
			raw := `{"type":"object","properties":{"values":{"type":"array","prefixItems":[{"type":"string"}],"items":` + items + `,"minItems":1}}}`
			d := mustNormalize(t, d2020, raw)
			n := node(t, d, "/properties/values")
			if n.Items != 0 || !hasConstraint(n, "/properties/values", "prefixItems") {
				t.Fatalf("tuple = %+v", n)
			}
			schema := admitSchema(t, d2020, raw, "#")
			mustAdmit(t, schema, body(t, `{"values":["first",true,{"arbitrary":1}]}`), completeCoverage)
			rejectAdmit(t, schema, body(t, `{"values":[]}`), completeCoverage, "/values")
		})
	}
	// Without a tuple, homogeneous items must remain enforced.
	raw := `{"properties":{"values":{"type":"array","items":{"type":"integer"}}}}`
	schema := admitSchema(t, d2020, raw, "#")
	rejectAdmit(t, schema, body(t, `{"values":["not an integer"]}`), completeCoverage, "/values/0")
}

func TestNormalizeRecursionThroughStructureIsAllowed(t *testing.T) {
	mustNormalize(t, d2020, `{"$defs":{"list":{"type":"array","items":{"$ref":"#/$defs/list"}}},"$ref":"#/$defs/list"}`)
}

func TestNormalizeExternalAndAnchorRefsAreUnvalidatedAny(t *testing.T) {
	d := mustNormalize(t, d2020, `{"properties":{
		"ext": {"$ref": "https://example.com/schema.json#/x"},
		"rel": {"$ref": "other.json"},
		"anchor": {"$ref": "#node"}
	}}`)
	for _, name := range []string{"ext", "rel", "anchor"} {
		n := node(t, d, "/properties/"+name)
		if n.Types != 0 || n.Ref != 0 || !hasConstraint(n, "/properties/"+name, "$ref") {
			t.Fatalf("%s = %+v", name, n)
		}
	}
}

func TestNormalizeExternalRefDiscardsSiblings(t *testing.T) {
	for _, ref := range []string{`https://example.com/schema`, `other.json`, `#anchor`} {
		t.Run(ref, func(t *testing.T) {
			raw := `{"$ref":"` + ref + `","type":"string","enum":["x"],"properties":{"x":{"type":"integer"}}}`
			d := mustNormalize(t, d2020, raw)
			n := node(t, d, "")
			if n.Types != 0 || n.Ref != 0 || len(n.Enum) != 0 || len(n.Properties) != 0 ||
				!hasConstraint(n, "", "$ref") {
				t.Fatalf("external reference did not become unvalidated any: %+v", n)
			}
			schema := admitSchema(t, d2020, raw, "")
			admission := mustAdmit(t, schema, body(t, `{"x":false}`), completeCoverage)
			if admission.Validation != ValidationReduced {
				t.Fatalf("admission validation = %q, want reduced", admission.Validation)
			}
		})
	}
}

func TestNormalizeRetainsEnumAndConstStrings(t *testing.T) {
	raw := `{"enum":[{"key":["abc",123,18446744073709551615]}],"const":{"k":"xy"}}`
	d := mustNormalize(t, d2020, raw)
	// Value kinds, map keys, string payloads and integer payloads are retained.
	wantValues := len("map") + len("key") + len("list") + len("string") + len("abc") +
		len("int64") + len("123") + len("uint64") + len("18446744073709551615") +
		len("map") + len("k") + len("string") + len("xy")
	want := int64(len(raw) + nodeOverheadBytes + wantValues)
	if d.retainedBytes != want {
		t.Fatalf("retained bytes = %d, want %d", d.retainedBytes, want)
	}
	policy := DefaultPolicy()
	policy.MaxRetainedBytes = want - 1
	_, err := newStore().acquire(d2020, []byte(raw), policy)
	requireCode(t, err, codeResourceLimit, "MaxRetainedBytes")
	policy.MaxRetainedBytes = want
	if _, err := newStore().acquire(d2020, []byte(raw), policy); err != nil {
		t.Fatalf("acquire at retained-byte boundary: %v", err)
	}
}

func TestNormalizeOpenAPINullable(t *testing.T) {
	d := mustNormalize(t, dOAS30, `{"openapi":"3.0.0","paths":{"/x":{}},"components":{"schemas":{
		"N": {"type": "string", "nullable": true},
		"U": {"nullable": true},
		"E": {"type": "integer", "minimum": 1, "exclusiveMinimum": true}
	}}}`)
	if n := node(t, d, "/components/schemas/N"); n.Types != TypeString|TypeNull {
		t.Fatalf("N types = %v", n.Types)
	}
	if n := node(t, d, "/components/schemas/U"); n.Types != 0 || len(n.Unvalidated) != 0 {
		t.Fatalf("U = %+v", n)
	}
	if n := node(t, d, "/components/schemas/E"); !n.ExclusiveMinimum || n.Minimum.Cmp(big.NewRat(1, 1)) != 0 {
		t.Fatalf("E = %+v", n)
	}
	if _, ok := d.Lookup(""); ok {
		t.Fatal("OpenAPI document root must not be normalized")
	}
	j := mustNormalize(t, d2020, `{"type":"string","nullable":true}`)
	if n := node(t, j, ""); n.Types != TypeString || !hasConstraint(n, "", "nullable") {
		t.Fatalf("JSON Schema nullable = %+v", n)
	}
}

func TestNormalizeNumericExclusiveBoundsKeepStricter(t *testing.T) {
	d := mustNormalize(t, d2020, `{"properties":{
		"looser": {"minimum": 5, "exclusiveMinimum": 3},
		"stricter": {"minimum": 5, "exclusiveMinimum": 7},
		"equal": {"maximum": 5, "exclusiveMaximum": 5}
	}}`)
	if n := node(t, d, "/properties/looser"); n.Minimum.Cmp(big.NewRat(5, 1)) != 0 || n.ExclusiveMinimum {
		t.Fatalf("looser = %v %v", n.Minimum, n.ExclusiveMinimum)
	}
	if n := node(t, d, "/properties/stricter"); n.Minimum.Cmp(big.NewRat(7, 1)) != 0 || !n.ExclusiveMinimum {
		t.Fatalf("stricter = %v %v", n.Minimum, n.ExclusiveMinimum)
	}
	if n := node(t, d, "/properties/equal"); n.Maximum.Cmp(big.NewRat(5, 1)) != 0 || !n.ExclusiveMaximum {
		t.Fatalf("equal = %v %v", n.Maximum, n.ExclusiveMaximum)
	}
}

func TestNormalizeIntOrString(t *testing.T) {
	d := mustNormalize(t, dOAS30, `{"components":{"schemas":{
		"K": {"x-kubernetes-int-or-string": true},
		"io.k8s.apimachinery.pkg.util.intstr.IntOrString": {"type": "string", "format": "int-or-string", "description": "IntOrString"}
	}}}`)
	check := func(pointer, keyword, format string) {
		t.Helper()
		n := node(t, d, pointer)
		if n.Types != 0 || len(n.AnyOf) != 2 || n.Format != format {
			t.Fatalf("%s = %+v", pointer, n)
		}
		integer, text := d.Nodes[n.AnyOf[0]], d.Nodes[n.AnyOf[1]]
		if integer.Types != TypeInteger || integer.Pointer != pointer+"/"+keyword+"/0" {
			t.Fatalf("integer branch = %+v", integer)
		}
		if text.Types != TypeString || text.Pointer != pointer+"/"+keyword+"/1" {
			t.Fatalf("string branch = %+v", text)
		}
	}
	check("/components/schemas/K", "x-kubernetes-int-or-string", "")
	check("/components/schemas/io.k8s.apimachinery.pkg.util.intstr.IntOrString", "format", "int-or-string")
}

func TestAdmitIntOrStringPreservesOtherConstraints(t *testing.T) {
	for _, keyword := range []string{`"type":"string","format":"int-or-string"`, `"type":"string","x-kubernetes-int-or-string":true`} {
		t.Run(keyword, func(t *testing.T) {
			document := `{"components":{"schemas":{"T":{"properties":{"v":{` + keyword + `,"anyOf":[{"enum":["http"]}]}}}}}}`
			schema := admitSchema(t, dOAS30, document, "#/components/schemas/T")
			mustAdmit(t, schema, body(t, `{"v":"http"}`), completeCoverage)
			rejectAdmit(t, schema, body(t, `{"v":8080}`), completeCoverage, "/v")
			rejectAdmit(t, schema, body(t, `{"v":"https"}`), completeCoverage, "/v")

			nullable := `{"components":{"schemas":{"T":{"properties":{"v":{` + keyword + `,"nullable":true}}}}}}`
			schema = admitSchema(t, dOAS30, nullable, "#/components/schemas/T")
			mustAdmit(t, schema, body(t, `{"v":null}`), completeCoverage)
			mustAdmit(t, schema, body(t, `{"v":8080}`), completeCoverage)
		})
	}
}

func TestNormalizeIntOrStringFormatDialectScope(t *testing.T) {
	tests := []struct {
		name, dialect, raw, pointer string
		wantTypes                   TypeSet
		wantUnion                   bool
	}{
		{"draft2020 string", d2020, `{"type":"string","format":"int-or-string"}`, "", TypeString, false},
		{"draft2020 boolean", d2020, `{"type":"boolean","format":"int-or-string"}`, "", TypeBoolean, false},
		{"draft07 string", dDraft7, `{"type":"string","format":"int-or-string"}`, "", TypeString, false},
		{"draft07 boolean", dDraft7, `{"type":"boolean","format":"int-or-string"}`, "", TypeBoolean, false},
		{"openapi boolean", dOAS30, `{"components":{"schemas":{"T":{"type":"boolean","format":"int-or-string"}}}}`, "/components/schemas/T", TypeBoolean, false},
		{"openapi no type", dOAS30, `{"components":{"schemas":{"T":{"format":"int-or-string"}}}}`, "/components/schemas/T", 0, false},
		{"openapi string", dOAS30, `{"components":{"schemas":{"T":{"type":"string","format":"int-or-string"}}}}`, "/components/schemas/T", 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := mustNormalize(t, tc.dialect, tc.raw)
			n := node(t, d, tc.pointer)
			if n.Types != tc.wantTypes || (len(n.AnyOf) == 2) != tc.wantUnion || n.Format != "int-or-string" {
				t.Fatalf("normalized node = %+v", n)
			}
		})
	}
}

func TestAdmitIntOrStringFormatDialectScope(t *testing.T) {
	tests := []struct {
		name, dialect, document, root string
		valid, invalid                string
	}{
		{"draft2020 string", d2020, `{"properties":{"v":{"type":"string","format":"int-or-string"}}}`, "", `{"v":"x"}`, `{"v":1}`},
		{"draft07 boolean", dDraft7, `{"properties":{"v":{"type":"boolean","format":"int-or-string"}}}`, "", `{"v":true}`, `{"v":1}`},
		{"openapi boolean", dOAS30, `{"components":{"schemas":{"T":{"properties":{"v":{"type":"boolean","format":"int-or-string"}}}}}}`, "#/components/schemas/T", `{"v":true}`, `{"v":1}`},
		{"openapi string", dOAS30, `{"components":{"schemas":{"T":{"properties":{"v":{"type":"string","format":"int-or-string"}}}}}}`, "#/components/schemas/T", `{"v":1}`, `{"v":true}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			schema := admitSchema(t, tc.dialect, tc.document, tc.root)
			mustAdmit(t, schema, body(t, tc.valid), completeCoverage)
			rejectAdmit(t, schema, body(t, tc.invalid), completeCoverage, "/v")
		})
	}
}

func TestNormalizeKubernetesExtensions(t *testing.T) {
	d := mustNormalize(t, dOAS30, `{"components":{"schemas":{
		"V": {"type": "object", "x-kubernetes-validations": [{"rule": "self.a > 0"}], "x-kubernetes-unions": [{}]},
		"Set": {"type": "array", "items": {"type": "string"}, "x-kubernetes-list-type": "set"},
		"Atomic": {"type": "array", "x-kubernetes-list-type": "atomic", "x-kubernetes-patch-strategy": "merge",
		           "x-kubernetes-group-version-kind": [{}], "x-kubernetes-map-type": "atomic", "x-custom": 1},
		"P": {"type": "object", "additionalProperties": false, "x-kubernetes-preserve-unknown-fields": true},
		"D": {"type": "object", "discriminator": {"propertyName": "kind"}}
	}}}`)
	v := node(t, d, "/components/schemas/V")
	if !hasConstraint(v, "/components/schemas/V", "x-kubernetes-validations") || !hasConstraint(v, "/components/schemas/V", "x-kubernetes-unions") {
		t.Fatalf("V unvalidated = %v", v.Unvalidated)
	}
	if !hasConstraint(node(t, d, "/components/schemas/Set"), "/components/schemas/Set", "x-kubernetes-list-type") {
		t.Fatal("list-type set must be unvalidated")
	}
	if n := node(t, d, "/components/schemas/Atomic"); len(n.Unvalidated) != 0 {
		t.Fatalf("annotations recorded as unvalidated: %v", n.Unvalidated)
	}
	if n := node(t, d, "/components/schemas/P"); n.Additional != AdditionalAny {
		t.Fatalf("preserve-unknown-fields additional = %v", n.Additional)
	}
	if n := node(t, d, "/components/schemas/D"); len(n.Unvalidated) != 0 {
		t.Fatalf("OpenAPI discriminator must be an annotation: %v", n.Unvalidated)
	}
}

func TestNormalizeUnvalidatedKeywords(t *testing.T) {
	d := mustNormalize(t, dDraft7, `{
		"$id": "https://example.com/root",
		"properties": {
			"n": {"not": {"type": "string"}, "if": {}, "then": {}, "else": {}, "patternProperties": {}, "unknownWord": 1, "x-ok": 1, "$comment": "c"},
			"tuple": {"items": [{"type": "string"}]},
			"idd": {"$id": "nested"},
			"re": {"pattern": "(?<=x)y"},
			"f": false,
			"t": true
		},
		"additionalProperties": false
	}`)
	n := node(t, d, "/properties/n")
	for _, keyword := range []string{"not", "if", "then", "else", "patternProperties", "unknownWord"} {
		if !hasConstraint(n, "/properties/n", keyword) {
			t.Fatalf("missing unvalidated %q in %v", keyword, n.Unvalidated)
		}
	}
	if len(n.Unvalidated) != 6 {
		t.Fatalf("annotations leaked into unvalidated: %v", n.Unvalidated)
	}
	if tuple := node(t, d, "/properties/tuple"); tuple.Items != 0 || !hasConstraint(tuple, "/properties/tuple", "items") {
		t.Fatalf("tuple = %+v", tuple)
	}
	if !hasConstraint(node(t, d, "/properties/idd"), "/properties/idd", "$id") {
		t.Fatal("non-root $id must be unvalidated")
	}
	if len(node(t, d, "").Unvalidated) != 0 {
		t.Fatal("root $id is an annotation")
	}
	if re := node(t, d, "/properties/re"); re.Pattern != nil || !hasConstraint(re, "/properties/re", "pattern") {
		t.Fatalf("non-RE2 pattern = %+v", re)
	}
	if f := node(t, d, "/properties/f"); f.Types != 0 || !hasConstraint(f, "/properties/f", "false") {
		t.Fatalf("false schema = %+v", f)
	}
	if tr := node(t, d, "/properties/t"); tr.Types != 0 || len(tr.Unvalidated) != 0 {
		t.Fatalf("true schema = %+v", tr)
	}
	if node(t, d, "").Additional != AdditionalForbidden {
		t.Fatal("additionalProperties false must stay forbidden")
	}
}

func TestNormalizeDialects(t *testing.T) {
	_, err := normalizeDocument("https://json-schema.org/draft/2019-09/schema", []byte(`{}`), DefaultPolicy())
	requireCode(t, err, codeUnsupported, "unsupported schema dialect")

	_, err = normalizeDocument(d2020, []byte(`{"$schema":"http://json-schema.org/draft-07/schema#"}`), DefaultPolicy())
	requireCode(t, err, codeInvalidRequest, "schema document dialect does not match binding")

	mustNormalize(t, d2020, `{"$schema":"http://json-schema.org/draft/2020-12/schema#"}`)
	mustNormalize(t, dDraft7, `{"$schema":"https://json-schema.org/draft-07/schema"}`)
}

func TestNormalizePolicyBoundaries(t *testing.T) {
	cases := []struct {
		field    string
		dialect  string
		raw      string
		boundary int
		set      func(*Policy, int)
	}{
		{"MaxDocumentBytes", d2020, `{"type":"string"}`, len(`{"type":"string"}`), func(p *Policy, v int) { p.MaxDocumentBytes = v }},
		{"MaxDocumentNodes", d2020, `{"properties":{"a":{},"b":{}}}`, 3, func(p *Policy, v int) { p.MaxDocumentNodes = v }},
		{"MaxDocumentNodes", dOAS30, `{"components":{"schemas":{"I":{"x-kubernetes-int-or-string":true}}}}`, 3, func(p *Policy, v int) { p.MaxDocumentNodes = v }},
		{"MaxDefinitions", d2020, `{"$defs":{"a":{"definitions":{"c":{}}},"b":{}}}`, 3, func(p *Policy, v int) { p.MaxDefinitions = v }},
		{"MaxDefinitions", dOAS30, `{"components":{"schemas":{"a":{},"b":{}}}}`, 2, func(p *Policy, v int) { p.MaxDefinitions = v }},
		{"MaxDepth", d2020, `{"properties":{"a":{"items":{"anyOf":[{}]}}}}`, 3, func(p *Policy, v int) { p.MaxDepth = v }},
		{"MaxRefChain", d2020, `{"$defs":{"a":{"$ref":"#/$defs/b"},"b":{"$ref":"#/$defs/c"},"c":{"type":"string"}}}`, 2, func(p *Policy, v int) { p.MaxRefChain = v }},
		{"MaxUnionBranches", d2020, `{"oneOf":[{},{},{}]}`, 3, func(p *Policy, v int) { p.MaxUnionBranches = v }},
		{"MaxUnionBranches", dOAS30, `{"components":{"schemas":{"I":{"type":"string","format":"int-or-string"}}}}`, 2, func(p *Policy, v int) { p.MaxUnionBranches = v }},
		{"MaxEnumValues", d2020, `{"enum":[1,2,3]}`, 3, func(p *Policy, v int) { p.MaxEnumValues = v }},
	}
	for _, tc := range cases {
		t.Run(tc.field+"/"+tc.dialect, func(t *testing.T) {
			atBoundary := DefaultPolicy()
			tc.set(&atBoundary, tc.boundary)
			if _, err := normalizeDocument(tc.dialect, []byte(tc.raw), atBoundary); err != nil {
				t.Fatalf("at boundary %d: %v", tc.boundary, err)
			}
			// The document exceeds the ceiling by exactly one.
			overBoundary := DefaultPolicy()
			tc.set(&overBoundary, tc.boundary-1)
			_, err := normalizeDocument(tc.dialect, []byte(tc.raw), overBoundary)
			requireCode(t, err, codeResourceLimit, tc.field)
		})
	}
}

func TestNormalizeOpenAPIIgnoresNonSchemaSections(t *testing.T) {
	d := mustNormalize(t, dOAS30, `{"openapi":"3.0.0","info":{"title":"x"},"paths":{"/a":{"get":{"responses":{}}}},"components":{"schemas":{"A":{"type":"object"}}}}`)
	if len(d.Nodes) != 2 {
		t.Fatalf("nodes = %d, want 1 normalized schema", len(d.Nodes)-1)
	}
	_, err := normalizeDocument(dOAS30, []byte(`{"components":{"schemas":{"A":{"$ref":"#/paths/~1a"}}},"paths":{"/a":{}}}`), DefaultPolicy())
	requireCode(t, err, codeInvalidRequest, "does not resolve")
}
