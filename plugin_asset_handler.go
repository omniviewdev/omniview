package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/wailsapp/mimetype"
)

// PluginAssetHandler serves plugin assets from the local filesystem.
// It is used as middleware in the Wails v3 AssetOptions to handle
// requests for plugin-specific static files (JS, CSS, images, fonts).
type PluginAssetHandler struct {
	logger logging.Logger
}

// NewPluginAssetHandler creates a new PluginAssetHandler.
func NewPluginAssetHandler(logger logging.Logger) *PluginAssetHandler {
	return &PluginAssetHandler{
		logger: logger,
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
	case strings.HasSuffix(path, ".js"):
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
	requestedFilename = strings.TrimPrefix(requestedFilename, "/_")

	requestedFilename = filepath.Clean(requestedFilename)

	h.logger.Debugw(ctx, "requested file", "path", requestedFilename)

	if !isAllowed(requestedFilename) {
		respondUnauthorized()
		return
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		h.logger.Errorw(ctx, "failed to get home directory", "error", err)
		res.WriteHeader(http.StatusInternalServerError)
		return
	}

	toFetch := filepath.Join(homeDir, ".omniview", requestedFilename)
	// Containment check: ensure resolved path stays under ~/.omniview
	omniviewRoot := filepath.Join(homeDir, ".omniview")
	if !strings.HasPrefix(toFetch, omniviewRoot+string(filepath.Separator)) {
		respondUnauthorized()
		return
	}
	h.logger.Infow(ctx, "fetching file", "path", toFetch)

	fileData, err := os.ReadFile(toFetch)
	if err != nil {
		res.WriteHeader(http.StatusBadRequest)
		if _, err = fmt.Fprintf(res, "Could not load file %s", toFetch); err != nil {
			h.logger.Errorw(ctx, "error serving file", "error", err)
		}
		return
	}

	// set content type
	contentType := mimetype.Detect(fileData).String()
	h.logger.Infow(ctx, "content type", "type", contentType)
	if strings.HasPrefix(contentType, "text/plain") {
		// don't like this but it's the only way to force the right mime type.
		contentType = forceMimeType(requestedFilename)
	}

	res.Header().Set("Content-Type", contentType)

	// if remoteEntry.js, do NOT cache
	if strings.HasSuffix(requestedFilename, "entry.js") {
		res.Header().Set("Cache-Control", "no-store")
	}

	if _, err = res.Write(fileData); err != nil {
		h.logger.Errorw(ctx, "error serving file", "error", err)
	}
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
