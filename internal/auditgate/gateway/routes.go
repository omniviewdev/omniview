package gateway

import (
	"net/http"
	"strings"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

type routeKind uint8

const (
	routeDenied routeKind = iota
	routeRuntime
	routeEvents
	routeStatic
)

// routing is the classification of an authenticated request.
type routing struct {
	kind   routeKind
	path   string
	query  string
	reason auditgate.Reason
}

const (
	// maxTargetBytes bounds the raw request target.
	maxTargetBytes = 2048
	// maxPathSegments and maxSegmentBytes bound a static asset path.
	maxPathSegments = 16
	maxSegmentBytes = 128
)

// splitTarget cuts the raw request target into path and query without decoding
// either. The target must be origin-form: it starts with "/" and contains only
// printable ASCII, no space and no "#". Everything else (absolute-form,
// asterisk-form, authority-form, controls, non-ASCII) is refused, which the
// last result reports.
func splitTarget(target string) (string, string, bool) {
	if target == "" || len(target) > maxTargetBytes || target[0] != '/' {
		return "", "", false
	}
	for i := range len(target) {
		if c := target[i]; c <= ' ' || c >= 0x7F || c == '#' {
			return "", "", false
		}
	}
	path, query, _ := strings.Cut(target, "?")
	return path, query, true
}

// classifyRoute decides what an authenticated request is for. The route table
// is closed: the runtime POST, the events socket, and a short list of static
// GET routes. Everything else, including the Wails stream and event-payload
// routes, is denied.
func classifyRoute(r *http.Request) routing {
	path, query, ok := splitTarget(r.RequestURI)
	if !ok {
		return routing{kind: routeDenied, path: "", query: "", reason: reasonRouteNotAllowed}
	}
	found := routing{kind: routeDenied, path: path, query: query, reason: reasonRouteNotAllowed}
	switch auditgate.ClassifyPath(path) {
	case auditgate.PathRuntime:
		found.kind, found.reason = routeRuntime, ""
	case auditgate.PathEvents:
		found.kind, found.reason = routeEvents, ""
	case auditgate.PathStream:
		found.reason = auditgate.ReasonStream
	case auditgate.PathOther:
		if staticRoute(path) {
			found.kind, found.reason = routeStatic, ""
		}
	}
	return found
}

// staticRoute reports whether path is one of the GET routes the page needs to
// load. The match is on the raw path, so an encoded, doubled or dotted
// spelling of an allowed route is not that route.
//
//   - the page itself, "/", and the Wails scripts and probe the page loads;
//   - files of the embedded UI: "/assets/..." and "/images/..." below
//     their roots, and single files at the top level, each with an extension
//     of a static resource;
//   - installed plugin assets: "/_/plugins/<id>/assets/..." and ".../dist/...",
//     with the extensions the host's own plugin asset handler serves.
func staticRoute(path string) bool {
	switch path {
	case "/", "/health", "/wails/custom.js", "/wails/runtime.js", "/wails/transport.js":
		return true
	}
	segments, ok := pathSegments(path)
	if !ok {
		return false
	}
	if segments[0] == "_" {
		return pluginAsset(segments)
	}
	return embeddedAsset(segments)
}

// pathSegments splits an origin-form path into its segments. Every segment must
// be non-empty, start with a letter, digit or underscore (so none is "." or
// ".." or hidden) and contain only letters, digits, ".", "_" and "-". A path
// that cannot be a plain file path returns false.
func pathSegments(path string) ([]string, bool) {
	if len(path) < 2 || path[0] != '/' {
		return nil, false
	}
	segments := strings.Split(path[1:], "/")
	if len(segments) > maxPathSegments {
		return nil, false
	}
	for _, segment := range segments {
		if !plainSegment(segment) {
			return nil, false
		}
	}
	return segments, true
}

func plainSegment(segment string) bool {
	if segment == "" || len(segment) > maxSegmentBytes || segment[0] == '.' {
		return false
	}
	for i := range len(segment) {
		c := segment[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '.', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}

func embeddedAsset(segments []string) bool {
	if !embeddedExtension(segments[len(segments)-1]) {
		return false
	}
	return len(segments) == 1 || segments[0] == "assets" || segments[0] == "images"
}

// pluginAsset matches /_/plugins/<id>/(assets|dist)/.../<file>, the shape the
// host's plugin asset handler serves.
func pluginAsset(segments []string) bool {
	const minSegments = 5 // _, plugins, id, assets|dist, file
	if len(segments) < minSegments || segments[1] != "plugins" {
		return false
	}
	if segments[3] != "assets" && segments[3] != "dist" {
		return false
	}
	return pluginExtension(segments[len(segments)-1])
}

func embeddedExtension(name string) bool {
	switch lowerExtension(name) {
	case "js", "mjs", "css", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "woff", "woff2", "ttf", "otf":
		return true
	}
	return false
}

// pluginExtension is the host's plugin asset list: allowedPathRegex in
// plugin_asset_handler.go.
func pluginExtension(name string) bool {
	lower := strings.ToLower(name)
	if strings.HasSuffix(lower, ".js.map") {
		return true
	}
	switch lowerExtension(name) {
	case "js", "css", "png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2", "ttf", "html":
		return true
	}
	return false
}

func lowerExtension(name string) string {
	dot := strings.LastIndexByte(name, '.')
	if dot < 0 || dot == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[dot+1:])
}

// originDenial applies the browser-context rules to an authenticated request.
//
// An unsafe request (anything but GET or HEAD) and every WebSocket upgrade
// must carry exactly one Origin equal to this audit's origin. A safe request
// may omit Origin, as browsers do for same-origin reads, but one that carries
// it must match too. If Sec-Fetch-Site is present it must say same-origin; a
// safe request may also say none (the owner typed the address). A cross-site
// or same-site page, null, a sibling origin or a list of origins is refused.
func (g *Gateway) originDenial(header http.Header, method string, upgrade bool) auditgate.Reason {
	unsafe := upgrade || (method != http.MethodGet && method != http.MethodHead)
	origins := header.Values("Origin")
	switch {
	case len(origins) > 1:
		return reasonOrigin
	case len(origins) == 1 && origins[0] != g.origin:
		return reasonOrigin
	case len(origins) == 0 && unsafe:
		return reasonOrigin
	}
	sites := header.Values("Sec-Fetch-Site")
	switch {
	case len(sites) == 0:
		return ""
	case len(sites) == 1 && (sites[0] == "same-origin" || (!unsafe && sites[0] == "none")):
		return ""
	default:
		return reasonFetchMetadata
	}
}
