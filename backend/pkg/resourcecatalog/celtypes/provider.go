package celtypes

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"cel.dev/cel-go/common/types"
	"cel.dev/cel-go/common/types/ref"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// maxTypeNesting bounds list/map type nesting that does not pass through a
// named struct (only reachable through array-of-self ref cycles). Deeper
// positions map to dyn.
const maxTypeNesting = 64

// provider is the types.Provider of one immutable Document. Struct types are
// named omniview.schema.<hex16(digest)>.n<id>; their field types are derived
// on demand from the document, so the provider holds no per-node state.
type provider struct {
	document *resourcecatalog.Document
	prefix   string
	base     *types.Registry
}

var _ types.Provider = (*provider)(nil)

func newProvider(document *resourcecatalog.Document) *provider {
	base, err := types.NewRegistry()
	if err != nil {
		// NewRegistry without descriptors cannot fail.
		panic(err)
	}
	return &provider{
		document: document,
		prefix:   "omniview.schema." + hex.EncodeToString(document.Digest[:8]) + ".n",
		base:     base,
	}
}

// typeOf maps a node to its CEL type (spec §8 table).
func (p *provider) typeOf(id resourcecatalog.NodeID) *types.Type {
	return p.typeAt(id, 0)
}

func (p *provider) typeAt(id resourcecatalog.NodeID, nesting int) *types.Type {
	id, ok := resourcecatalog.CELShape(p.document, id)
	if !ok || nesting > maxTypeNesting {
		return types.DynType
	}
	n := &p.document.Nodes[id]
	switch n.Types {
	case resourcecatalog.TypeBoolean:
		return types.BoolType
	case resourcecatalog.TypeString:
		if n.Format == "date-time" {
			return types.DynType
		}
		return types.StringType
	case resourcecatalog.TypeInteger:
		switch n.Format {
		case "int32", "int64":
			return types.IntType
		case "uint32", "uint64":
			return types.UintType
		}
		return types.DynType
	case resourcecatalog.TypeNull:
		return types.NullType
	case resourcecatalog.TypeArray:
		if n.Items == 0 {
			return types.NewListType(types.DynType)
		}
		return types.NewListType(p.typeAt(n.Items, nesting+1))
	case resourcecatalog.TypeObject:
		if isStruct(n) {
			return types.NewObjectType(p.structName(id))
		}
		if n.Additional == resourcecatalog.AdditionalSchema {
			return types.NewMapType(types.StringType, p.typeAt(n.AdditionalOf, nesting+1))
		}
		return types.NewMapType(types.StringType, types.DynType)
	}
	// number, nullable, multi-type and any.
	return types.DynType
}

func isStruct(n *resourcecatalog.Node) bool {
	return n.Types == resourcecatalog.TypeObject && (len(n.Properties) > 0 || n.Additional == resourcecatalog.AdditionalForbidden)
}

func (p *provider) structName(id resourcecatalog.NodeID) string {
	return p.prefix + strconv.FormatUint(uint64(id), 10)
}

// structNode returns the struct node named structType, if it is one of ours.
func (p *provider) structNode(structType string) (*resourcecatalog.Node, bool) {
	suffix, ok := strings.CutPrefix(structType, p.prefix)
	if !ok {
		return nil, false
	}
	raw, err := strconv.ParseUint(suffix, 10, 32)
	if err != nil || raw == 0 || raw >= uint64(len(p.document.Nodes)) || strconv.FormatUint(raw, 10) != suffix {
		return nil, false
	}
	n := &p.document.Nodes[raw]
	if !isStruct(n) {
		return nil, false
	}
	return n, true
}

// EnumValue implements types.Provider.
func (p *provider) EnumValue(enumName string) ref.Val { return p.base.EnumValue(enumName) }

// FindIdent implements types.Provider.
func (p *provider) FindIdent(identName string) (ref.Val, bool) { return p.base.FindIdent(identName) }

// FindStructType implements types.Provider.
func (p *provider) FindStructType(structType string) (*types.Type, bool) {
	if _, ok := p.structNode(structType); ok {
		return types.NewTypeTypeWithParam(types.NewObjectType(structType)), true
	}
	return p.base.FindStructType(structType)
}

// FindStructFieldNames implements types.Provider.
func (p *provider) FindStructFieldNames(structType string) ([]string, bool) {
	n, ok := p.structNode(structType)
	if !ok {
		return p.base.FindStructFieldNames(structType)
	}
	names := make([]string, len(n.Properties))
	for i, property := range n.Properties {
		names[i] = property.Name
	}
	return names, true
}

// FindStructFieldType implements types.Provider. Declared properties map
// through the table; undeclared names are a checker error on closed objects,
// the additional schema type on AdditionalSchema objects, and dyn otherwise.
func (p *provider) FindStructFieldType(structType, fieldName string) (*types.FieldType, bool) {
	n, ok := p.structNode(structType)
	if !ok {
		return p.base.FindStructFieldType(structType, fieldName)
	}
	var fieldType *types.Type
	i := sort.Search(len(n.Properties), func(i int) bool { return n.Properties[i].Name >= fieldName })
	switch {
	case i < len(n.Properties) && n.Properties[i].Name == fieldName:
		fieldType = p.typeOf(n.Properties[i].Node)
	case n.Additional == resourcecatalog.AdditionalForbidden:
		return nil, false
	case n.Additional == resourcecatalog.AdditionalSchema:
		fieldType = p.typeOf(n.AdditionalOf)
	default:
		fieldType = types.DynType
	}
	return &types.FieldType{
		Type:  fieldType,
		IsSet: func(target any) bool { _, set := mapField(target, fieldName); return set },
		GetFrom: func(target any) (any, error) {
			v, set := mapField(target, fieldName)
			if !set {
				return nil, fmt.Errorf("no such key: %s", fieldName)
			}
			return v, nil
		},
	}, true
}

// mapField reads a field from the plain map that carries every runtime
// struct-typed value.
func mapField(target any, fieldName string) (any, bool) {
	m, ok := target.(map[string]any)
	if !ok {
		return nil, false
	}
	v, ok := m[fieldName]
	return v, ok
}

// NewValue implements types.Provider. Schema structs are checking-only types
// and cannot be constructed in expressions.
func (p *provider) NewValue(structType string, fields map[string]ref.Val) ref.Val {
	if _, ok := p.structNode(structType); ok {
		return types.NewErr("schema type %s cannot be constructed", structType)
	}
	return p.base.NewValue(structType, fields)
}
