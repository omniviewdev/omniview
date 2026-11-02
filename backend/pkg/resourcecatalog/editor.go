package resourcecatalog

import (
	"bytes"
	"encoding/json"
	"math/big"
	"sort"
	"strconv"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const editorDialect = "http://json-schema.org/draft-07/schema#"

// EditorJSON renders the document as one draft-07 schema whose definitions
// are the normalized nodes ("n<id>"). It is rendered once per document; the
// bytes are charged to the document's retained bytes. Callers must not
// modify the returned slice. Output above MaxDocumentBytes or a retention
// charge above MaxRetainedBytes returns RESOURCE_LIMIT.
func (d *Document) EditorJSON() ([]byte, error) {
	value, err := d.editorJSON.load(func() (any, error) {
		out, err := renderEditorDocument(d)
		if err != nil {
			return nil, err
		}
		if d.store != nil {
			if err := d.addRetainedBytes(int64(len(out))); err != nil {
				return nil, err
			}
		}
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	return value.([]byte), nil
}

// EditorRoot returns the editor JSON pointer of the schema root.
func EditorRoot(schema *Schema) string {
	return editorRef(schema.Root)
}

func editorRef(id NodeID) string {
	return "#/definitions/n" + strconv.FormatUint(uint64(id), 10)
}

func renderEditorDocument(d *Document) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString(`{"$schema":`)
	writeJSONString(&buf, editorDialect)
	buf.WriteString(`,"definitions":{`)
	for id := 1; id < len(d.Nodes); id++ {
		if id > 1 {
			buf.WriteByte(',')
		}
		writeJSONString(&buf, "n"+strconv.Itoa(id))
		buf.WriteByte(':')
		if err := renderEditorNode(&buf, &d.Nodes[id]); err != nil {
			return nil, err
		}
		if buf.Len() > d.maxDocumentBytes {
			return nil, limitf("MaxDocumentBytes", int64(d.maxDocumentBytes), "")
		}
	}
	buf.WriteString("}}")
	if buf.Len() > d.maxDocumentBytes {
		return nil, limitf("MaxDocumentBytes", int64(d.maxDocumentBytes), "")
	}
	return buf.Bytes(), nil
}

// objectWriter writes the members of one JSON object.
type objectWriter struct {
	buf     *bytes.Buffer
	members int
}

func (w *objectWriter) key(name string) {
	if w.members > 0 {
		w.buf.WriteByte(',')
	}
	w.members++
	writeJSONString(w.buf, name)
	w.buf.WriteByte(':')
}

func (w *objectWriter) refs(name string, ids []NodeID) {
	w.key(name)
	w.buf.WriteByte('[')
	for i, id := range ids {
		if i > 0 {
			w.buf.WriteByte(',')
		}
		writeRef(w.buf, id)
	}
	w.buf.WriteByte(']')
}

func (w *objectWriter) uint32(name string, v *uint32) {
	if v != nil {
		w.key(name)
		w.buf.WriteString(strconv.FormatUint(uint64(*v), 10))
	}
}

func (w *objectWriter) rat(name string, v *big.Rat) error {
	text, err := exactDecimal(v)
	if err != nil {
		return err
	}
	w.key(name)
	w.buf.WriteString(text)
	return nil
}

func (w *objectWriter) string(name, v string) {
	if v != "" {
		w.key(name)
		writeJSONString(w.buf, v)
	}
}

func writeRef(buf *bytes.Buffer, id NodeID) {
	buf.WriteString(`{"$ref":`)
	writeJSONString(buf, editorRef(id))
	buf.WriteByte('}')
}

// renderEditorNode writes one node. Unvalidated constraints are omitted. A
// Ref with kept siblings (2020-12) renders as an allOf member because draft-07
// consumers ignore $ref siblings.
func renderEditorNode(buf *bytes.Buffer, n *Node) error {
	buf.WriteByte('{')
	w := &objectWriter{buf: buf}
	if n.Ref != 0 && !hasEditorSiblings(n) {
		w.key("$ref")
		writeJSONString(buf, editorRef(n.Ref))
		buf.WriteByte('}')
		return nil
	}
	if names := typeNames(n.Types); len(names) == 1 {
		w.key("type")
		writeJSONString(buf, names[0])
	} else if len(names) > 1 {
		w.key("type")
		writeJSONStrings(buf, names)
	}
	if len(n.Properties) > 0 {
		w.key("properties")
		props := &objectWriter{buf: buf}
		buf.WriteByte('{')
		for _, p := range n.Properties {
			props.key(p.Name)
			writeRef(buf, p.Node)
		}
		buf.WriteByte('}')
	}
	if len(n.Required) > 0 {
		w.key("required")
		writeJSONStrings(buf, n.Required)
	}
	switch n.Additional {
	case AdditionalForbidden:
		w.key("additionalProperties")
		buf.WriteString("false")
	case AdditionalSchema:
		w.key("additionalProperties")
		writeRef(buf, n.AdditionalOf)
	}
	if n.Items != 0 {
		w.key("items")
		writeRef(buf, n.Items)
	}
	allOf := n.AllOf
	if n.Ref != 0 {
		allOf = append([]NodeID{n.Ref}, n.AllOf...)
	}
	if len(allOf) > 0 {
		w.refs("allOf", allOf)
	}
	if len(n.AnyOf) > 0 {
		w.refs("anyOf", n.AnyOf)
	}
	if len(n.OneOf) > 0 {
		w.refs("oneOf", n.OneOf)
	}
	if n.Enum != nil {
		w.key("enum")
		buf.WriteByte('[')
		for i, v := range n.Enum {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeEditorValue(buf, v); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	}
	if n.Const != nil {
		w.key("const")
		if err := writeEditorValue(buf, *n.Const); err != nil {
			return err
		}
	}
	w.string("format", n.Format)
	if n.Minimum != nil {
		name := "minimum"
		if n.ExclusiveMinimum {
			name = "exclusiveMinimum"
		}
		if err := w.rat(name, n.Minimum); err != nil {
			return err
		}
	}
	if n.Maximum != nil {
		name := "maximum"
		if n.ExclusiveMaximum {
			name = "exclusiveMaximum"
		}
		if err := w.rat(name, n.Maximum); err != nil {
			return err
		}
	}
	if n.MultipleOf != nil {
		if err := w.rat("multipleOf", n.MultipleOf); err != nil {
			return err
		}
	}
	w.uint32("minLength", n.MinLength)
	w.uint32("maxLength", n.MaxLength)
	w.uint32("minItems", n.MinItems)
	w.uint32("maxItems", n.MaxItems)
	w.uint32("minProperties", n.MinProperties)
	w.uint32("maxProperties", n.MaxProperties)
	if n.Pattern != nil {
		w.string("pattern", n.Pattern.String())
	}
	if n.UniqueItems {
		w.key("uniqueItems")
		buf.WriteString("true")
	}
	w.string("title", n.Title)
	w.string("description", n.Description)
	buf.WriteByte('}')
	return nil
}

// hasEditorSiblings reports whether a node renders any keyword besides $ref.
func hasEditorSiblings(n *Node) bool {
	return n.Types != 0 || len(n.Properties) > 0 || len(n.Required) > 0 || n.Additional != AdditionalAny ||
		n.Items != 0 || len(n.AllOf) > 0 || len(n.AnyOf) > 0 || len(n.OneOf) > 0 || n.Enum != nil ||
		n.Const != nil || n.Format != "" || n.Minimum != nil || n.Maximum != nil || n.MultipleOf != nil ||
		n.MinLength != nil || n.MaxLength != nil || n.MinItems != nil || n.MaxItems != nil ||
		n.MinProperties != nil || n.MaxProperties != nil || n.Pattern != nil || n.UniqueItems ||
		n.Title != "" || n.Description != ""
}

// exactDecimal renders r as an exact decimal with the fewest digits:
// integers without a fraction.
func exactDecimal(r *big.Rat) (string, error) {
	if r.IsInt() {
		return r.Num().String(), nil
	}
	denominator := new(big.Int).Set(r.Denom())
	twos, fives := 0, 0
	two, five := big.NewInt(2), big.NewInt(5)
	for new(big.Int).Rem(denominator, two).Sign() == 0 {
		denominator.Quo(denominator, two)
		twos++
	}
	for new(big.Int).Rem(denominator, five).Sign() == 0 {
		denominator.Quo(denominator, five)
		fives++
	}
	if denominator.Cmp(big.NewInt(1)) != 0 {
		return "", invalidf("schema bound %s is not a terminating decimal", r.String())
	}
	return r.FloatString(max(twos, fives)), nil
}

// writeEditorValue writes a tagged value as a plain JSON literal.
func writeEditorValue(buf *bytes.Buffer, v resourcev2.Value) error {
	switch v.Kind {
	case "null":
		buf.WriteString("null")
	case "bool":
		buf.WriteString(strconv.FormatBool(v.Bool))
	case "string":
		writeJSONString(buf, v.String)
	case "int64":
		buf.WriteString(v.Int)
	case "uint64":
		buf.WriteString(v.Uint)
	case "double":
		buf.WriteString(strconv.FormatFloat(v.Double, 'g', -1, 64))
	case "timestamp":
		writeJSONString(buf, v.Timestamp)
	case "list":
		buf.WriteByte('[')
		for i, item := range v.List {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeEditorValue(buf, item); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case "map":
		keys := make([]string, 0, len(v.Map))
		for k := range v.Map {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			writeJSONString(buf, k)
			buf.WriteByte(':')
			if err := writeEditorValue(buf, v.Map[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		return invalidf("schema value kind %q cannot be rendered", v.Kind)
	}
	return nil
}

func writeJSONString(buf *bytes.Buffer, s string) {
	encoded, _ := json.Marshal(s) // marshalling a string cannot fail
	buf.Write(encoded)
}

func writeJSONStrings(buf *bytes.Buffer, values []string) {
	buf.WriteByte('[')
	for i, s := range values {
		if i > 0 {
			buf.WriteByte(',')
		}
		writeJSONString(buf, s)
	}
	buf.WriteByte(']')
}
