package query

import "encoding/json"

// objectFields rejects null, absent required fields and explicit null optionals.
func objectFields(raw json.RawMessage, required, optional []string) (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, invalid("expected object")
	}
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, k := range required {
		allowed[k] = true
		v, ok := m[k]
		if !ok || string(v) == "null" {
			return nil, invalid("missing required field")
		}
	}
	for _, k := range optional {
		allowed[k] = true
	}
	for k, v := range m {
		if !allowed[k] || string(v) == "null" {
			return nil, invalid("unknown or null field")
		}
	}
	return m, nil
}
func validateRequestShape(raw []byte) error {
	root, err := objectFields(raw, []string{"version", "targets", "predicate", "declarations", "bindings", "projection", "order", "delivery"}, []string{"text"})
	if err != nil {
		return err
	}
	var predicate struct {
		Language string `json:"language"`
	}
	if json.Unmarshal(root["predicate"], &predicate) != nil {
		return invalid("invalid predicate")
	}
	switch predicate.Language {
	case "cel":
		_, err = objectFields(root["predicate"], []string{"language", "profile", "source"}, nil)
	case "builder":
		_, err = objectFields(root["predicate"], []string{"language", "version", "document"}, nil)
	default:
		return invalid("unknown predicate language")
	}
	if err != nil {
		return err
	}
	var decl map[string]json.RawMessage
	if json.Unmarshal(root["declarations"], &decl) != nil || decl == nil {
		return invalid("invalid declarations")
	}
	for _, v := range decl {
		if err := validateTypeShape(v, 0); err != nil {
			return err
		}
	}
	if _, err = objectFields(root["delivery"], []string{"mode", "pageSize"}, []string{"after", "allowPartial"}); err != nil {
		return err
	}
	if text, ok := root["text"]; ok {
		if _, err = objectFields(text, []string{"term", "fields", "match", "case", "combine"}, nil); err != nil {
			return err
		}
	}
	return nil
}
func validateTypeShape(raw json.RawMessage, depth int) error {
	if depth > 32 {
		return limit("binding type too deep")
	}
	var discr struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(raw, &discr) != nil {
		return invalid("invalid binding type")
	}
	var m map[string]json.RawMessage
	var err error
	switch discr.Kind {
	case "bool", "string", "int64", "uint64", "double", "timestamp":
		_, err = objectFields(raw, []string{"kind"}, nil)
		return err
	case "list":
		m, err = objectFields(raw, []string{"kind", "element"}, nil)
		if err != nil {
			return err
		}
		return validateTypeShape(m["element"], depth+1)
	case "map", "nullable":
		m, err = objectFields(raw, []string{"kind", "value"}, nil)
		if err != nil {
			return err
		}
		return validateTypeShape(m["value"], depth+1)
	default:
		return invalid("invalid binding type")
	}
}
