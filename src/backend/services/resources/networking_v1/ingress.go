package networkingv1

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	networkingv1 "k8s.io/api/networking/v1"
)

type IngressService struct {
	resources.NamespacedResourceService[*networkingv1.Ingress]
}

// NewIngressService creates a new instance of IngressService.
func NewIngressService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *IngressService {
	return &IngressService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*networkingv1.Ingress](
			logger,
			networkingv1.SchemeGroupVersion.WithResource("ingresses"),
			publisher,
			stateChan,
		),
	}
}
