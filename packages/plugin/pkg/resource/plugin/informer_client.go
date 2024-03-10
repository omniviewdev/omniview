package plugin

import (
	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// InformerPluginClient is the real client implementation for ResourcePlugin.
type InformerPluginClient struct {
	ResourcePluginClient
}

func (r *InformerPluginClient) StartInformer(resourceID, namespaceID string) error {
	resp := struct{}{}
	req := struct {
		ResourceID  string
		NamespaceID string
	}{resourceID, namespaceID}

	if err := r.client.Call("Plugin.StartInformer", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *InformerPluginClient) StopInformer(resourceID, namespaceID string) error {
	resp := struct{}{}
	req := struct {
		ResourceID  string
		NamespaceID string
	}{resourceID, namespaceID}
	if err := r.client.Call("Plugin.StopInformer", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *InformerPluginClient) Subscribe(
	resourceID, namespaceID string,
	actions []types.InformerAction,
) error {
	resp := struct{}{}
	req := struct {
		ResourceID  string
		NamespaceID string
		Actions     []types.InformerAction
	}{resourceID, namespaceID, actions}
	if err := r.client.Call("Plugin.Subscribe", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *InformerPluginClient) Unsubscribe(
	resourceID, namespaceID string,
	actions []types.InformerAction,
) error {
	resp := struct{}{}
	req := struct {
		ResourceID  string
		NamespaceID string
		Actions     []types.InformerAction
	}{resourceID, namespaceID, actions}
	if err := r.client.Call("Plugin.Unsubscribe", &req, &resp); err != nil {
		panic(err)
	}
	return nil
}

func (r *InformerPluginClient) UnsubscribeAll(namespaceID string) error {
	resp := struct{}{}
	if err := r.client.Call("Plugin.UnsubscribeAll", &namespaceID, &resp); err != nil {
		panic(err)
	}
	return nil
}
