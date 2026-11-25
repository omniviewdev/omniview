# Status: RCS1 (the resource component store is safe for the plugin workers that share it)

**State: fixed and verified as listed below; in review.**

- Branch `fix/resource-component-store-race` from `origin/main` c1e2cf40. Found by the PT2 seam run (`PT2.md` section 2, catalog item "NEW, TANGENTIAL"): a host start died with `fatal error: concurrent map writes` in `ResourceComponentStore.AddPlugin` (`backend/pkg/plugin/ui/resource.go`).

## Cause

`ResourceComponentStore` was a bare `map` type with methods on the map, written and read without a lock. The host loads its plugins with a pool of four workers (`pluginManager.loadPluginsConcurrently`), and each worker runs `OnPluginInit`, `OnPluginStart` and `OnPluginStop` of every manager, so the component manager's store is written by several goroutines at once, and the frontend's service reads it (`GetPluginComponents` hands out the inner map itself) while they do.

## Fix (`backend/pkg/plugin/ui/resource.go`, `manager.go`)

- The store is a struct that owns an `sync.RWMutex`, as the controllers of the neighbouring managers do (`exec`, `logs`, `metric`, `networker`, `settings`, `tools`, `resource`: each guards its lifecycle state with a mutex). `NewResourceComponentStore` answers a pointer.
- The check for a double and the adding of a component are one step under the write lock, so two registrations of the same component at once keep one.
- What the store hands out is a copy (the slices, the maps and the extensions of each component): the frontend's service encodes it while another plugin loads, and a caller that changes it does not change the store. What `AddComponent` is given is copied too.
- The behaviour for one caller at a time is unchanged (seven characterization tests, green before and after): the words of the refusals, `nil` for a plugin or a resource that is not there, an empty map for a plugin with no components, a component that names a plugin that was not added creates it.

## Sweep for the same shape

Every named map type of `backend/` (`ResourceComponentStore` is the only one that is shared; `internal/devoutputs` `snapshot` is a value built for one observation), and every manager that implements `OnPluginInit` (`exec`, `logs`, `metric`, `networker`, `resource`, `settings`, `tools`, `ui`): the other seven guard the maps their hooks write with a mutex (`c.mu`, `c.mux`, `batchMux`, `hydratingMu`), and `resource/registry.MemoryStore` locks around its helpers. A scan of `backend/pkg/plugin/**` for functions that write a map field with no lock found only helpers named `...Locked`, rings documented as "callers must hold the mutex" and `stringInterner` (used under the graph's lock). Nothing else of this class.

## Evidence

- Red first (`RCS1-red.txt`, run through `go test -overlay` against the unchanged files): nine new tests fail on the old store. Seven die with `fatal error: concurrent map read and map write` or `concurrent map writes` after `WARNING: DATA RACE` (one of them hung for five minutes in one run and was killed by its pid), and two fail cleanly: the same component registered at once was accepted more than once, and what a caller changed or deleted in what it was given changed the store. The seven tests of one caller at a time pass on both.
- Green: `GOWORK=off go test -race -count=3 ./backend/pkg/plugin/ui/` ok (16 tests: store, and the manager's hooks called by 64 goroutines at once with readers); `go build ./backend/...` and `go vet` clean; CI's golangci-lint 2.15.0 on the changed lines (`--new-from-patch`): 0 issues.

## Not verified

- A real host start (the seam): the fix is local to the store and tested at the manager's hooks; no seam run was made for it.
