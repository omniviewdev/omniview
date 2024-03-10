package controllers

import (
	"github.com/omniviewdev/plugin/pkg/resource/services"
	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// NewInformerController creates a new informer controller. An informer controller is an extension of a resource controller
// that adds the ability to dispatch changes to from the backend in real time to the central event bus.
//
// This is useful for resources that are expected to change frequently, and need to be kept up-to-date in real-time. While the
// manager implementation here is designed around the Kubernetes Informer implementation in the kubernetes/client-go package, but
// the concept can be applied to any backend that supports real-time change notifications (such change notifications could include,
// in AWS for example, watching an EventBridge event stream for changes to resources).
func NewInformerController[ClientT, InformerT, NamespaceDT, NamespaceSDT any](
	resourceManager services.ResourceManager[ClientT],
	hookManager services.HookManager,
	namespaceManager services.NamespaceManager[ClientT, NamespaceDT, NamespaceSDT],
	resourceTypeManager services.TypeManager[NamespaceDT, NamespaceSDT],
	informerManager services.InformerManager[ClientT, InformerT, NamespaceDT, NamespaceSDT],
) types.InformerProvider {
	return &informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]{
		resourceController: resourceController[ClientT, NamespaceDT, NamespaceSDT]{
			resourceManager:     resourceManager,
			hookManager:         hookManager,
			namespaceManager:    namespaceManager,
			resourceTypeManager: resourceTypeManager,
		},
		informerManager: informerManager,
	}
}

// concrete implementation of the informer controller.
type informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT any] struct {
	resourceController[ClientT, NamespaceDT, NamespaceSDT]
	informerManager services.InformerManager[ClientT, InformerT, NamespaceDT, NamespaceSDT]
}

func (c *informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) StartInformer(
	resourceID, namespaceID string,
) error {
	panic("not yet implemented")
}

func (c *informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) StopInformer(
	resourceID, namespaceID string,
) error {
	panic("not yet implemented")
}

func (c *informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Subscribe(
	resourceID, namespaceID string,
	actions []types.InformerAction,
) error {
	panic("not yet implemented")
}

func (c *informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Unsubscribe(
	resourceID, namespaceID string,
	actions []types.InformerAction,
) error {
	panic("not yet implemented")
}

func (c *informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) UnsubscribeAll(
	namespaceID string,
) error {
	panic("not yet implemented")
}

func (c *informerController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) GetInformer(
	resourceID, namespaceID string,
) (InformerT, error) {
	panic("not yet implemented")
}
