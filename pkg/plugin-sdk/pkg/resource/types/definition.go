package types

import (
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type ResourceDefinition struct {
	IDAccessor          string          `json:"id_accessor"`
	NamespaceAccessor   string          `json:"namespace_accessor"`
	MemoizerAccessor    string          `json:"memoizer_accessor"`
	ColumnDefs          []ColumnDef     `json:"columnDefs"`
	SupportedOperations []OperationType `json:"supportedOperations,omitempty"`
}

type ColorVariant string

const (
	ColorVariantPrimary   ColorVariant = "primary"
	ColorVariantSecondary ColorVariant = "neutral"
	ColorVariantSuccess   ColorVariant = "success"
	ColorVariantWarning   ColorVariant = "warning"
	ColorVariantDanger    ColorVariant = "danger"
)

type CellAlignment string

const (
	CellAlignmentLeft   CellAlignment = "LEFT"
	CellAlignmentCenter CellAlignment = "CENTER"
	CellAlignmentRight  CellAlignment = "RIGHT"
)

func (c CellAlignment) ToProto() *proto.ColumnDef_Alignment {
	switch c {
	case CellAlignmentLeft:
		return proto.ColumnDef_LEFT.Enum()
	case CellAlignmentCenter:
		return proto.ColumnDef_CENTER.Enum()
	case CellAlignmentRight:
		return proto.ColumnDef_RIGHT.Enum()
	}
	return proto.ColumnDef_LEFT.Enum()
}

type CellComponent string

const (
	CellComponentText     CellComponent = "TEXT"
	CellComponentBadges   CellComponent = "BADGES"
	CellComponentStatuses CellComponent = "STATUSES"
)

type CellComponentStatusesParams struct {
	// StatusAccessor
	StatusAccessor string `json:"statusAccessor"`
	// StatusMap
	StatusMap map[string]ColorVariant `json:"statusMap"`
	// HoverMenuComponent is an optional hover menu custom component that can be displayed
	HoverMenuComponent string `json:"hoverMenuComponent"`
}

type CellValueFormatter string

const (
	CellValueFormatterNone     CellValueFormatter = "NONE"
	CellValueFormatterBytes    CellValueFormatter = "BYTES"
	CellValueFormatterDuration CellValueFormatter = "DURATION"
	CellValueFormatterPercent  CellValueFormatter = "PERCENT"
	CellValueFormatterTime     CellValueFormatter = "TIME"
	CellValueFormatterAge      CellValueFormatter = "AGE"
	CellValueFormatterSum      CellValueFormatter = "SUM"
	CellValueFormatterCount    CellValueFormatter = "COUNT"
	CellValueFormatterAvg      CellValueFormatter = "AVG"
	CellValueFormatterMax      CellValueFormatter = "MAX"
	CellValueFormatterMin      CellValueFormatter = "MIN"
)

func (c CellValueFormatter) ToProto() *proto.ColumnDef_Formatter {
	switch c {
	case CellValueFormatterNone:
		return proto.ColumnDef_NONE.Enum()
	case CellValueFormatterBytes:
		return proto.ColumnDef_BYTES.Enum()
	case CellValueFormatterDuration:
		return proto.ColumnDef_DURATION.Enum()
	case CellValueFormatterPercent:
		return proto.ColumnDef_PERCENT.Enum()
	case CellValueFormatterTime:
		return proto.ColumnDef_TIME.Enum()
	case CellValueFormatterAge:
		return proto.ColumnDef_AGE.Enum()
	case CellValueFormatterSum:
		return proto.ColumnDef_SUM.Enum()
	case CellValueFormatterCount:
		return proto.ColumnDef_COUNT.Enum()
	case CellValueFormatterAvg:
		return proto.ColumnDef_AVG.Enum()
	case CellValueFormatterMax:
		return proto.ColumnDef_MAX.Enum()
	case CellValueFormatterMin:
		return proto.ColumnDef_MIN.Enum()
	}
	return proto.ColumnDef_NONE.Enum()
}

type CellAccessorPriority string

const (
	CellAccessorPriorityAll   CellAccessorPriority = "ALL"
	CellAccessorPriorityFirst CellAccessorPriority = "FIRST"
	CellAccessorPriorityLast  CellAccessorPriority = "LAST"
)

func CellAccessorPriorityFromProto(c proto.ColumnDef_AccessorPriority) CellAccessorPriority {
	switch c {
	case proto.ColumnDef_ALL:
		return CellAccessorPriorityAll
	case proto.ColumnDef_FIRST:
		return CellAccessorPriorityFirst
	case proto.ColumnDef_LAST:
		return CellAccessorPriorityLast
	}
	return CellAccessorPriorityAll
}

func (c CellAccessorPriority) ToProto() *proto.ColumnDef_AccessorPriority {
	switch c {
	case CellAccessorPriorityAll:
		return proto.ColumnDef_ALL.Enum()
	case CellAccessorPriorityFirst:
		return proto.ColumnDef_FIRST.Enum()
	case CellAccessorPriorityLast:
		return proto.ColumnDef_LAST.Enum()
	}
	return proto.ColumnDef_ALL.Enum()
}

type ColumnDef struct {
	// ID defines the ID for the column
	ID string `json:"id"`
	// Header defines the header for the column
	Header string `json:"header"`
	// Accessors defines the accessors for the column. If multiple values must be
	// displayed, they must be separated by a comma
	Accessors string `json:"accessor"`
	// AccessorPriority defines which value to return if multiple accessors are given, and there are multiple matches. If none is provided,
	// all values will be returned as an array.
	AccessorPriority CellAccessorPriority `json:"accessorPriority,omitempty"`
	// Map defines the map for the cell contents to a color variant based on a value
	ColorMap map[string]string `json:"colorMap,omitempty"`
	// Color defines the color for the cell contents
	Color ColorVariant `json:"color,omitempty"`
	// Align defines the alignment for the column
	// Default: left
	Alignment CellAlignment `json:"align,omitempty"`
	// Hidden defines whether the column is visible or not
	Hidden bool `json:"hidden,omitempty"`
	// Width defines the width for the column. If not provided, the column will
	// be auto-sized.
	Width int `json:"width,omitempty"`
	// Formatter defines an optional value formatter to use for the column
	Formatter CellValueFormatter `json:"formatter,omitempty"`
	// Component defines an optional component to use for the cell. You can use one
	// of the preset components or define your own.
	//
	// If not provided, the default 'text' component will be used.
	Component string `json:"component,omitempty"`
	// Component Params are used to pass additional parameters to the component
	ComponentParams interface{} `json:"componentParams,omitempty"`
	// ResourceLinks are used to create links to other resources.
	ResourceLink *ResourceLink `json:"resourceLink,omitempty"`
	// ValueMap is used to map a value to another value. The key should be a regular expression
	// to run against the value to check if should be replaced by a static value.
	//
	// NOTE: Use this sparingly as it can be expensive to run regular expressions on every cell.
	ValueMap map[string]string `json:"valueMap,omitempty"`
}

func (c ColumnDef) ToProto() *proto.ColumnDef {
	componentParams, _ := utils.ConvertInterfaceToAny(c.ComponentParams)

	return &proto.ColumnDef{
		Id:               c.ID,
		Header:           c.Header,
		Accessors:        c.Accessors,
		ColorMap:         c.ColorMap,
		Color:            string(c.Color),
		Alignment:        *c.Alignment.ToProto(),
		Hidden:           c.Hidden,
		Width:            int32(c.Width),
		Formatter:        *c.Formatter.ToProto(),
		Component:        c.Component,
		ComponentParams:  componentParams,
		ResourceLink:     c.ResourceLink.ToProto(),
		AccessorPriority: *c.AccessorPriority.ToProto(),
		ValueMap:         c.ValueMap,
	}
}

func ColumnDefFromProto(c *proto.ColumnDef) ColumnDef {
	componentParams, _ := utils.ConvertAnyToInterface(c.GetComponentParams())

	return ColumnDef{
		ID:               c.GetId(),
		Header:           c.GetHeader(),
		Accessors:        c.GetAccessors(),
		ColorMap:         c.GetColorMap(),
		Color:            ColorVariant(c.GetColor()),
		Alignment:        CellAlignment(c.GetAlignment().String()),
		Hidden:           c.GetHidden(),
		Width:            int(c.GetWidth()),
		Formatter:        CellValueFormatter(c.GetFormatter().String()),
		Component:        c.GetComponent(),
		ComponentParams:  componentParams,
		ResourceLink:     ResourceLinkFromProto(c.GetResourceLink()),
		AccessorPriority: CellAccessorPriorityFromProto(c.GetAccessorPriority()),
		ValueMap:         c.GetValueMap(),
	}
}

// ResourceLink is used to create links to other resources.
type ResourceLink struct {
	// Accessor to extract the ID of the linked resource.
	IDAccessor string `json:"idAccessor"`
	// NamespaceAccessor is the accessor for determining which resource namespace the resource is in.
	// If not specified, defaults to the same namespace (if the backend supports it)
	NamespaceAccessor string `json:"namespaceAccessor"`
	// Namespaced is used to determine if the resource is namespaced or not. If not specified, defaults to true.
	Namespaced bool `json:"namespaced"`
	// Key can be supplied if the key is already known ahead of time, and doesn't need to derived from an accessor
	Key string `json:"resourceKey"`
	// KeyAccessor is the accessor for determining the key of the resource.
	KeyAccessor string `json:"keyAccessor"`
	// KeyMap is an optional map that can be used with the key accessor to determine the resource
	// ID based on what is returned from the accessor
	KeyMap map[string]string `json:"keyMap"`
	// DetailExtractors is an optional map of accessors that can extract information about a resource link
	// into a popout modal. Each key should be a direct object accessor or a jsonpath expression.
	DetailExtractors map[string]string `json:"detailExtractors"`
	// DisplayID will display the ID instead of the kind if enabled
	DisplayID bool `json:"displayId"`
}

func (rl *ResourceLink) ToProto() *proto.ResourceLink {
	if rl == nil {
		return nil
	}

	return &proto.ResourceLink{
		IdAccessor:        rl.IDAccessor,
		NamespaceAccessor: rl.NamespaceAccessor,
		Key:               rl.Key,
		KeyAccessor:       rl.KeyAccessor,
		KeyMap:            rl.KeyMap,
		DetailExtractors:  rl.DetailExtractors,
		Namespaced:        rl.Namespaced,
		DisplayId:         rl.DisplayID,
	}
}

func ResourceLinkFromProto(rl *proto.ResourceLink) *ResourceLink {
	if rl == nil {
		return nil
	}

	return &ResourceLink{
		IDAccessor:        rl.GetIdAccessor(),
		NamespaceAccessor: rl.GetNamespaceAccessor(),
		Key:               rl.GetKey(),
		KeyAccessor:       rl.GetKeyAccessor(),
		KeyMap:            rl.GetKeyMap(),
		DetailExtractors:  rl.GetDetailExtractors(),
		Namespaced:        rl.GetNamespaced(),
		DisplayID:         rl.GetDisplayId(),
	}
}
