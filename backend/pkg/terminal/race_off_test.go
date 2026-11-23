//go:build !race && !windows

package terminal

// underRace says the tests run under the race detector (see race_on_test.go).
const underRace = false
