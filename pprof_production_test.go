//go:build production

package main

import "testing"

func TestHostPprofProductionDisabled(t *testing.T) {
	server, err := startHostPprof("")
	if server != nil || err != nil {
		t.Fatalf("unset production port: server=%v err=%v", server, err)
	}
	server, err = startHostPprof("6060")
	if server != nil || err == nil {
		t.Fatalf("production build accepted pprof listener: server=%v err=%v", server, err)
	}
}
