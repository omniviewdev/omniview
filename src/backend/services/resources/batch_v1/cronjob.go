package batchv1

import (
	"go.uber.org/zap"
	batchv1 "k8s.io/api/batch/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type CronJobService struct {
	resources.NamespacedResourceService[*batchv1.CronJob]
}

// NewCronJobService creates a new instance of CronJobService.
func NewCronJobService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *CronJobService {
	return &CronJobService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*batchv1.CronJob](
			logger,
			batchv1.SchemeGroupVersion.WithResource("cronjobs"),
			publisher,
			stateChan,
		),
	}
}
