package autoscalingv2

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
)

type HorizontalPodAutoscalerService struct {
	resources.NamespacedResourceService[*autoscalingv2.HorizontalPodAutoscaler]
}

// NewHorizontalPodAutoscalerService creates a new instance of HorizontalPodAutoscalerService.
func NewHorizontalPodAutoscalerService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *HorizontalPodAutoscalerService {
	return &HorizontalPodAutoscalerService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*autoscalingv2.HorizontalPodAutoscaler](
			logger,
			autoscalingv2.SchemeGroupVersion.WithResource("horizontalpodautoscalers"),
			publisher,
			stateChan,
		),
	}
}
