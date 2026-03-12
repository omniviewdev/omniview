package telemetry

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	otelpyroscope "github.com/grafana/otel-profiling-go"
	"github.com/grafana/pyroscope-go"
	"go.opentelemetry.io/contrib/bridges/otelzap"
	otelruntime "go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

// Service is the top-level telemetry orchestrator. It initialises tracing,
// metrics, log shipping, profiling and a triple-core Zap logger.
type Service struct {
	cfg     TelemetryConfig
	version string
	commit  string
	date    string
	isDev   bool

	resource       *resource.Resource
	tracerProvider *sdktrace.TracerProvider
	meterProvider  *sdkmetric.MeterProvider
	loggerProvider *sdklog.LoggerProvider
	profiler       *pyroscope.Profiler
	zapLogger      *zap.Logger

	mu sync.Mutex
}

// New creates a telemetry Service. Call Init to start it.
func New(cfg TelemetryConfig, version, commit, date string, isDev bool) *Service {
	return &Service{
		cfg:     cfg,
		version: version,
		commit:  commit,
		date:    date,
		isDev:   isDev,
	}
}

// Init bootstraps all configured telemetry subsystems and sets OTel globals.
func (s *Service) Init(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	otel.SetTextMapPropagator(propagation.TraceContext{})

	res, err := NewResource(s.version, s.commit, s.date, s.isDev)
	if err != nil {
		return err
	}
	s.resource = res

	if !s.cfg.Enabled {
		s.zapLogger, err = buildZapLogger(s.isDev, nil)
		return err
	}

	if s.cfg.Traces {
		exp, err := NewTraceExporter(ctx, s.cfg.OTLPEndpoint, s.cfg.AuthHeader, s.cfg.AuthValue)
		if err != nil {
			return err
		}
		s.tracerProvider = NewTracerProvider(s.resource, exp)
		if s.cfg.Profiling && s.cfg.PyroscopeEndpoint != "" {
			otel.SetTracerProvider(otelpyroscope.NewTracerProvider(s.tracerProvider))
		} else {
			otel.SetTracerProvider(s.tracerProvider)
		}
	}

	if s.cfg.Metrics {
		exp, err := NewMetricExporter(ctx, s.cfg.OTLPEndpoint, s.cfg.AuthHeader, s.cfg.AuthValue)
		if err != nil {
			return err
		}
		s.meterProvider = NewMeterProvider(s.resource, exp)
		otel.SetMeterProvider(s.meterProvider)
		if err := otelruntime.Start(otelruntime.WithMinimumReadMemStatsInterval(15 * time.Second)); err != nil {
			return err
		}
	}

	if s.cfg.LogsShip {
		exp, err := NewLogExporter(ctx, s.cfg.OTLPEndpoint, s.cfg.AuthHeader, s.cfg.AuthValue)
		if err != nil {
			return err
		}
		s.loggerProvider = NewLoggerProvider(s.resource, exp)
	}

	s.zapLogger, err = buildZapLogger(s.isDev, s.loggerProvider)
	if err != nil {
		return err
	}

	if s.cfg.Profiling && s.cfg.PyroscopeEndpoint != "" {
		profiler, err := startProfiling(s.version, s.cfg.PyroscopeEndpoint)
		if err != nil {
			return err
		}
		s.profiler = profiler
	}

	return nil
}

// Shutdown gracefully stops all telemetry subsystems, flushing any buffered data.
func (s *Service) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var errs []error
	if s.tracerProvider != nil {
		if err := s.tracerProvider.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if s.meterProvider != nil {
		if err := s.meterProvider.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if s.loggerProvider != nil {
		if err := s.loggerProvider.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if s.profiler != nil {
		if err := s.profiler.Stop(); err != nil {
			errs = append(errs, err)
		}
	}
	if s.zapLogger != nil {
		_ = s.zapLogger.Sync()
	}
	if len(errs) > 0 {
		return errs[0]
	}
	return nil
}

// TracerProvider returns the SDK TracerProvider, or nil when telemetry is disabled.
func (s *Service) TracerProvider() *sdktrace.TracerProvider { return s.tracerProvider }

// LoggerProvider returns the SDK LoggerProvider, or nil when log shipping is disabled.
func (s *Service) LoggerProvider() *sdklog.LoggerProvider { return s.loggerProvider }

// Resource returns the OTel resource describing this Omniview instance.
func (s *Service) Resource() *resource.Resource { return s.resource }

// ZapLogger returns the triple-core Zap logger.
func (s *Service) ZapLogger() *zap.Logger { return s.zapLogger }

// buildZapLogger constructs a Zap logger with up to three cores:
//   - fileCore: JSON logs rotated by lumberjack
//   - consoleCore: human-readable stderr output (dev mode only)
//   - otelCore: OTel log bridge (when loggerProvider is non-nil)
func buildZapLogger(isDev bool, loggerProvider *sdklog.LoggerProvider) (*zap.Logger, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot determine home directory: %w", err)
	}
	logDir := filepath.Join(home, ".omniview", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, err
	}

	fileWriter := &lumberjack.Logger{
		Filename:   filepath.Join(logDir, "omniview.log"),
		MaxSize:    50,
		MaxBackups: 3,
		MaxAge:     14,
	}
	fileEncoder := zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig())
	fileCore := zapcore.NewCore(fileEncoder, zapcore.AddSync(fileWriter), zapcore.DebugLevel)

	cores := []zapcore.Core{fileCore}

	if isDev {
		consoleEncoder := zapcore.NewConsoleEncoder(zap.NewDevelopmentEncoderConfig())
		consoleCore := zapcore.NewCore(consoleEncoder, zapcore.AddSync(os.Stderr), zapcore.DebugLevel)
		cores = append(cores, consoleCore)
	}

	if loggerProvider != nil {
		otelCore := otelzap.NewCore("omniview", otelzap.WithLoggerProvider(loggerProvider))
		cores = append(cores, otelCore)
	}

	return zap.New(zapcore.NewTee(cores...)), nil
}
