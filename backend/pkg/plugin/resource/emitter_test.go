package resource

import "testing"

func TestAppEmitter_ImplementsInterface(t *testing.T) {
	var _ EventEmitter = (*appEmitter)(nil)
}

func TestRecordingEmitter_ImplementsInterface(t *testing.T) {
	var _ EventEmitter = (*recordingEmitter)(nil)
}

func TestNoopEmitter_ImplementsInterface(t *testing.T) {
	var _ EventEmitter = NoopEmitter{}
}
