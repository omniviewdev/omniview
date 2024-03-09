package networkingv1

import (
	"go.uber.org/zap"
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type IngressClassService struct {
	resources.NamespacedResourceService[*networkingv1.IngressClass]
}

// NewIngressClassService creates a new instance of IngressClassService.
func NewIngressClassService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *IngressClassService {
	return &IngressClassService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*networkingv1.IngressClass](
			logger,
			networkingv1.SchemeGroupVersion.WithResource("ingressclasses"),
			publisher,
			stateChan,
		),
	}
}
