package hostruntime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// A document's runtime call must not be attributed before its events socket is
// registered: stock Wails would name the first native window instead, and a
// window-bound capability issued then is refused when the document returns.
func TestEventsSocketHoldsADocumentsCallUntilItsSocketIsRegistered(t *testing.T) {
	var registered atomic.Bool
	var registeredWhenServed atomic.Int32
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if registered.Load() {
			registeredWhenServed.Store(1)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	handler := eventsSocketMiddleware(func(string) bool { return registered.Load() }, 5*time.Second)(next)
	go func() {
		time.Sleep(100 * time.Millisecond)
		registered.Store(true)
	}()
	request := httptest.NewRequest(http.MethodPost, "/wails/runtime", nil)
	request.Header.Set("x-wails-client-id", "document")
	request.Header.Set("Origin", "http://example.test")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if registeredWhenServed.Load() != 1 {
		t.Fatal("the call was served before the document's events socket was registered")
	}
}

func TestEventsSocketLeavesOtherCallersAlone(t *testing.T) {
	served := func(mutate func(*http.Request)) time.Duration {
		handler := eventsSocketMiddleware(func(string) bool { return false }, 5*time.Second)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}))
		request := httptest.NewRequest(http.MethodPost, "/wails/runtime", nil)
		request.Header.Set("x-wails-client-id", "script")
		mutate(request)
		start := time.Now()
		handler.ServeHTTP(httptest.NewRecorder(), request)
		return time.Since(start)
	}
	for name, mutate := range map[string]func(*http.Request){
		"no Origin (a script)": func(*http.Request) {},
		"no client id": func(r *http.Request) {
			r.Header.Set("Origin", "http://example.test")
			r.Header.Del("x-wails-client-id")
		},
		"not a POST": func(r *http.Request) { r.Method = http.MethodGet; r.Header.Set("Origin", "http://example.test") },
		"names its window by name": func(r *http.Request) {
			r.Header.Set("Origin", "http://example.test")
			r.Header.Set("x-wails-window-name", "settings")
		},
		"names its window by id": func(r *http.Request) {
			r.Header.Set("Origin", "http://example.test")
			r.Header.Set("x-wails-window-id", "3")
		},
	} {
		if took := served(mutate); took > time.Second {
			t.Fatalf("%s was held for %s", name, took)
		}
	}
}

func TestEventsSocketGivesUpAfterTheBoundAndServesTheCall(t *testing.T) {
	var served atomic.Bool
	handler := eventsSocketMiddleware(func(string) bool { return false }, 50*time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served.Store(true)
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodPost, "/wails/runtime", nil)
	request.Header.Set("x-wails-client-id", "document")
	request.Header.Set("Origin", "http://example.test")
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if !served.Load() {
		t.Fatal("a document that never opens a socket was never answered")
	}
}

func TestEventsSocketAlreadyRegisteredIsNotHeld(t *testing.T) {
	handler := eventsSocketMiddleware(func(string) bool { return true }, 5*time.Second)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodPost, "/wails/runtime", nil)
	request.Header.Set("x-wails-client-id", "document")
	request.Header.Set("Origin", "http://example.test")
	start := time.Now()
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if took := time.Since(start); took > time.Second {
		t.Fatalf("a document whose socket is up was held for %s", took)
	}
}

func TestEventsSocketDropsACallWhoseCallerWentAwayWhileHeld(t *testing.T) {
	var served atomic.Bool
	handler := eventsSocketMiddleware(func(string) bool { return false }, 5*time.Second)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		served.Store(true)
	}))
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodPost, "/wails/runtime", nil).WithContext(ctx)
	request.Header.Set("x-wails-client-id", "document")
	request.Header.Set("Origin", "http://example.test")
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if served.Load() {
		t.Fatal("a call whose caller had gone away was served")
	}
}
