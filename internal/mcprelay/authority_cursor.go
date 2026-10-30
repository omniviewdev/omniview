package mcprelay

import "context"

// AuthorityCursorOwner is a host-issued credential/session ownership label, not
// an invocation grant. It is stable across calls in one MCP session, unlike the
// deliberately unique child invocation principal. Native contexts return empty.
// Cursor codecs should hash this label into their existing bound cursor token.
func AuthorityCursorOwner(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok || !c.bound {
		return ""
	}
	return c.credential + "\x00" + c.session
}
