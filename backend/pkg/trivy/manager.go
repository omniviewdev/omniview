package trivy

import (
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Manager manages terminal sessions, allowing creation, attachment, and more.
type Manager struct {
	log *zap.SugaredLogger
}

// NewManager initializes a new Manager instance, which allows managing reports and scanning.
func NewManager(log *zap.SugaredLogger) *Manager {
	return &Manager{
		log: log.Named("TrivyManager"),
	}
}

// Scan runs a trivy scan with the given command, target, and options.
func (m *Manager) Scan(
	command Command,
	target string,
	opts ScanOptions,
) (ScanResult, error) {
	result, err := RunTrivyScan(command, target, opts)
	if err != nil {
		m.log.Errorw("error while running trivy scan", "error", err)
		return ScanResult{}, err
	}
	return ScanResult{
		ID:        uuid.New().String(),
		Timestamp: time.Now(),
		Command:   command,
		Result:    result,
	}, nil
}
