package instance

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/net/html"
)

// BootMiddleware wraps the outer asset chain, including the Vite proxy. JSON's
// default HTML escaping prevents a display name from terminating the script.
// HTML is never cached across instances; source index.html is not modified.
func BootMiddleware(identity devcontract.BootIdentity) func(http.Handler) http.Handler {
	encoded, _ := json.Marshal(identity) // This fixed scalar-only contract cannot fail.
	script := append([]byte("<script>window.__OMNIVIEW_INSTANCE__="), encoded...)
	script = append(script, []byte(";</script>")...)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Runtime IPC, websocket/HMR upgrades and static assets bypass the wrapper
			// entirely, preserving their streaming and optional writer interfaces.
			if r.Method != http.MethodGet || r.Header.Get("Upgrade") != "" || strings.HasPrefix(r.URL.Path, "/wails/") || strings.HasPrefix(r.URL.Path, "/_/") || (r.URL.Path != "/" && !strings.HasSuffix(r.URL.Path, ".html") && !strings.Contains(r.Header.Get("Accept"), "text/html")) {
				next.ServeHTTP(w, r)
				return
			}
			request := r.Clone(r.Context())
			request.Header = r.Header.Clone()
			request.Header.Del("If-None-Match")
			request.Header.Del("If-Modified-Since")
			// The outer response modifier must see uncompressed proxy HTML.
			request.Header.Set("Accept-Encoding", "identity")
			capture := &bootResponse{ResponseWriter: w}
			next.ServeHTTP(capture, request)
			if !capture.decided {
				capture.decide(capture.Header().Get("Content-Type"))
			}
			if !capture.html {
				return
			}
			body := injectBoot(capture.body.Bytes(), script)
			header := w.Header()
			header.Del("ETag")
			header.Del("Last-Modified")
			header.Del("Content-Encoding")
			header.Set("Cache-Control", "no-store")
			header.Set("Content-Length", strconv.Itoa(len(body)))
			w.WriteHeader(capture.status)
			_, _ = w.Write(body)
		})
	}
}

// injectBoot preserves the doctype and inserts immediately after the actual head
// start tag, not a head-like substring in a comment or attribute. The fallback
// precedes the first script for HTML fragments without an explicit head.
func injectBoot(document, script []byte) []byte {
	tokenizer := html.NewTokenizer(bytes.NewReader(document))
	offset := 0
	firstScript := -1
	for {
		kind := tokenizer.Next()
		raw := tokenizer.Raw()
		offset += len(raw)
		if kind == html.ErrorToken {
			break
		}
		if kind != html.StartTagToken {
			continue
		}
		name, _ := tokenizer.TagName()
		if bytes.Equal(name, []byte("head")) {
			if firstScript >= 0 {
				return insertBytes(document, script, firstScript)
			}
			return insertBytes(document, script, offset)
		}
		if firstScript < 0 && bytes.Equal(name, []byte("script")) {
			firstScript = offset - len(raw)
		}
	}
	if firstScript >= 0 {
		return insertBytes(document, script, firstScript)
	}
	return insertBytes(document, script, len(document))
}
func insertBytes(document, addition []byte, offset int) []byte {
	result := make([]byte, 0, len(document)+len(addition))
	result = append(result, document[:offset]...)
	result = append(result, addition...)
	return append(result, document[offset:]...)
}

type bootResponse struct {
	http.ResponseWriter
	body    bytes.Buffer
	status  int
	html    bool
	decided bool
}

func (w *bootResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *bootResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	if status >= 100 && status < 200 {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.status = status
	if contentType := w.Header().Get("Content-Type"); contentType != "" {
		w.decide(contentType)
	}
}
func (w *bootResponse) decide(contentType string) {
	if w.decided {
		return
	}
	w.decided = true
	mediaType, _, _ := mime.ParseMediaType(contentType)
	w.html = mediaType == "text/html"
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if !w.html {
		w.ResponseWriter.WriteHeader(w.status)
	}
}
func (w *bootResponse) Write(data []byte) (int, error) {
	if !w.decided {
		contentType := w.Header().Get("Content-Type")
		if contentType == "" {
			contentType = http.DetectContentType(data)
			w.Header().Set("Content-Type", contentType)
		}
		w.decide(contentType)
	}
	if w.html {
		return w.body.Write(data)
	}
	return w.ResponseWriter.Write(data)
}
func (w *bootResponse) Flush() {
	if !w.decided {
		w.decide(w.Header().Get("Content-Type"))
	}
	if !w.html {
		_ = http.NewResponseController(w.ResponseWriter).Flush()
	}
}
func (w *bootResponse) ReadFrom(reader io.Reader) (int64, error) {
	return io.Copy(struct{ io.Writer }{w}, reader)
}
