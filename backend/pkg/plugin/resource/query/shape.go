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
	var targets []json.RawMessage
	if json.Unmarshal(root["targets"], &targets) != nil || targets == nil {
		return invalid("invalid targets")
	}
	for _, target := range targets {
		fields, err := objectFields(target, []string{"targetId", "provider", "authority", "type", "accessRoute", "representation", "scope"}, nil)
		if err != nil {
			return err
		}
		if _, err = objectFields(fields["representation"], []string{"id", "revision"}, nil); err != nil {
			return err
		}
	}
	for _, collection := range []string{"projection", "order"} {
		var entries []json.RawMessage
		if json.Unmarshal(root[collection], &entries) != nil || entries == nil {
			return invalid("invalid query collection")
		}
		for _, entry := range entries {
			var fields map[string]json.RawMessage
			if collection == "projection" {
				fields, err = objectFields(entry, []string{"id", "path"}, nil)
			} else {
				fields, err = objectFields(entry, []string{"path", "direction", "missing", "null"}, nil)
			}
			if err != nil {
				return err
			}
			if err = validatePathShape(fields["path"]); err != nil {
				return err
			}
		}
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
		fields, err := objectFields(text, []string{"term", "fields", "match", "case", "combine"}, nil)
		if err != nil {
			return err
		}
		var paths []json.RawMessage
		if json.Unmarshal(fields["fields"], &paths) != nil || paths == nil {
			return invalid("invalid text fields")
		}
		for _, path := range paths {
			if err := validatePathShape(path); err != nil {
				return err
			}
		}
	}
	return nil
}
func validatePathShape(raw json.RawMessage) error {
	var segments []json.RawMessage
	if json.Unmarshal(raw, &segments) != nil || segments == nil {
		return invalid("invalid field path")
	}
	for _, raw := range segments {
		var discr map[string]json.RawMessage
		if json.Unmarshal(raw, &discr) != nil || discr == nil {
			return invalid("invalid path segment")
		}
		var kind string
		if json.Unmarshal(discr["kind"], &kind) != nil {
			return invalid("invalid path kind")
		}
		var err error
		switch kind {
		case "member":
			_, err = objectFields(raw, []string{"kind", "name"}, nil)
		case "index":
			_, err = objectFields(raw, []string{"kind", "index"}, nil)
		default:
			return invalid("invalid path kind")
		}
		if err != nil {
			return err
		}
	}
	return nil
}
func validateBuilderPathShape(raw json.RawMessage) error {
	fields, err := objectFields(raw, []string{"root", "segments"}, nil)
	if err != nil {
		return err
	}
	if err = validatePathShape(fields["segments"]); err != nil {
		return err
	}
	var root string
	if json.Unmarshal(fields["root"], &root) == nil {
		return nil
	}
	_, err = objectFields(fields["root"], []string{"element"}, nil)
	return err
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
