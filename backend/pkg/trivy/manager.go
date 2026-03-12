package trivy

import (
	"context"
	"time"

	"github.com/google/uuid"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// Manager manages terminal sessions, allowing creation, attachment, and more.
type Manager struct {
	log logging.Logger
}

// NewManager initializes a new Manager instance, which allows managing reports and scanning.
func NewManager(log logging.Logger) *Manager {
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
		m.log.Errorw(context.Background(), "error while running trivy scan", "error", err)
		return ScanResult{}, err
	}
	return ScanResult{
		ID:        uuid.New().String(),
		Timestamp: time.Now(),
		Command:   command,
		Result:    result,
	}, nil
}
