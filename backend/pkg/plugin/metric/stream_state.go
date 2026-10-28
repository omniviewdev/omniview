package metric

import (
 "context"
 "sync"

 resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
 "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// A stream instance fences a single plugin generation. Input channels are never
// closed underneath concurrent senders; done releases them on every terminal path.
type metricStream struct {
 input chan metric.StreamInput
 done chan struct{}
 cancel context.CancelFunc
 once sync.Once
}
func (s *metricStream) stop() { s.once.Do(func(){ close(s.done); s.cancel() }) }

func (c *controller) retireStream(pluginID string, stream *metricStream, failure *resourcev2.ResourceOperationError) []metric.StreamOutput {
 stream.stop()
 c.mux.Lock()
 defer c.mux.Unlock()
 if c.streams[pluginID] == stream {
  delete(c.streams,pluginID)
  c.streamErrors[pluginID]=failure
 }
 var terminal []metric.StreamOutput
 for id, subscription := range c.subscriptions {
  if subscription.stream != stream { continue }
  delete(c.subscriptions,id)
  terminal=append(terminal,metric.StreamOutput{SubscriptionID:id,Error:failure.Message,OperationError:failure})
 }
 return terminal
}
func (c *controller) endStream(pluginID string, stream *metricStream, failure *resourcev2.ResourceOperationError) {
 for _, output := range c.retireStream(pluginID,stream,failure) { c.handleStreamOutput(output) }
}
func closedStreamError() *resourcev2.ResourceOperationError {
 return &resourcev2.ResourceOperationError{Code:"UNAVAILABLE",Message:"The metric stream is no longer available."}
}
