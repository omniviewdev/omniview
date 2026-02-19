package types

import (
	"fmt"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type ActionVariant string

const (
	ActionVariantExec   ActionVariant = "exec"
	ActionVariantLogs   ActionVariant = "logs"
	ActionVariantCustom ActionVariant = "custom"
)

func (a ActionVariant) String() string {
	return string(a)
}

func (a ActionVariant) ToProto() proto.ResourceAction_Variant {
	return proto.ResourceAction_Variant(proto.ResourceAction_Variant_value[a.String()])
}

// Action represents an action item that can be performed on a resource.
type Action struct {
	// Selectors are used to pass parameters to the action. If the ListBuilder
	// is provided, these will be merged with the list actions, with the list
	// action selectors taking precedence.
	Selectors map[string]string `json:"selectors"`
	// If the action can have multiple targets, this should be provided to signal
	// to the ui to build a submenu for the action.
	//
	// An example of this could be executing a command on a Kubernetes pod, where
	// the action needs to know which container (target) to execute the command on.
	TargetBuilder []ActionTargetBuilder `json:"target_builders"`
	ID            string                `json:"id"`
	Icon          string                `json:"icon"`
	Label         string                `json:"label"`
	Description   string                `json:"description"`
	Variant       ActionVariant         `json:"variant"`
	Targets       []ActionTarget        `json:"targets"`
}

func (a Action) String() string {
	return a.Label
}

func (a Action) ToProto() *proto.ResourceAction {
	targets := make([]*proto.ResourceActionTarget, 0, len(a.Targets))
	for _, t := range a.Targets {
		targets = append(targets, t.ToProto())
	}

	builders := make([]*proto.ResourceActionTargetBuilder, 0, len(a.TargetBuilder))
	for _, b := range a.TargetBuilder {
		builders = append(builders, b.ToProto())
	}

	return &proto.ResourceAction{
		Id:             a.ID,
		Label:          a.Label,
		Description:    a.Description,
		Icon:           a.Icon,
		Variant:        a.Variant.ToProto(),
		Selectors:      a.Selectors,
		Targets:        targets,
		TargetBuilders: builders,
	}
}

func ActionFromProto(p *proto.ResourceAction) Action {
	if p == nil {
		return Action{}
	}
	targets := make([]ActionTarget, 0, len(p.GetTargets()))
	for _, t := range p.GetTargets() {
		targets = append(targets, ActionTargetFromProto(t))
	}
	builders := make([]ActionTargetBuilder, 0, len(p.GetTargetBuilders()))
	for _, b := range p.GetTargetBuilders() {
		builders = append(builders, ActionTargetBuilderFromProto(b))
	}
	return Action{
		ID:            p.GetId(),
		Label:         p.GetLabel(),
		Description:   p.GetDescription(),
		Icon:          p.GetIcon(),
		Variant:       ActionVariant(p.GetVariant().String()),
		Selectors:     p.GetSelectors(),
		Targets:       targets,
		TargetBuilder: builders,
	}
}

// ActionTargetBuilder is used to build a list of targets for an action. This is
// used when an action can be performed on multiple targets, and the targets
// need to be built dynamically.
type ActionTargetBuilder struct {
	// Selectors are json path selectors to use on each item returned by Paths
	// to get the parameters required for executing the action. Selectors
	// should return a single string value.
	//
	// The selectors will be passed to the action via the parameters map.
	Selectors map[string]string `json:"selectors"`

	// LabelSelector represents which of the selectors should be used for the label
	// displayed for the action. Overrides the static Label parameter if provided.
	LabelSelector string `json:"label_selector"`

	// Label respresents a static label for the action. If the label should be determined
	// based on information about the target, use the LabelSelector instead.
	Label string `json:"label"`

	// Paths represents a json path selector to build the list of targets.
	Paths []string `json:"paths"`
}

func (a ActionTargetBuilder) String() string {
	return a.Label
}

func (a ActionTargetBuilder) ToProto() *proto.ResourceActionTargetBuilder {
	return &proto.ResourceActionTargetBuilder{
		Label:         a.Label,
		LabelSelector: a.LabelSelector,
		Paths:         a.Paths,
		Selectors:     a.Selectors,
	}
}

func ActionTargetBuilderFromProto(p *proto.ResourceActionTargetBuilder) ActionTargetBuilder {
	if p == nil {
		return ActionTargetBuilder{}
	}
	return ActionTargetBuilder{
		Label:         p.GetLabel(),
		LabelSelector: p.GetLabelSelector(),
		Paths:         p.GetPaths(),
		Selectors:     p.GetSelectors(),
	}
}

// ActionTarget represents static target for an action. This is used when an action
// can be performed on multiple targets, and the targets are known ahead of time, such
// as a reporting plugin that can perform multiple kinds of reports on a single
// resource.
type ActionTarget struct {
	// Selectors are used to pass parameters to the action.
	// +optional
	Selectors map[string]string `json:"selectors"`
	// Label is the human-readable name of the target
	Label string `json:"label"`
	// Description is a short description of the target
	// +optional
	Description string `json:"description"`
	// Icon is the icon to display for the target
	// +optional
	Icon string `json:"icon"`
}

func (a ActionTarget) String() string {
	return a.Label
}

func (a ActionTarget) ToProto() *proto.ResourceActionTarget {
	return &proto.ResourceActionTarget{
		Label:       a.Label,
		Icon:        a.Icon,
		Description: a.Description,
		Selectors:   a.Selectors,
	}
}

func ActionTargetFromProto(p *proto.ResourceActionTarget) ActionTarget {
	if p == nil {
		return ActionTarget{}
	}
	return ActionTarget{
		Label:       p.GetLabel(),
		Icon:        p.GetIcon(),
		Description: p.GetDescription(),
		Selectors:   p.GetSelectors(),
	}
}

// ==================== Resource Action Descriptors ==================== //

// ActionScope defines whether an action operates on a specific resource instance
// or on the resource type as a whole.
type ActionScope string

const (
	ActionScopeInstance ActionScope = "instance"
	ActionScopeType    ActionScope = "type"
)

// ActionDescriptor describes an available action on a resource type.
type ActionDescriptor struct {
	ID          string      `json:"id"`
	Label       string      `json:"label"`
	Description string      `json:"description"`
	Icon        string      `json:"icon"`
	Scope       ActionScope `json:"scope"`
	Streaming   bool        `json:"streaming"`
}

// ActionInput contains the parameters for executing an action.
type ActionInput struct {
	ID        string                 `json:"id"`
	Namespace string                 `json:"namespace"`
	Params    map[string]interface{} `json:"params"`
}

// ActionResult contains the result of executing an action.
type ActionResult struct {
	Success bool                   `json:"success"`
	Data    map[string]interface{} `json:"data"`
	Message string                 `json:"message"`
}

// ActionEvent represents a streaming event from a long-running action.
type ActionEvent struct {
	Type string                 `json:"type"` // "progress", "output", "error", "complete"
	Data map[string]interface{} `json:"data"`
}

// ActionResourcer is an optional interface that Resourcer implementations can
// satisfy to support custom actions beyond CRUD. The resourceController will
// type-assert to this interface when dispatching action requests.
type ActionResourcer[ClientT any] interface {
	GetActions(ctx *pkgtypes.PluginContext, client *ClientT, meta ResourceMeta) ([]ActionDescriptor, error)
	ExecuteAction(ctx *pkgtypes.PluginContext, client *ClientT, meta ResourceMeta, actionID string, input ActionInput) (*ActionResult, error)
	StreamAction(ctx *pkgtypes.PluginContext, client *ClientT, meta ResourceMeta, actionID string, input ActionInput, stream chan ActionEvent) error
}

// NoOpActionProvider provides a default no-op implementation of
// ResourceActionProvider for plugins that don't support actions.
type NoOpActionProvider struct{}

func (n NoOpActionProvider) GetActions(_ *pkgtypes.PluginContext, _ string) ([]ActionDescriptor, error) {
	return nil, nil
}

func (n NoOpActionProvider) ExecuteAction(_ *pkgtypes.PluginContext, _ string, _ string, _ ActionInput) (*ActionResult, error) {
	return nil, fmt.Errorf("actions not supported")
}

func (n NoOpActionProvider) StreamAction(_ *pkgtypes.PluginContext, _ string, _ string, _ ActionInput, _ chan ActionEvent) error {
	return fmt.Errorf("streaming actions not supported")
}
