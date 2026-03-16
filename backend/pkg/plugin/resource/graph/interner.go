package graph

// stringInterner deduplicates repeated strings (pluginID, connectionID, resourceKey)
// across graph edges. Uses reference counting so strings with zero references
// are evicted when connections tear down.
type stringInterner struct {
	pool map[string]*internedString
}

type internedString struct {
	value string
	refs  int
}

func newStringInterner() *stringInterner {
	return &stringInterner{pool: make(map[string]*internedString)}
}

func (si *stringInterner) Intern(s string) string {
	if entry, ok := si.pool[s]; ok {
		entry.refs++
		return entry.value
	}
	si.pool[s] = &internedString{value: s, refs: 1}
	return s
}

func (si *stringInterner) Release(s string) {
	entry, ok := si.pool[s]
	if !ok {
		return
	}
	entry.refs--
	if entry.refs <= 0 {
		delete(si.pool, s)
	}
}

func (si *stringInterner) refCount(s string) int {
	if entry, ok := si.pool[s]; ok {
		return entry.refs
	}
	return 0
}

func (si *stringInterner) Len() int {
	return len(si.pool)
}
