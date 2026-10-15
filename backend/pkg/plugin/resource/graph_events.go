package resource

import (
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
)

// graphChangeDebounce is how long graph changes are collected before the
// frontend is told, so a burst of watch events becomes one event per
// connection.
const graphChangeDebounce = time.Second

// GraphChangedEventKey is the event emitted when edges touching a connection
// change. The payload is {"pluginId": ..., "connectionId": ...}.
func GraphChangedEventKey(pluginID, connectionID string) string {
	return pluginID + "/" + connectionID + "/graph/CHANGED"
}

// graphChangeNotifier forwards relationship graph changes to the frontend,
// at most once per debounce interval per connection.
type graphChangeNotifier struct {
	graph    *graph.RelationshipGraph
	emit     func(eventKey string, data ...any)
	debounce time.Duration

	startOnce sync.Once
	stopOnce  sync.Once
	started   bool
	stop      chan struct{}
	done      chan struct{}
}

func newGraphChangeNotifier(
	g *graph.RelationshipGraph,
	emit func(eventKey string, data ...any),
	debounce time.Duration,
) *graphChangeNotifier {
	return &graphChangeNotifier{
		graph:     g,
		emit:      emit,
		debounce:  debounce,
		startOnce: sync.Once{},
		stopOnce:  sync.Once{},
		started:   false,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

// Start begins forwarding. Later calls do nothing; a nil notifier is a no-op.
func (n *graphChangeNotifier) Start() {
	if n == nil {
		return
	}
	n.startOnce.Do(func() {
		n.started = true
		go n.run()
	})
}

// Stop stops forwarding and waits for the loop to exit. Pending changes are
// dropped. Safe to call more than once, before Start, and on nil.
func (n *graphChangeNotifier) Stop() {
	if n == nil {
		return
	}
	n.stopOnce.Do(func() {
		// Prevent a later Start from launching the loop.
		n.startOnce.Do(func() {})
		close(n.stop)
		if n.started {
			<-n.done
		}
	})
}

func (n *graphChangeNotifier) run() {
	defer close(n.done)
	for {
		select {
		case <-n.stop:
			return
		case <-n.graph.Changed():
		}

		// Let the burst settle, then report every connection it touched.
		timer := time.NewTimer(n.debounce)
		select {
		case <-n.stop:
			timer.Stop()
			return
		case <-timer.C:
		}

		for _, ref := range n.graph.TakeChanged() {
			n.emit(GraphChangedEventKey(ref.PluginID, ref.ConnectionID), map[string]string{
				"pluginId":     ref.PluginID,
				"connectionId": ref.ConnectionID,
			})
		}
	}
}
