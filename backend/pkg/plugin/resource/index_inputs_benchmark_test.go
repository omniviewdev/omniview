package resource

import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// BenchmarkIndexInputs exercises the current native observation ingress, not the
// retired v1 sink. Each operation updates one complete population and drains the
// production dispatcher before checking independently expected relationships.
func BenchmarkIndexInputs(b *testing.B) {
	for _, count := range []int{300, 3000} {
		for _, workload := range []string{"status", "label", "owner", "recreate"} {
			b.Run(fmt.Sprintf("%d/%s", count, workload), func(b *testing.B) {
				ctrl, g, dispatcher := newGraphPipeline(b)
				route := resourcev2.AccessRoute{Connection: "route/one"}
				setPipelineDeclarations(b, ctrl, g, "plugin-a", route, "workload", []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelOwns, TargetType: "machine", Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "metadata.ownerReferences.0.name"}}})
				records := make([]resourcev2.Record, count)
				for i := range records {
					_, records[i] = graphPipelineRecord(b, ctrl, "workload", fmt.Sprint(i), `{"metadata":{"ownerReferences":[{"name":"parent-0"}]},"status":0}`)
					require.NoError(b, ctrl.observeValidatedSourceRecord(testInvocationContext(), "plugin-a", ctrl.plugins["plugin-a"], route, records[i], &resourcev2.ResourceMetadata{Labels: map[string]string{"app": "zero"}}))
				}
				dispatcher.Flush()
				g.TakeChanged()
				// Read only queue length; do not replace production queue behavior.
				queue := reflect.ValueOf(dispatcher).Elem().FieldByName("events")
				maxQueue, changedBatches := 0, 0
				var enqueueTime, drainTime time.Duration
				b.ReportAllocs()
				b.ResetTimer()
				for n := range b.N {
					owner := "parent-0"
					if workload == "owner" {
						owner = fmt.Sprintf("parent-%d", (n+1)%2)
					}
					body, err := resourcev2.JSONToValue([]byte(fmt.Sprintf(`{"metadata":{"ownerReferences":[{"name":%q}]},"status":%d}`, owner, n+1)))
					require.NoError(b, err)
					label := "zero"
					if workload == "label" {
						label = fmt.Sprint(n % 2)
					}
					enqueuing := time.Now()
					for i := range records {
						if workload == "recreate" {
							deleteGraphRecord(ctrl, route, records[i].Reference)
						}
						records[i].Body = body
						require.NoError(b, ctrl.observeValidatedSourceRecord(testInvocationContext(), "plugin-a", ctrl.plugins["plugin-a"], route, records[i], &resourcev2.ResourceMetadata{Labels: map[string]string{"app": label}}))
						maxQueue = max(maxQueue, queue.Len())
					}
					enqueueTime += time.Since(enqueuing)
					draining := time.Now()
					dispatcher.Flush()
					drainTime += time.Since(draining)
					b.StopTimer()
					if len(g.TakeChanged()) != 0 {
						changedBatches++
					}
					for _, record := range records {
						edges := g.EdgesFrom((graph.GraphNode{PluginID: "plugin-a", Reference: record.Reference, Route: route}).Key())
						require.Len(b, edges, 1)
						require.Equal(b, owner, edges[0].Target.Reference.Address.ID)
					}
					b.StartTimer()
				}
				b.StopTimer()
				b.ReportMetric(float64(count), "objects/op")
				b.ReportMetric(float64(maxQueue), "queue-peak")
				b.ReportMetric(float64(enqueueTime.Nanoseconds())/float64(b.N), "enqueue-ns/op")
				b.ReportMetric(float64(drainTime.Nanoseconds())/float64(b.N), "drain-ns/op")
				b.ReportMetric(float64(changedBatches)/float64(b.N), "changed-batches/op")
			})
		}
	}
}
