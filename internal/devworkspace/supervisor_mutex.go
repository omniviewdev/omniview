package devworkspace

import (
	"context"
	"sync"
)

// supervisorMutex has a usable zero value and lets queued requests abandon
// authority without leaving a goroutine that may acquire it after cancellation.
// Background cleanup still uses Lock because cancellation cannot prove disposal.
type supervisorMutex struct {
	once  sync.Once
	token chan struct{}
}

func (m *supervisorMutex) initialize() {
	m.once.Do(func() {
		m.token = make(chan struct{}, 1)
		m.token <- struct{}{}
	})
}

func (m *supervisorMutex) Lock() {
	m.initialize()
	<-m.token
}

func (m *supervisorMutex) LockContext(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.initialize()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-m.token:
		// Cancellation and release can become ready together. Canceled waiters
		// must return authority before any operation effects begin.
		if err := ctx.Err(); err != nil {
			m.Unlock()
			return err
		}
		return nil
	}
}

func (m *supervisorMutex) TryLock() bool {
	m.initialize()
	select {
	case <-m.token:
		return true
	default:
		return false
	}
}

func (m *supervisorMutex) Unlock() {
	m.initialize()
	select {
	case m.token <- struct{}{}:
	default:
		panic("unlock of unlocked supervisor mutex")
	}
}
