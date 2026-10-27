//go:build e2eapplication

package devworkspace

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"testing/synctest"
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

func TestApplicationProducerObserverRevokesRetainedCallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "late-producer-output")
	var retained func() error
	err := observeApplicationProducer("consumer", func(_ string, run func() error) error {
		retained = run
		return nil
	}, func() error {
		return os.WriteFile(path, []byte("unowned late work"), 0600)
	})
	if err == nil {
		t.Fatal("observer skipped the producer without failing")
	}
	if err = retained(); err == nil {
		t.Error("retained callback admitted a producer after observation returned")
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("late callback produced output after ownership returned", err)
	}
}

func TestApplicationProducerObserverJoinsAdmittedAsyncFailure(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		entered := make(chan struct{})
		release := make(chan struct{})
		callbackDone := make(chan error, 1)
		helperDone := make(chan error, 1)
		failed := errors.New("admitted asynchronous producer failed")
		go func() {
			helperDone <- observeApplicationProducer("consumer", func(_ string, run func() error) error {
				go func() { callbackDone <- run() }()
				<-entered
				return nil
			}, func() error {
				close(entered)
				<-release
				return failed
			})
		}()
		<-entered
		synctest.Wait()
		var helperErr error
		early := false
		select {
		case helperErr = <-helperDone:
			early = true
		default:
		}
		close(release)
		if !early {
			helperErr = <-helperDone
		}
		callbackErr := <-callbackDone
		if early {
			t.Error("observer helper returned before its admitted execution joined")
		}
		if !errors.Is(helperErr, failed) || !errors.Is(callbackErr, failed) {
			t.Fatalf("admitted failure was lost: helper=%v callback=%v", helperErr, callbackErr)
		}
	})
}

func TestApplicationProducerObserverRetainsConcurrentDuplicateAndProducerErrors(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	failed := errors.New("actual producer failed")
	var duplicateErr error
	err := observeApplicationProducer("consumer", func(_ string, run func() error) error {
		done := make(chan error, 1)
		go func() { done <- run() }()
		<-entered
		duplicateErr = run()
		close(release)
		<-done
		return nil
	}, func() error {
		close(entered)
		<-release
		return failed
	})
	if duplicateErr == nil || !errors.Is(err, duplicateErr) || !errors.Is(err, failed) {
		t.Fatalf("concurrent duplicate suppressed a failure: duplicate=%v helper=%v", duplicateErr, err)
	}
}

func TestApplicationProducerObserverRetainsAbandonedExecutionUncertainty(t *testing.T) {
	entered := make(chan struct{})
	err := observeApplicationProducer("consumer", func(_ string, run func() error) error {
		go func() { _ = run() }()
		<-entered
		return nil
	}, func() error {
		close(entered)
		runtime.Goexit()
		return nil
	})
	if !errors.Is(err, errOwnedCommandUncertain) {
		t.Fatalf("abandoned execution authorized successful writer release: %v", err)
	}
}
