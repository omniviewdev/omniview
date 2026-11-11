package indexer

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync/atomic"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

const defaultBufferSize = 10_000

type Dispatcher struct {
	indexers []ResourceIndexer
	events   chan Event
	done     chan struct{}
	stopping chan struct{}
	stopped  atomic.Bool
	logger   logging.Logger
}

func NewDispatcher(indexers []ResourceIndexer) *Dispatcher {
	return &Dispatcher{
		indexers: indexers,
		events:   make(chan Event, defaultBufferSize),
		done:     make(chan struct{}),
		stopping: make(chan struct{}),
		stopped:  atomic.Bool{},
		logger:   logging.Default().Named("IndexerDispatcher"),
	}
}

// WithLogger sets the dispatcher logger. A nil logger is ignored. Call before Start.
func (d *Dispatcher) WithLogger(logger logging.Logger) *Dispatcher {
	if logger != nil {
		d.logger = logger
	}
	return d
}

func (d *Dispatcher) Start() {
	go d.loop()
}

func (d *Dispatcher) Stop() {
	if !d.stopped.CompareAndSwap(false, true) {
		<-d.done
		return
	}
	close(d.stopping)
	close(d.events)
	<-d.done
}

func (d *Dispatcher) Enqueue(event Event) {
	d.safeSend(event)
}

// Flush blocks until all previously-enqueued events have been processed.
// Useful for deterministic testing without time.Sleep.
func (d *Dispatcher) Flush() {
	barrier := make(chan struct{})
	var noEntry registry.ResourceEntry
	if !d.safeSend(Event{Type: eventFlush, Entry: noEntry, Old: nil, Raw: nil, flush: barrier}) {
		return
	}
	<-barrier
}

// safeSend attempts to send an event on the events channel. Returns false if
// the dispatcher is stopping. Uses recover to handle the narrow race where
// Stop() closes the events channel between select evaluation and send.
func (d *Dispatcher) safeSend(event Event) (sent bool) {
	defer func() {
		if recover() != nil {
			sent = false
		}
	}()
	select {
	case <-d.stopping:
		return false
	case d.events <- event:
		return true
	}
}

func (d *Dispatcher) loop() {
	defer close(d.done)
	for event := range d.events {
		if event.Type == eventFlush {
			close(event.flush)
			continue
		}
		for _, idx := range d.indexers {
			d.dispatch(idx, event)
		}
	}
}

func (d *Dispatcher) dispatch(idx ResourceIndexer, event Event) {
	defer func() {
		if r := recover(); r != nil {
			// Log the panic value's type only: it can embed resource data.
			d.logger.Errorw(context.Background(), "indexer panicked",
				"indexer", idx.Name(),
				"method", dispatchMethod(event.Type),
				"panicType", fmt.Sprintf("%T", r),
				"stack", string(debug.Stack()),
			)
		}
	}()

	switch event.Type {
	case EventAdd:
		idx.OnAdd(event.Entry, event.Raw)
	case EventUpdate:
		if event.Old != nil {
			idx.OnUpdate(*event.Old, event.Entry, event.Raw)
		} else {
			idx.OnAdd(event.Entry, event.Raw)
		}
	case EventDelete:
		idx.OnDelete(event.Entry)
	case eventFlush:
		// Flush barriers are consumed by loop and never dispatched.
		fallthrough
	default:
		d.logger.Warnw(context.Background(), "indexer dispatcher: unknown event type", "eventType", int(event.Type))
	}
}

func dispatchMethod(t EventType) string {
	switch t {
	case EventAdd:
		return "OnAdd"
	case EventUpdate:
		return "OnUpdate"
	case EventDelete:
		return "OnDelete"
	case eventFlush:
		return "unknown"
	default:
		return "unknown"
	}
}
