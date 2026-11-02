package resourcecatalog

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

func decodeEditor(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var out map[string]any
	if err := decoder.Decode(&out); err != nil {
		t.Fatalf("editor JSON does not parse: %v\n%s", err, raw)
	}
	return out
}

func editorDefinition(t *testing.T, doc map[string]any, ref string) map[string]any {
	t.Helper()
	name := strings.TrimPrefix(ref, "#/definitions/")
	def, ok := doc["definitions"].(map[string]any)[name].(map[string]any)
	if !ok {
		t.Fatalf("definition %q missing", ref)
	}
	return def
}

func TestEditorJSONRendersDraft07(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, `{
		"$defs": {"s": {"type": "string"}},
		"type": "object",
		"required": ["big"],
		"additionalProperties": false,
		"properties": {
			"big": {"type": "integer", "enum": [9007199254740993, 1.5, "x", null, true]},
			"ratio": {"type": "number", "exclusiveMinimum": 0.1, "maximum": 1e2, "multipleOf": 0.25},
			"named": {"$ref": "#/$defs/s", "maxLength": 3},
			"plain": {"$ref": "#/$defs/s"},
			"nullable": {"type": ["string", "null"], "pattern": "^a", "title": "T"},
			"opaque": {"not": {}}
		}
	}`, "")
	before := c.Stats().RetainedBytes
	raw, err := schema.Document.EditorJSON()
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := schema.Document.EditorJSON(); &again[0] != &raw[0] {
		t.Fatal("editor JSON must be rendered once per document")
	}
	if got := c.Stats().RetainedBytes; got != before+int64(len(raw)) {
		t.Fatalf("retained bytes = %d, want %d", got, before+int64(len(raw)))
	}
	doc := decodeEditor(t, raw)
	if doc["$schema"] != "http://json-schema.org/draft-07/schema#" {
		t.Fatalf("$schema = %v", doc["$schema"])
	}
	if EditorRoot(schema) != "#/definitions/n1" {
		t.Fatalf("root = %s", EditorRoot(schema))
	}
	root := editorDefinition(t, doc, EditorRoot(schema))
	if root["type"] != "object" || root["additionalProperties"] != false {
		t.Fatalf("root = %v", root)
	}
	props := root["properties"].(map[string]any)
	ref := func(name string) string { return props[name].(map[string]any)["$ref"].(string) }

	if !bytes.Contains(raw, []byte(`"enum":[9007199254740993,1.5,"x",null,true]`)) {
		t.Fatalf("enum must render plain JSON literals: %s", raw)
	}
	if n := editorDefinition(t, doc, ref("big"))["enum"].([]any)[0]; n != json.Number("9007199254740993") {
		t.Fatalf("int64 enum = %#v", n)
	}
	ratio := editorDefinition(t, doc, ref("ratio"))
	if ratio["exclusiveMinimum"] != json.Number("0.1") || ratio["maximum"] != json.Number("100") || ratio["multipleOf"] != json.Number("0.25") {
		t.Fatalf("ratio = %v", ratio)
	}
	named := editorDefinition(t, doc, ref("named"))
	if _, direct := named["$ref"]; direct || named["maxLength"] != json.Number("3") || len(named["allOf"].([]any)) != 1 {
		t.Fatalf("2020-12 $ref with siblings = %v", named)
	}
	if plain := editorDefinition(t, doc, ref("plain")); len(plain) != 1 || plain["$ref"] == nil {
		t.Fatalf("bare $ref = %v", plain)
	}
	nullable := editorDefinition(t, doc, ref("nullable"))
	if types := nullable["type"].([]any); len(types) != 2 || types[0] != "null" || types[1] != "string" || nullable["title"] != "T" || nullable["pattern"] != "^a" {
		t.Fatalf("nullable = %v", nullable)
	}
	if opaque := editorDefinition(t, doc, ref("opaque")); len(opaque) != 0 {
		t.Fatalf("unvalidated keywords must be omitted: %v", opaque)
	}
}

func TestEditorJSONSizeLimit(t *testing.T) {
	raw := `{"type":"object","properties":{"a":{"type":"string"}}}`
	policy := DefaultPolicy()
	policy.MaxDocumentBytes = len(raw)
	d, err := normalizeDocument(d2020, []byte(raw), policy)
	if err != nil {
		t.Fatal(err)
	}
	_, err = d.EditorJSON()
	requireCode(t, err, codeResourceLimit, "MaxDocumentBytes")

	rendered, err := mustNormalize(t, d2020, raw).EditorJSON()
	if err != nil {
		t.Fatal(err)
	}
	policy.MaxDocumentBytes = len(rendered)
	if d, err = normalizeDocument(d2020, []byte(raw), policy); err != nil {
		t.Fatal(err)
	}
	if _, err := d.EditorJSON(); err != nil {
		t.Fatalf("output at the boundary: %v", err)
	}
}

