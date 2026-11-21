package resource

import (
	"sync"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// liveProvider stands for a plugin generation's runtime state: it guards its
// own map with its own lock, as the real provider and backend do, and knows
// nothing of any observer.
type liveProvider struct {
	ResourceProvider
	mu   sync.Mutex
	seen map[int]int
}

func (p *liveProvider) churn(stop <-chan struct{}) {
	for i := 0; ; i++ {
		select {
		case <-stop:
			return
		default:
		}
		p.mu.Lock()
		p.seen[i%64] = i
		delete(p.seen, (i+7)%64)
		p.mu.Unlock()
	}
}

func observationOf(generation *pluginState, digest byte) Observation {
	return Observation{
		admission: catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: "c", Epoch: 1}},
		plugin:    "p",
		route:     resourcev2.AccessRoute{Connection: "c"},
		digest:    [32]byte{digest},
		discovery: &catalogDiscovery{authorities: map[string]AuthorityResolution{"pods": {Authority: "a", Limitations: []string{"x"}}}},
	}
}

func TestObservationSameIsGenerationIdentityAndDigest(t *testing.T) {
	generation := &pluginState{}
	base := observationOf(generation, 1)

	if !base.Same(observationOf(generation, 1)) {
		t.Fatal("a fresh scan of the same generation and digest must be the same observation, although its discovery pointer is new")
	}
	for name, other := range map[string]Observation{
		"generation": observationOf(&pluginState{}, 1),
		"digest":     observationOf(generation, 2),
	} {
		if base.Same(other) {
			t.Errorf("a different %s must not be the same observation", name)
		}
	}
	mutate := func(edit func(*Observation)) Observation {
		o := observationOf(generation, 1)
		edit(&o)
		return o
	}
	for name, other := range map[string]Observation{
		"epoch":      mutate(func(o *Observation) { o.admission.epoch.Epoch++ }),
		"plugin":     mutate(func(o *Observation) { o.plugin = "q" }),
		"route":      mutate(func(o *Observation) { o.route.Connection = "d" }),
		"controller": mutate(func(o *Observation) { o.discovery.controller = &controller{} }),
		"authority":  mutate(func(o *Observation) { o.discovery.authorities["pods"] = AuthorityResolution{Authority: "b"} }),
		"limitations": mutate(func(o *Observation) {
			o.discovery.authorities["pods"] = AuthorityResolution{Authority: "a", Limitations: []string{"y"}}
		}),
		"no scan": mutate(func(o *Observation) { o.discovery = nil }),
	} {
		if base.Same(other) {
			t.Errorf("a different %s must not be the same observation", name)
		}
	}
	if !(Observation{}).Same(Observation{}) {
		t.Error("two zero observations are the same")
	}
}

// Two retained catalogs that hold different plugin generations are compared
// while the plugin runs. The comparison must not read a generation's state:
// that state is guarded by locks the comparer does not hold. Run with -race.
func TestObservationSameReadsNoLivePluginState(t *testing.T) {
	first, second := &liveProvider{seen: map[int]int{}}, &liveProvider{seen: map[int]int{}}
	a := observationOf(&pluginState{provider: first}, 1)
	b := observationOf(&pluginState{provider: second}, 1)

	stop := make(chan struct{})
	var running sync.WaitGroup
	for _, provider := range []*liveProvider{first, second} {
		running.Add(1)
		go func() { defer running.Done(); provider.churn(stop) }()
	}
	for range 2000 {
		if a.Same(b) {
			t.Fatal("different generations are never the same observation")
		}
	}
	close(stop)
	running.Wait()
}
