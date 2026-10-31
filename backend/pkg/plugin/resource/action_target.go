package resource

import (
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func actionTarget(pluginID string, request resourcev2.ActionRequest) invocation.Target {
	var target invocation.Target
	if request.TypeTarget != nil {
		value := request.TypeTarget
		target = readTarget(pluginID, resourcev2.ReadTarget{Route: request.Route, Provider: value.Provider, Authority: value.Authority, Type: value.Type, Scope: value.Scope})
	} else {
		target = referenceTarget(pluginID, request.Route, request.Reference)
	}
	target.Action = request.Action
	return target
}
func actionIdentity(request resourcev2.ActionRequest) (string, string) {
	if request.TypeTarget != nil {
		return request.TypeTarget.Authority, request.TypeTarget.Provider
	}
	return request.Reference.Address.Authority, request.Reference.Address.Provider
}
