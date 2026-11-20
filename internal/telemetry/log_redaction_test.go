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

// Defect (plan item H1, log-sink leakage): the host logger pipeline has no
// redacting core. buildZapLogger tees a file core and an OTel shipping core
// straight onto the zap logger, and ZapBackend converts plugin-sdk records
// without scrubbing them. A secret-shaped value inside a provider/plugin error
// that a controller passes as a log field is therefore written verbatim to
// omniview.log and handed to the OTel log exporter.
//
// Fixed looks like: text that devdiag.Redact would change never reaches the
// file core or the OTel core, for string fields, error fields and the message.
// The fix may live in the core, in ZapBackend, or at the call sites; this test
// drives the production construction (buildZapLogger + NewZapBackend), so it
// passes only when the pipeline itself redacts.

// leakSecrets are secret-shaped values the host's own redactor recognises.
var leakSecrets = []string{
	"Authorization: Bearer abc123def456ghi789",
	"password=hunter2",
	"AKIAIOSFODNN7EXAMPLE",
}

// leakingProviderError is what a plugin-origin error looks like once gRPC has
// flattened it to text.
func leakingProviderError() error {
	return errors.New("rpc error: code = Unauthenticated desc = " + strings.Join(leakSecrets, " ; "))
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
		t.Errorf("H1: %s carries secret-shaped values %q verbatim: no redacting core on the host log pipeline\nfirst entry: %s",
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
