package telemetry

import (
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// NewFallbackLogger returns the logger the host uses when telemetry did not start, or
// could not open its log file: the production logger of zap (JSON, info level, the
// first 100 entries of a message in a second and every 100th after that, a stack for
// an error) writing to the paths given, or to stderr when there are none, behind
// NewRedactingCore like every other logger of the host.
//
// zap puts its sampler between the core and the logger, and so outside anything the
// caller wraps the logger's core with afterwards. The sampler is built here instead,
// outside the redactor: an entry it drops is never redacted, and it is the sampler that
// decides what is written whatever core is under it.
func NewFallbackLogger(outputPaths ...string) (*zap.Logger, error) {
	return newFallbackLogger(outputPaths)
}

// newFallbackLogger is NewFallbackLogger with the options of a logger as well.
func newFallbackLogger(outputPaths []string, opts ...zap.Option) (*zap.Logger, error) {
	cfg := zap.NewProductionConfig()
	if len(outputPaths) > 0 {
		cfg.OutputPaths = outputPaths
	}
	// The sampler is not the one Build would put in front of the core.
	sampling := cfg.Sampling
	cfg.Sampling = nil
	wrap := zap.WrapCore(func(core zapcore.Core) zapcore.Core {
		core = NewRedactingCore(core)
		if sampling == nil {
			return core
		}
		return zapcore.NewSamplerWithOptions(core, time.Second, sampling.Initial, sampling.Thereafter)
	})
	return cfg.Build(append([]zap.Option{wrap}, opts...)...)
}
