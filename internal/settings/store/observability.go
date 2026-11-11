package store

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

//nolint:gochecknoglobals // Package tracer follows the host telemetry convention.
var tracer = otel.Tracer("omniview.settings")

// SetLogger installs the logger used for persistence diagnostics. A nil logger
// falls back to the process default.
func (s *Store) SetLogger(l logging.Logger) {
	if s != nil {
		s.log = l
	}
}

func (s *Store) logger() logging.Logger {
	if s == nil || s.log == nil {
		return logging.Default().Named("settings.store")
	}
	return s.log
}

// persistSave wraps one settings write in a settings.Save span. category and
// pluginID are identifiers; values are never exported or logged, and failures
// are recorded as a class, never as error text.
func (s *Store) persistSave(category, pluginID string, save func() error) error {
	ctx, span := tracer.Start(context.Background(), "settings.Save")
	if category != "" {
		span.SetAttributes(attribute.String("category", category))
	}
	if pluginID != "" {
		span.SetAttributes(attribute.String("plugin_id", pluginID))
	}
	err := save()
	if err == nil {
		span.SetAttributes(attribute.String("outcome", "success"))
		span.End()
		return nil
	}
	class := telemetryutil.ErrorClass(err)
	span.SetAttributes(attribute.String("outcome", "failure"), attribute.String("error_class", class))
	span.SetStatus(codes.Error, class)
	span.End()
	s.logger().Errorw(ctx, "settings persist failed",
		"category", category, "pluginID", pluginID, "errorClass", class,
		"errorType", fmt.Sprintf("%T", err))
	return err
}

// categoryLabel joins category IDs for span attributes.
func categoryLabel(ids []string) string {
	return strings.Join(ids, ",")
}
