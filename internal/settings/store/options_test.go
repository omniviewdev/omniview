package store

import (
	"errors"
	"sync"
	"time"
)

// withClock replaces the clock of corruption recovery and of the age of the
// copies it keeps.
func withClock(now func() time.Time) Option {
	return func(c *config) { c.now = now }
}

// withFault installs the hook that is called before each step of a scrub.
func withFault(fault func(step string) error) Option {
	return func(c *config) { c.fault = fault }
}

var errInjected = errors.New("injected failure")

// faultPlan records the steps of a scrub, fails the ones it is told to, and lets
// a test capture the directory at a step: what a crash at that step leaves.
type faultPlan struct {
	mu      sync.Mutex
	seen    []string
	fail    map[string]bool
	capture func(step string)
}

func (p *faultPlan) hook(step string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.seen = append(p.seen, step)
	if p.capture != nil {
		p.capture(step)
	}
	if p.fail[step] {
		return errInjected
	}
	return nil
}

// failing makes exactly the given steps fail, from now on.
func (p *faultPlan) failing(steps ...string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.fail = make(map[string]bool, len(steps))
	for _, step := range steps {
		p.fail[step] = true
	}
}

// steps returns the steps seen so far.
func (p *faultPlan) steps() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.seen...)
}
