//go:build e2eapplication

package devworkspace

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestApplicationProducerObserverCannotSkipRepeatOrSuppressFailure(t *testing.T) {
	for _, mode := range []string{"normal", "skip", "repeat", "suppress-failure"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "actual-producer-output")
			failed := errors.New("actual producer failed")
			produce := func() error {
				file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
				if err != nil {
					return err
				}
				_, writeErr := file.WriteString("produced\n")
				if err = errors.Join(writeErr, file.Close()); err != nil {
					return err
				}
				if mode == "suppress-failure" {
					return failed
				}
				return nil
			}
			observer := func(_ string, run func() error) error {
				switch mode {
				case "skip":
					return nil
				case "repeat":
					_ = run()
					_ = run()
					return nil
				case "suppress-failure":
					_ = run()
					return nil
				default:
					return run()
				}
			}
			err := observeApplicationProducer("consumer", observer, produce)
			if mode == "normal" && err != nil {
				t.Fatal(err)
			}
			if mode != "normal" && err == nil {
				t.Fatal("observer changed actual producer completion")
			}
			if mode == "suppress-failure" && !errors.Is(err, failed) {
				t.Fatal("actual producer error was lost", err)
			}
			raw, readErr := os.ReadFile(path)
			if mode == "skip" {
				if !os.IsNotExist(readErr) {
					t.Fatal("skipped producer produced output", readErr)
				}
			} else if readErr != nil || string(raw) != "produced\n" {
				t.Fatalf("producer was not executed exactly once: %q %v", raw, readErr)
			}
		})
	}
}
