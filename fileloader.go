package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/mimetype"
	"go.uber.org/zap"
)

type FileLoader struct {
	http.Handler
	logger *zap.SugaredLogger
}

func NewFileLoader(logger *zap.SugaredLogger) *FileLoader {
	return &FileLoader{
		logger: logger,
	}
}

func isAllowed(path string) bool {
	// only allow the following patterns:
	// - /plugins/<pluginname>/(assets|dist)/*.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)
	// - /assets/*.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)

	tester := regexp.MustCompile(
		`^/plugins/[^/]+/(assets|dist)/.*\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)$`,
	)
	return tester.MatchString(path)
}

func forceMimeType(path string) string {
	switch {
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

func (h *FileLoader) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	var err error
	respondUnauthorized := func() {
		res.WriteHeader(http.StatusUnauthorized)
		if _, err = res.Write([]byte("Unauthorized")); err != nil {
			h.logger.Errorw("error writing unauthorized response", "error", err)
		}
	}

	requestedFilename := req.URL.Path

	// must start with /_/
	if !strings.HasPrefix(requestedFilename, "/_/") {
		respondUnauthorized()
		return
	}
	requestedFilename = strings.TrimPrefix(requestedFilename, "/_")

	h.logger.Debugw("requested file", "path", requestedFilename)

	if !isAllowed(requestedFilename) {
		respondUnauthorized()
		return
	}

	toFetch := filepath.Join(os.Getenv("HOME"), ".omniview", requestedFilename)
	h.logger.Infow("fetching file", "path", toFetch)

	fileData, err := os.ReadFile(toFetch)
	if err != nil {
		res.WriteHeader(http.StatusBadRequest)
		if _, err = fmt.Fprintf(res, "Could not load file %s", toFetch); err != nil {
			h.logger.Errorw("error serving file", "error", err)
		}
		return
	}

	// set content type
	contentType := mimetype.Detect(fileData).String()
	h.logger.Infow("content type", "type", contentType)
	if strings.HasPrefix(contentType, "text/plain") {
		// don't like this but it's the only way to force the right mime type.
		contentType = forceMimeType(requestedFilename)
	}

	res.Header().Set("Content-Type", contentType)

	// if remoteEntry.js, do NOT cache
	if strings.HasSuffix(requestedFilename, "remoteEntry.js") {
		res.Header().Set("Cache-Control", "no-store")
	}

	if _, err = res.Write(fileData); err != nil {
		h.logger.Errorw("error serving file", "error", err)
	}
}