func TestEditorJSONRetainedBytesLimit(t *testing.T) {
	const first = `{"type":"string"}`
	const second = `{"type":"integer"}`
	firstDoc := mustNormalize(t, d2020, first)
	secondDoc := mustNormalize(t, d2020, second)
	rendered, err := renderEditorDocument(firstDoc)
	if err != nil {
		t.Fatal(err)
	}
	base := firstDoc.retainedBytes + secondDoc.retainedBytes
	exact := base + int64(len(rendered))

	for _, tc := range []struct {
		name  string
		limit int64
		ok    bool
	}{
		{name: "exact", limit: exact, ok: true},
		{name: "one byte over", limit: exact - 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			policy := DefaultPolicy()
			policy.MaxRetainedBytes = tc.limit
			s := newStore()
			d1, err := s.acquire(d2020, []byte(first), policy)
			if err != nil {
				t.Fatal(err)
			}
			d2, err := s.acquire(d2020, []byte(second), policy)
			if err != nil {
				t.Fatal(err)
			}
			if got := s.stats().retainedBytes; got != base {
				t.Fatalf("retained bytes before render = %d, want %d", got, base)
			}
			for range 2 {
				out, err := d1.EditorJSON()
				if tc.ok {
					if err != nil || !bytes.Equal(out, rendered) {
						t.Fatalf("render = %s, %v", out, err)
					}
				} else {
					requireCode(t, err, codeResourceLimit, "MaxRetainedBytes")
					if out != nil {
						t.Fatalf("failed render returned %d bytes", len(out))
					}
				}
			}
			want := base
			if tc.ok {
				want = exact
			}
			if got := s.stats().retainedBytes; got != want {
				t.Fatalf("retained bytes after render = %d, want %d", got, want)
			}
			s.release(d1)
			if got := s.stats().retainedBytes; got != secondDoc.retainedBytes {
				t.Fatalf("retained bytes after first release = %d, want %d", got, secondDoc.retainedBytes)
			}
			s.release(d2)
			if got := s.stats().retainedBytes; got != 0 {
				t.Fatalf("retained bytes after release = %d, want 0", got)
			}
		})
	}
}

func TestEditorJSONConcurrentRetainedBytesLimit(t *testing.T) {
	raw := []string{`{"type":"string"}`, `{"type":"integer"}`}
	var normalized [2]*Document
	var lengths [2]int64
	var base int64
	for i, input := range raw {
		normalized[i] = mustNormalize(t, d2020, input)
		rendered, err := renderEditorDocument(normalized[i])
		if err != nil {
			t.Fatal(err)
		}
		lengths[i] = int64(len(rendered))
		base += normalized[i].retainedBytes
	}
	policy := DefaultPolicy()
	policy.MaxRetainedBytes = base + max(lengths[0], lengths[1])
	s := newStore()
	var documents [2]*Document
	for i, input := range raw {
		var err error
		documents[i], err = s.acquire(d2020, []byte(input), policy)
		if err != nil {
			t.Fatal(err)
		}
	}

	type result struct {
		index int
		out   []byte
		err   error
	}
	start := make(chan struct{})
	results := make(chan result, len(documents))
	var ready sync.WaitGroup
	ready.Add(len(documents))
	for i, d := range documents {
		go func(i int, d *Document) {
			ready.Done()
			<-start
			out, err := d.EditorJSON()
			results <- result{index: i, out: out, err: err}
		}(i, d)
	}
	ready.Wait()
	close(start)
	var successes, failures int
	want := base
	for range documents {
		result := <-results
		if result.err != nil {
			requireCode(t, result.err, codeResourceLimit, "MaxRetainedBytes")
			if result.out != nil {
				t.Fatalf("failed render returned %d bytes", len(result.out))
			}
			failures++
		} else {
			successes++
			want += lengths[result.index]
		}
	}
	if successes != 1 || failures != 1 {
		t.Fatalf("successes = %d, failures = %d, want one each", successes, failures)
	}
	if got := s.stats().retainedBytes; got != want || got > policy.MaxRetainedBytes {
		t.Fatalf("retained bytes = %d, want %d (limit %d)", got, want, policy.MaxRetainedBytes)
	}
	for _, d := range documents {
		s.release(d)
	}
	if got := s.stats().retainedBytes; got != 0 {
		t.Fatalf("retained bytes after release = %d, want 0", got)
	}
}

func TestEditorJSONSharedDocumentChargesOnce(t *testing.T) {
	const raw = `{"type":"string"}`
	normalized := mustNormalize(t, d2020, raw)
	rendered, err := renderEditorDocument(normalized)
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	policy.MaxRetainedBytes = normalized.retainedBytes + int64(len(rendered))
	s := newStore()
	first, err := s.acquire(d2020, []byte(raw), policy)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.acquire(d2020, []byte(raw), policy)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("identical documents must be shared")
	}

	start := make(chan struct{})
	errors := make(chan error, 2)
	for _, d := range []*Document{first, second} {
		go func(d *Document) {
			<-start
			_, err := d.EditorJSON()
			errors <- err
		}(d)
	}
	close(start)
	for range 2 {
		if err := <-errors; err != nil {
			t.Fatal(err)
		}
	}
	if got := s.stats().retainedBytes; got != policy.MaxRetainedBytes {
		t.Fatalf("retained bytes = %d, want %d", got, policy.MaxRetainedBytes)
	}
	s.release(first)
	if got := s.stats().retainedBytes; got != policy.MaxRetainedBytes {
		t.Fatalf("retained bytes after first release = %d, want %d", got, policy.MaxRetainedBytes)
	}
	s.release(second)
	if got := s.stats().retainedBytes; got != 0 {
		t.Fatalf("retained bytes after last release = %d, want 0", got)
	}
}
