package indexer

import (
	"log"
	"sync/atomic"
)

const defaultBufferSize = 10_000

type Dispatcher struct {
	indexers []ResourceIndexer
	events   chan Event
	done     chan struct{}
	stopping chan struct{}
	stopped  atomic.Bool
}

func NewDispatcher(indexers []ResourceIndexer) *Dispatcher {
	return &Dispatcher{
		indexers: indexers,
		events:   make(chan Event, defaultBufferSize),
		done:     make(chan struct{}),
		stopping: make(chan struct{}),
	}
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
	select {
	case <-d.stopping:
		return
	case d.events <- event:
	}
}

// Flush blocks until all previously-enqueued events have been processed.
// Useful for deterministic testing without time.Sleep.
func (d *Dispatcher) Flush() {
	barrier := make(chan struct{})
	select {
	case <-d.stopping:
		return
	case d.events <- Event{Type: eventFlush, flush: barrier}:
	}
	<-barrier
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
			log.Printf("indexer %q panicked on %v event: %v", idx.Name(), event.Type, r)
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
	default:
		log.Printf("indexer dispatcher: unknown event type %d", event.Type)
	}
}
