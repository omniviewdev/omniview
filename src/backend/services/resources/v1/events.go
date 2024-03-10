package resources

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
)

type EventsService struct {
	resources.NamespacedResourceService[*corev1.Event]
}

// NewEventsService creates a new instance of EventsService.
func NewEventsService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *EventsService {
	return &EventsService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Event](
			logger,
			corev1.SchemeGroupVersion.WithResource("events"),
			publisher,
			stateChan,
		),
	}
}
