package main

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const WatcherDebounce = 500 * time.Millisecond

// Watcher watches Go source files and triggers rebuilds.
type Watcher struct {
	watcher *fsnotify.Watcher
	cancel  context.CancelFunc
}

// NewWatcher creates a file watcher on the plugin's pkg/ directory.
// The onChange callback is called (debounced) when .go files change.
func NewWatcher(ctx context.Context, pluginDir string, log *Logger, onChange func()) (*Watcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	pkgDir := filepath.Join(pluginDir, "pkg")

	err = filepath.Walk(pkgDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			name := info.Name()
			if name == "vendor" || name == "testdata" || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return fsWatcher.Add(path)
		}
		return nil
	})
	if err != nil {
		fsWatcher.Close()
		return nil, err
	}

	watchCtx, watchCancel := context.WithCancel(ctx)

	w := &Watcher{
		watcher: fsWatcher,
		cancel:  watchCancel,
	}

	go w.run(watchCtx, log, onChange)

	return w, nil
}

func (w *Watcher) run(ctx context.Context, log *Logger, onChange func()) {
	var (
		mu     sync.Mutex
		timers = make(map[string]*time.Timer)
	)

	handleEvent := func(name string) {
		mu.Lock()
		delete(timers, name)
		mu.Unlock()

		onChange()
	}

	for {
		select {
		case <-ctx.Done():
			w.watcher.Close()
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}

			if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) {
				continue
			}
			if filepath.Ext(event.Name) != ".go" {
				continue
			}

			mu.Lock()
			t, ok := timers[event.Name]
			mu.Unlock()

			if !ok {
				t = time.AfterFunc(math.MaxInt64, func() { handleEvent(event.Name) })
				t.Stop()
				mu.Lock()
				timers[event.Name] = t
				mu.Unlock()
			}

			t.Reset(WatcherDebounce)

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Error("Watcher error: %v", err)
		}
	}
}

// Stop shuts down the watcher.
func (w *Watcher) Stop() {
	w.cancel()
}
