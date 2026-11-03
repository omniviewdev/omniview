package types

import (
	"context"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// Hiding registry binding must not silently turn resource utilities into legacy
// calls with a request-supplied connection.
type unboundNativeLogs struct{ logs.Provider }

func TestNativeCompositionRejectsUnboundResourceUtility(t *testing.T) {
	resources, err := resourcev2.NewController(resourcev2.Config[string]{
		Catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			return resourcev2.Catalog{Provider: "native", Revision: "1", Coverage: resourcev2.Coverage{Kind: "complete"}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resources.Close() })
	manager := logs.NewManager(logs.ManagerConfig{Logger: logging.NewNop()})
	t.Cleanup(manager.Close)
	backend, err := ComposeNativeBackend(NativeProviders{Resource: resources, Logs: unboundNativeLogs{manager}})
	if err == nil || !strings.Contains(err.Error(), "must consume resource connection context") {
		t.Fatalf("unbound utility admitted: backend=%v error=%v", backend, err)
	}
}
