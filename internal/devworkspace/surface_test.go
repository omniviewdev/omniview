package devworkspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestBrowserSurfaceRequiresExactInjectedGeneration(t *testing.T) {
	expected := devcontract.BootIdentity{SchemaVersion: 1, InstanceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Kind: "development", DisplayName: "Fixture"}
	var document atomic.Value
	document.Store("<html>__OMNIVIEW_INSTANCE__ " + expected.InstanceID + "</html>")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(document.Load().(string))) }))
	defer server.Close()
	if err := probeBrowser(context.Background(), server.URL, expected); err == nil {
		t.Fatal("ready-looking identity text was accepted")
	}
	stale := expected
	stale.Generation = NewGeneration()
	data, _ := json.Marshal(stale)
	document.Store("<script>window.__OMNIVIEW_INSTANCE__=" + string(data) + ";</script>")
	if err := probeBrowser(context.Background(), server.URL, expected); err == nil {
		t.Fatal("previous host generation was accepted")
	}
	data, _ = json.Marshal(expected)
	document.Store("<script>window.__OMNIVIEW_INSTANCE__=" + string(data) + ";</script>")
	if err := probeBrowser(context.Background(), server.URL, expected); err != nil {
		t.Fatal(err)
	}
}
