package telemetry

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdklog "go.opentelemetry.io/otel/sdk/log"

	"github.com/omniviewdev/omniview/internal/devdiag"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// A secret-shaped value inside a provider or plugin error that a controller passes
// as a log field must not reach omniview.log or the OTel log exporter. buildZapLogger
// puts every core it builds behind NewRedactingCore, and ZapBackend converts
// plugin-sdk records into the fields it redacts. This test drives the production
// construction (buildZapLogger + NewZapBackend), so it passes only when the pipeline
// itself redacts: for string fields, error fields and the message.

// leakSecrets returns secret-shaped values the host's own redactor recognises.
func leakSecrets() []string {
	return []string{
		"Authorization: Bearer abc123def456ghi789",
		"password=hunter2",
		"AKIAIOSFODNN7EXAMPLE",
	}
}

// leakingProviderError is what a plugin-origin error looks like once gRPC has
// flattened it to text.
func leakingProviderError() error {
	return errors.New("rpc error: code = Unauthenticated desc = " + strings.Join(leakSecrets(), " ; "))
}

func requireSecretsRecognised(t *testing.T, text string) {
	t.Helper()
	// Guards the test itself: if devdiag stops recognising a shape, the failure
	// below would be about the fixture and not about the pipeline.
	require.NotEqual(t, text, devdiag.Redact(text), "fixture must be secret-shaped for devdiag.Redact")
}

func requireNoSecrets(t *testing.T, where, got string) {
	t.Helper()
	var leaked []string
	for _, s := range []string{"abc123def456ghi789", "hunter2", "AKIAIOSFODNN7EXAMPLE"} {
		if strings.Contains(got, s) {
			leaked = append(leaked, s)
		}
	}
	if len(leaked) > 0 {
		t.Errorf("%s carries secret-shaped values %q verbatim: a core of the host log pipeline "+
			"is not behind the redacting core\nfirst entry: %s",
			where, leaked, strings.SplitN(got, "\n", 2)[0])
	}
}

type captureLogExporter struct {
	mu      sync.Mutex
	entries []string
}

func (e *captureLogExporter) Export(_ context.Context, records []sdklog.Record) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i := range records {
		var b strings.Builder
		b.WriteString(records[i].Body().String())
		records[i].WalkAttributes(func(kv attribute.KeyValue) bool {
			fmt.Fprintf(&b, " %s=%s", kv.Key, kv.Value.String())
			return true
		})
		e.entries = append(e.entries, b.String())
	}
	return nil
}
func (e *captureLogExporter) Shutdown(context.Context) error   { return nil }
func (e *captureLogExporter) ForceFlush(context.Context) error { return nil }

func TestHostLogPipelineRedactsProviderErrorText(t *testing.T) {
	err := leakingProviderError()
	requireSecretsRecognised(t, err.Error())

	logDir := t.TempDir()
	exp := &captureLogExporter{}
	res, rerr := NewResource("test", "abc", "today", false)
	require.NoError(t, rerr)
	provider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewSimpleProcessor(exp)),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

	zl, _, berr := buildZapLogger(false, provider, "debug", logDir)
	require.NoError(t, berr)

	// Same shape as controller.go CheckConnection / auto-connect: a plugin
	// error under the "error" key, plus a status string under "details".
	host := logging.New(logging.Config{
		Name:    "omniview",
		Backend: NewZapBackend(zl),
		Level:   logging.NewLevelController(logging.LevelDebug),
	})
	host.Errorw(context.Background(), "RPC failed", "op", "CheckConnection", "error", err)
	host.Warnw(context.Background(), "auto-connect attempt did not connect", "details", err.Error())
	require.NoError(t, host.Sync(context.Background()))

	raw, rderr := os.ReadFile(filepath.Join(logDir, "omniview.log"))
	require.NoError(t, rderr)
	requireNoSecrets(t, "omniview.log (zap file core)", string(raw))

	exp.mu.Lock()
	defer exp.mu.Unlock()
	require.NotEmpty(t, exp.entries, "OTel core must have shipped the records")
	requireNoSecrets(t, "OTel shipping core", strings.Join(exp.entries, "\n"))
}
