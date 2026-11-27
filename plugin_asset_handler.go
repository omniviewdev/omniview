package main

import (
	"bytes"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// PluginAssetHandler serves plugin assets from the local filesystem.
// It is used as middleware in the Wails v3 AssetOptions to handle
// requests for plugin-specific static files (JS, CSS, images, fonts).
type PluginAssetHandler struct {
	logger         logging.Logger
	stateRoot      *appstate.ScopedRoot
	readPinnedPage func(id, pin, generation, assetPath string) ([]byte, error)
}

// NewPluginAssetHandler creates a new PluginAssetHandler.
func NewPluginAssetHandler(logger logging.Logger, stateRoot *appstate.ScopedRoot) *PluginAssetHandler {
	return &PluginAssetHandler{
		logger:    logger,
		stateRoot: stateRoot,
	}
}

// allowedPathRegex is compiled once at init — regexp.MustCompile is expensive
// and should not be called on every HTTP request.
var allowedPathRegex = regexp.MustCompile(
	`^/plugins/[^/]+/(assets|dist)/.*\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html|js\.map)$`,
)

func isAllowed(path string) bool {
	return allowedPathRegex.MatchString(path)
}

func forceMimeType(path string) string {
	switch {
	case strings.HasSuffix(path, ".js.map"):
		return "application/javascript"
	case strings.HasSuffix(path, ".js"), strings.HasSuffix(path, ".mjs"):
		return "application/javascript"
	case strings.HasSuffix(path, ".css"):
		return "text/css"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(path, ".gif"):
		return "image/gif"
	case strings.HasSuffix(path, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(path, ".ico"):
		return "image/x-icon"
	case strings.HasSuffix(path, ".woff"):
		return "font/woff"
	case strings.HasSuffix(path, ".woff2"):
		return "font/woff2"
	case strings.HasSuffix(path, ".ttf"):
		return "font/ttf"
	case strings.HasSuffix(path, ".html"):
		return "text/html"
	default:
		return "text/plain"
	}
}

// ServeHTTP handles HTTP requests for plugin assets.
func (h *PluginAssetHandler) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	var err error
	ctx := req.Context()
	respondUnauthorized := func() {
		res.WriteHeader(http.StatusUnauthorized)
		if _, err = res.Write([]byte("Unauthorized")); err != nil {
			h.logger.Errorw(ctx, "error writing unauthorized response", "error", err)
		}
	}

	requestedFilename := req.URL.Path

	// must start with /_/
	if !strings.HasPrefix(requestedFilename, "/_/") {
		respondUnauthorized()
		return
	}
	requestedFilename = strings.TrimPrefix(requestedFilename, "/_/")

	// An immutable module URL also scopes its relative chunks. Never fall back to
	// the mutable page tree when a pin, generation, or indexed file is refused.
	pluginPath, plugin := strings.CutPrefix(requestedFilename, "plugins/")
	id, rest, _ := strings.Cut(pluginPath, "/")
	if pinned, ok := strings.CutPrefix(rest, "verified/"); plugin && ok {
		pin, generationPath, _ := strings.Cut(pinned, "/")
		generation, asset, hasAsset := strings.Cut(generationPath, "/")
		if !hasAsset || h.readPinnedPage == nil || path.Clean(requestedFilename) != requestedFilename ||
			!strings.HasPrefix(asset, "assets/") || !strings.HasSuffix(asset, ".mjs") && !isAllowed("/plugins/"+id+"/"+asset) {
			respondUnauthorized()
			return
		}
		data, readErr := h.readPinnedPage(id, pin, generation, asset)
		if readErr != nil {
			http.NotFound(res, req)
			return
		}
		h.writeAsset(res, req, asset, data)
		return
	}

	// Normalize the path to prevent traversal via sequences like "foo/../bar".
	requestedFilename = path.Clean(requestedFilename)

	h.logger.Debugw(ctx, "requested file", "path", requestedFilename)

	if !isAllowed("/" + requestedFilename) {
		respondUnauthorized()
		return
	}

	// ScopedRoot enforces containment — no manual checks needed.
	fileData, err := h.stateRoot.ReadFile(requestedFilename)
	if err != nil {
		res.WriteHeader(http.StatusBadRequest)
		if _, err = fmt.Fprintf(res, "Could not load file %s", requestedFilename); err != nil {
			h.logger.Errorw(ctx, "error serving file", "error", err)
		}
		return
	}

	h.writeAsset(res, req, requestedFilename, fileData)
}

func (h *PluginAssetHandler) writeAsset(res http.ResponseWriter, req *http.Request, requestedFilename string, fileData []byte) {
	// Only allowlisted paths reach here. Serve bytes as the declared asset type:
	// content inside a script or stylesheet must not turn it into an HTML document.
	contentType := forceMimeType(requestedFilename)
	h.logger.Infow(req.Context(), "content type", "type", contentType)
	res.Header().Set("Content-Type", contentType)
	res.Header().Set("X-Content-Type-Options", "nosniff")

	// Plugin updates replace stable chunk and stylesheet filenames in place.
	// Every asset must bypass persistent caches, not just the entry module.
	res.Header().Set("Cache-Control", "no-store")

	http.ServeContent(res, req, requestedFilename, time.Time{}, bytes.NewReader(fileData))
}

// Middleware returns an application.Middleware that intercepts plugin asset
// requests (those prefixed with /_/) and delegates them to the
// PluginAssetHandler. All other requests pass through to the next handler.
func (h *PluginAssetHandler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/_/") {
			h.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}
