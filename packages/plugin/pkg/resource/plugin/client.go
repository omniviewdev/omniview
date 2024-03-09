package plugin

import (
	"net/rpc"

	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// ResourcePluginClient is the real client implementation for ResourcePlugin.
type ResourcePluginClient struct{ client *rpc.Client }

func (r *ResourcePluginClient) RegisterPreGetHook(req types.PreHook[types.GetInput]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPreGetHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPreListHook(req types.PreHook[types.ListInput]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPreListHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPreFindHook(req types.PreHook[types.FindInput]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPreFindHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPreCreateHook(req types.PreHook[types.CreateInput]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPreCreateHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPreUpdateHook(req types.PreHook[types.UpdateInput]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPreUpdateHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPreDeleteHook(req types.PreHook[types.DeleteInput]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPreDeleteHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPostGetHook(req types.PostHook[types.GetResult]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPostGetHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPostListHook(req types.PostHook[types.ListResult]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPostListHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPostFindHook(req types.PostHook[types.FindResult]) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPostFindHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPostCreateHook(
	req types.PostHook[types.CreateResult],
) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPostCreateHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPostUpdateHook(
	req types.PostHook[types.UpdateResult],
) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPostUpdateHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) RegisterPostDeleteHook(
	req types.PostHook[types.DeleteResult],
) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.RegisterPostDeleteHook", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *ResourcePluginClient) Get(
	resourceID string,
	namespaceID string,
	input types.GetInput,
) *types.GetResult {
	resp := types.NewGetResult()
	req := types.ResourceProviderInput[types.GetInput]{
		Input:       input,
		ResourceID:  resourceID,
		NamespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Get", &req, resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) List(
	resourceID string,
	namespaceID string,
	input types.ListInput,
) *types.ListResult {
	resp := types.NewListResult()
	req := types.ResourceProviderInput[types.ListInput]{
		Input:       input,
		ResourceID:  resourceID,
		NamespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.List", &req, resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Find(
	resourceID string,
	namespaceID string,
	input types.FindInput,
) *types.FindResult {
	resp := types.NewFindResult()
	req := types.ResourceProviderInput[types.FindInput]{
		Input:       input,
		ResourceID:  resourceID,
		NamespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Find", &req, resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Create(
	resourceID string,
	namespaceID string,
	input types.CreateInput,
) *types.CreateResult {
	resp := types.NewCreateResult()
	req := types.ResourceProviderInput[types.CreateInput]{
		Input:       input,
		ResourceID:  resourceID,
		NamespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Create", &req, resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Update(
	resourceID string,
	namespaceID string,
	input types.UpdateInput,
) *types.UpdateResult {
	resp := types.NewUpdateResult()
	req := types.ResourceProviderInput[types.UpdateInput]{
		Input:       input,
		ResourceID:  resourceID,
		NamespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Update", &req, resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Delete(
	resourceID string,
	namespaceID string,
	input types.DeleteInput,
) *types.DeleteResult {
	resp := types.NewDeleteResult()
	req := types.ResourceProviderInput[types.DeleteInput]{
		Input:       input,
		ResourceID:  resourceID,
		NamespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Delete", &req, resp); err != nil {
		panic(err)
	}

	return resp
}
