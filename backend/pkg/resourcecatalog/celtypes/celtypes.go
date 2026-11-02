// Package celtypes adapts the host schema catalog to CEL (spec §8,
// mapping omniview.schema-cel.v1). Checking types come from a per-document
// types.Provider; runtime values stay plain CEL maps and lists, so no
// per-value schema object is ever created.
package celtypes

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/types"
	"cel.dev/cel-go/common/types/ref"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// MappingVersion names the normalized-node to CEL type mapping.
const MappingVersion = "omniview.schema-cel.v1"

const (
	codeInvalidRequest = "INVALID_REQUEST"
	resourceVariable   = "resource"
)

// Environment is the CEL declaration set of one resolved representation.
type Environment struct {
	Options []cel.EnvOption
	// ContentKey identifies the declarations by content. It may key
	// host-internal cel.Env reuse and nothing else.
	ContentKey string
	// Revision is the checking/authoring identity; it changes with the
	// snapshot, representation or schema revision even for identical bytes.
	Revision string
}

// NewEnvironment returns the CEL declarations for one catalog entry. A nil
// schema (absent binding) declares resource as dyn.
func NewEnvironment(snapshotRevision string, entry *resourcecatalog.Entry, schema *resourcecatalog.Schema) (*Environment, error) {
	if entry == nil {
		return nil, resourcev2.NewError(codeInvalidRequest, "catalog entry is required")
	}
	if schema == nil {
		contentKey := hexDigest(resourcecatalog.PolicyVersion + MappingVersion + "dyn")
		return &Environment{
			Options:    []cel.EnvOption{cel.Variable(resourceVariable, cel.DynType)},
			ContentKey: contentKey,
			Revision:   revision(contentKey, snapshotRevision, entry.RepresentationRevision, ""),
		}, nil
	}
	if schema.Document == nil || int(schema.Root) <= 0 || int(schema.Root) >= len(schema.Document.Nodes) {
		return nil, resourcev2.NewError(codeInvalidRequest, "schema root does not resolve")
	}
	built, err := schema.Document.LoadCELProvider(func() (any, error) { return newProvider(schema.Document), nil })
	if err != nil {
		return nil, err
	}
	p := built.(*provider)
	rootPointer := schema.Document.Nodes[schema.Root].Pointer
	contentKey := hexDigest(resourcecatalog.PolicyVersion + MappingVersion + hex.EncodeToString(schema.Document.Digest[:]) + rootPointer)
	return &Environment{
		Options: []cel.EnvOption{
			cel.CustomTypeProvider(p),
			cel.Variable(resourceVariable, p.typeOf(schema.Root)),
		},
		ContentKey: contentKey,
		Revision:   revision(contentKey, snapshotRevision, entry.RepresentationRevision, schema.SchemaRevision),
	}, nil
}

func revision(contentKey, snapshotRevision, representationRevision, schemaRevision string) string {
	return hexDigest(contentKey + "\x00" + snapshotRevision + "\x00" + representationRevision + "\x00" + schemaRevision)
}

func hexDigest(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// ToCEL converts a tagged resource value to a CEL value through
// types.DefaultTypeAdapter. Maps stay plain CEL maps at every depth.
func ToCEL(v resourcev2.Value) (ref.Val, error) {
	native, err := toNative(v, "")
	if err != nil {
		return nil, err
	}
	return types.DefaultTypeAdapter.NativeToValue(native), nil
}

func toNative(v resourcev2.Value, pointer string) (any, error) {
	switch v.Kind {
	case "null":
		return types.NullValue, nil
	case "bool":
		return v.Bool, nil
	case "string":
		return v.String, nil
	case "int64":
		n, err := strconv.ParseInt(v.Int, 10, 64)
		if err != nil {
			return nil, invalidValue(pointer, "invalid int64 value")
		}
		return n, nil
	case "uint64":
		n, err := strconv.ParseUint(v.Uint, 10, 64)
		if err != nil {
			return nil, invalidValue(pointer, "invalid uint64 value")
		}
		return n, nil
	case "double":
		return v.Double, nil
	case "timestamp":
		t, err := time.Parse(time.RFC3339Nano, v.Timestamp)
		if err != nil {
			return nil, invalidValue(pointer, "invalid timestamp value")
		}
		return t, nil
	case "list":
		out := make([]any, len(v.List))
		for i := range v.List {
			item, err := toNative(v.List[i], pointer+"/"+strconv.Itoa(i))
			if err != nil {
				return nil, err
			}
			out[i] = item
		}
		return out, nil
	case "map":
		out := make(map[string]any, len(v.Map))
		for k, item := range v.Map {
			converted, err := toNative(item, pointer+"/"+escapePointerToken(k))
			if err != nil {
				return nil, err
			}
			out[k] = converted
		}
		return out, nil
	default:
		return nil, invalidValue(pointer, "unknown value kind "+strconv.Quote(v.Kind))
	}
}

func invalidValue(pointer, message string) error {
	return resourcev2.NewError(codeInvalidRequest, message+" at pointer '"+pointer+"'")
}

var pointerEscaper = strings.NewReplacer("~", "~0", "/", "~1")

func escapePointerToken(token string) string { return pointerEscaper.Replace(token) }
