//go:build race && !windows

package terminal

// underRace says the tests run under the race detector, which slows a pump so much that two hundred shells cannot
// fill their rings in a useful time: the test of many detached terminals runs with fewer.
const underRace = true
