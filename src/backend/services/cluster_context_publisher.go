package services

import (
	"sync"

	"go.uber.org/zap"
)

type ClusterContextEventAction int

const (
	// AddClusterContext signifies to all the subscriptions to add a new cluster context
	// Resource services should create new informers and clients for the particular cluster context.
	AddClusterContext ClusterContextEventAction = iota
	// StartClusterContext signifies to all the subscription to start an existing cluster context
	// Resources services should start their informers and clients for the particular
	// cluster context.
	StartClusterContext
	// StopClusterContext signifies to all the subscriptions to stop an existing cluster context
	// Resources services should stop their informers and clients for the particular
	// cluster context.
	StopClusterContext
	// RemoveClusterContext signifies to all the subscriptions to remove an existing cluster context
	// Resource services should remove their informers and clients for the particular cluster context.
	RemoveClusterContext
)

func (c ClusterContextEventAction) String() string {
	return [...]string{"AddClusterContext", "StartClusterContext", "StopClusterContext", "RemoveClusterContext"}[c]
}

type ClusterContextEvent struct {
	// Context is the cluster context to act on. Can possible be nil in the case of RemoveClusterContext
	Context *ClusterContext
	// Name is the name of the context in the kubeconfig that is being used to access the cluster.
	Name string
	// Kubeconfig is the path to the kubeconfig file for where this context is defined.
	Kubeconfig string
	// Action is the action to take on the cluster context
	Action ClusterContextEventAction
}

func (e ClusterContextEvent) GetKey() string {
	return e.Kubeconfig + ":" + e.Name
}

// ClusterContextPublisher is a simple pubsub implementation for broadcasting context changes to all
// interested parties. This is used to notify the various resource servers about the active
// context change.
type ClusterContextPublisher struct {
	// log is the logger for the context publisher.
	log *zap.SugaredLogger
	// subs is the map of subscribers to the pubsub. Each subscriber is a channel that receives
	// the new active context when it changes.
	subs map[string]chan ClusterContextEvent
	// closed is a flag that indicates whether the pubsub has been closed.
	closed bool
	// Lock for the pubsub
	sync.RWMutex
}

// Publish broadcasts the new active context to all subscribers for the specified topic.
// This method is thread-safe.
func (cp *ClusterContextPublisher) Publish(action ClusterContextEventAction, cc *ClusterContext) {
	cp.RLock()
	defer cp.RUnlock()

	if cp.closed {
		return
	}

	event := ClusterContextEvent{
		Action:     action,
		Name:       cc.Name,
		Kubeconfig: cc.Kubeconfig,
		Context:    cc,
	}

	for _, ch := range cp.subs {
		// cp.log.Debugw("sending context to subscriber", "subscriber", subscriber)
		go func(ch chan ClusterContextEvent) {
			ch <- event
		}(ch)
	}
}

// Subscribe creates a new channel for receiving active context updates for the specified topic.
func (cp *ClusterContextPublisher) Subscribe(subscriber string) <-chan ClusterContextEvent {
	cp.Lock()
	defer cp.Unlock()

	ch := make(chan ClusterContextEvent, 1)
	cp.subs[subscriber] = ch

	// cp.log.Debugw("subscribed to context updates", "subscriber", subscriber)
	return ch
}

// Unsubscribe removes the subscriber from the pubsub.
func (cp *ClusterContextPublisher) Unsubscribe(subscriber string) {
	cp.Lock()
	defer cp.Unlock()
	if ch, ok := cp.subs[subscriber]; ok {
		close(ch)
		delete(cp.subs, subscriber)
		// cp.log.Debugw("unsubscribed from context updates", "subscriber", subscriber)
	}
}

// Close closes the pubsub and all subscriber channels.
func (cp *ClusterContextPublisher) Close() {
	cp.Lock()
	defer cp.Unlock()

	if !cp.closed {
		cp.closed = true
		for subscriber, ch := range cp.subs {
			cp.log.Debugw("closing context subscriber", "subscriber", subscriber)
			close(ch)
		}
	}
}
