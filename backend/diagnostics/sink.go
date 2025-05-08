package diagnostics

import "gopkg.in/natefinch/lumberjack.v2"

type lumberjackSink struct {
	*lumberjack.Logger
}

func (lumberjackSink) Sync() error {
	return nil
}
