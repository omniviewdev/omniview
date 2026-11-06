package metric

import "encoding/json"

// Configuration fences track only state consumed by a selected lane. A source
// credential edit still retires work even if the public mapping is unchanged.
type finiteConfigurationKey struct {
	kind       string
	plugin     string
	connection string
	resource   string
}

func (key finiteConfigurationKey) MarshalJSON() ([]byte, error) {
	return json.Marshal([4]string{key.kind, key.plugin, key.connection, key.resource})
}

func finiteLaneConfigurationKeys(lanes []finiteSourceLane) []finiteConfigurationKey {
	keys := []finiteConfigurationKey{}
	seen := map[finiteConfigurationKey]bool{}
	for _, lane := range lanes {
		for _, key := range lane.configurationKeys {
			if !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
		}
	}
	return keys
}
func finiteConfigurationMatches(dependencies, changed []finiteConfigurationKey) bool {
	for _, dependency := range dependencies {
		for _, key := range changed {
			if dependency == key {
				return true
			}
		}
	}
	return false
}
func (f *finiteCoordinator) configurationCurrentLocked(keys []finiteConfigurationKey, serial uint64) bool {
	for _, key := range keys {
		if f.configurationBlocked[key] > 0 || f.configurationVersions[key] > serial {
			return false
		}
	}
	return true
}
func (f *finiteCoordinator) invalidateConfigurationKeysLocked(keys []finiteConfigurationKey) []*finiteObservation {
	for id, read := range f.catalogs {
		if finiteConfigurationMatches(read.configurationKeys, keys) {
			read.cancel()
			delete(f.catalogs, id)
		}
	}
	for job := range f.jobs {
		if !finiteConfigurationMatches(job.configurationKeys, keys) {
			continue
		}
		job.retired = true
		job.cancel()
		for waiter := range job.waiters {
			delete(f.pending, waiter)
			f.finishWaiter(waiter, profileChangingError())
		}
		clear(job.waiters)
	}
	for waiter := range f.pending {
		if finiteConfigurationMatches(waiter.configurationKeys, keys) {
			delete(f.pending, waiter)
			f.finishWaiter(waiter, profileChangingError())
		}
	}
	kept := f.cache[:0]
	for _, entry := range f.cache {
		if !finiteConfigurationMatches(entry.configurationKeys, keys) {
			kept = append(kept, entry)
		}
	}
	clear(f.cache[len(kept):])
	f.cache = kept
	var publish []*finiteObservation
	for _, observation := range f.observations {
		if !finiteConfigurationMatches(observation.configurationKeys, keys) {
			continue
		}
		f.snapshotBytes -= observation.dataBytes
		observation.dataBytes = 0
		observation.configurationEpoch++
		observation.refresh = true
		observation.snapshot.Data = nil
		observation.snapshot.Catalog = nil
		if observation.spec.DurationMs > 0 {
			observation.snapshot.DomainStart = nil
			observation.snapshot.DomainEnd = nil
		}
		observation.snapshot.Fetching = false
		observation.snapshot.Invalidated = true
		observation.snapshot.Error = "Metric source configuration changed."
		observation.snapshot.Sequence++
		publish = append(publish, observation)
	}
	return publish
}
func (c *controller) beginScopedMetricConfigurationChange(keys []finiteConfigurationKey) func() {
	f := c.finiteCoordinator()
	apply := func(start bool) {
		f.mu.Lock()
		if f.configurationVersions == nil {
			f.configurationVersions = map[finiteConfigurationKey]uint64{}
			f.configurationBlocked = map[finiteConfigurationKey]int{}
		}
		f.configurationSerial++
		if len(f.configurationVersions) > 4096 {
			f.pruneConfigurationVersionsLocked()
		}
		for _, key := range keys {
			f.configurationVersions[key] = f.configurationSerial
			if start {
				f.configurationBlocked[key]++
			} else {
				f.configurationBlocked[key]--
				if f.configurationBlocked[key] == 0 {
					delete(f.configurationBlocked, key)
				}
			}
		}
		publish := f.invalidateConfigurationKeysLocked(keys)
		f.mu.Unlock()
		for _, observation := range publish {
			observation.publish()
		}
		f.signal()
	}
	apply(true)
	return func() { apply(false) }
}

func (c *controller) metricDefinitionConfigurationKeys(id string, resources []string) ([]finiteConfigurationKey, error) {
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	var oldResources []string
	for _, definition := range s.data.Definitions {
		if definition.ID == id {
			oldResources = definition.ResourceKeys
			break
		}
	}
	keys := []finiteConfigurationKey{{kind: "definition", resource: id}}
	old := map[string]bool{}
	for _, resource := range oldResources {
		old[resource] = true
	}
	for _, resource := range resources {
		if !old[resource] {
			keys = append(keys, finiteConfigurationKey{kind: "definitions", resource: resource})
		}
	}
	return keys, nil
}

// Retain change stamps while a read may still be resolving its dependencies.
// Completed caches are invalidated at edits, so inactive history can be dropped.
func (f *finiteCoordinator) beginConfigurationRead() (uint64, uint64, func()) {
	f.mu.Lock()
	generation, serial := f.configuration, f.configurationSerial
	if f.configurationReaders == nil {
		f.configurationReaders = map[uint64]int{}
	}
	f.configurationReaders[serial]++
	f.mu.Unlock()
	return generation, serial, func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.configurationReaders[serial]--
		if f.configurationReaders[serial] == 0 {
			delete(f.configurationReaders, serial)
		}
		if len(f.configurationVersions) > 4096 {
			f.pruneConfigurationVersionsLocked()
		}
	}
}
func (f *finiteCoordinator) pruneConfigurationVersionsLocked() {
	oldest := f.configurationSerial
	for serial := range f.configurationReaders {
		if serial < oldest {
			oldest = serial
		}
	}
	for key, serial := range f.configurationVersions {
		if serial < oldest && f.configurationBlocked[key] == 0 {
			delete(f.configurationVersions, key)
		}
	}
}

func finiteMergeConfigurationKeys(current, incoming []finiteConfigurationKey) []finiteConfigurationKey {
	for _, key := range incoming {
		found := false
		for _, old := range current {
			if old == key {
				found = true
				break
			}
		}
		if !found {
			current = append(current, key)
		}
	}
	return current
}
