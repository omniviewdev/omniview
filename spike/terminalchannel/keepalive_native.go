//go:build !server

package main

import "time"

// keepAlive pokes the page from the host every PROBE_KEEPALIVE_MS (0: never). An evaluateJavaScript from the UI process
// is activity WebKit counts, so a page it considers hidden (a locked screen, an occluded or minimised window) keeps
// running. It is how the freeze was proved to be visibility and not a transport fault, and it lets the native runs go on
// under a locked screen. It also perturbs them a little (a no-op script at 20 Hz); the product needs none of it.
func (p *probe) keepAlive() {
	ms := envInt("PROBE_KEEPALIVE_MS", 0)
	if ms <= 0 {
		return
	}
	go func() {
		for range time.Tick(time.Duration(ms) * time.Millisecond) {
			if p.win != nil {
				p.win.ExecJS("void 0")
			}
		}
	}()
}
