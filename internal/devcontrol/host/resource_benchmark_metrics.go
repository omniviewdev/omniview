//go:build devcontrol

package host

// Explicitly opt-in measurement controls, not a public API or production service.
import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type resourceBenchmarkRequest struct {
	Operation   string `json:"operation"`
	WorkspaceID string `json:"workspaceID"`
	Generation  string `json:"generation"`
}
type resourceBenchmarkSnapshot struct {
	WorkspaceID         string                             `json:"workspaceID"`
	Generation          string                             `json:"generation"`
	StateRoot           string                             `json:"stateRoot"`
	Process             devcontract.ProcessIdentity        `json:"process"`
	HostCommit          string                             `json:"hostCommit"`
	Repositories        []devcontract.RepositoryResolution `json:"repositories"`
	At                  time.Time                          `json:"at"`
	ForcedGC            bool                               `json:"forcedGC"`
	SamplingNanos       int64                              `json:"samplingNanos"`
	HeapAlloc           uint64                             `json:"heapAlloc"`
	HeapInuse           uint64                             `json:"heapInuse"`
	HeapObjects         uint64                             `json:"heapObjects"`
	TotalAlloc          uint64                             `json:"totalAlloc"`
	Mallocs             uint64                             `json:"mallocs"`
	Frees               uint64                             `json:"frees"`
	NumGC               uint32                             `json:"numGC"`
	PauseTotalNs        uint64                             `json:"pauseTotalNs"`
	Goroutines          int                                `json:"goroutines"`
	BackgroundListeners *resourceBenchmarkListeners        `json:"backgroundListeners,omitempty"`
}
type resourceBenchmarkMetrics struct {
	listener   *net.UnixListener
	path       string
	inode      os.FileInfo
	descriptor devcontract.InstanceDescriptor
	cancel     context.CancelFunc
	once       sync.Once
	closeErr   error
	done       chan struct{}
	started    bool
}

type resourceBenchmarkListeners struct {
	Available          bool           `json:"available"`
	Reason             string         `json:"reason,omitempty"`
	Truncated          bool           `json:"truncated"`
	GoroutinesProfiled int            `json:"goroutinesProfiled"`
	MatchedFunctions   map[string]int `json:"matchedFunctions,omitempty"`
	UnmatchedFunctions []string       `json:"unmatchedFunctions,omitempty"`
}

// Counts blocked host listener goroutines, NOT transport-open streams. Only
// explicit retention snapshots pay the bounded runtime profile/stack walk cost.
func resourceBenchmarkBackgroundListeners() *resourceBenchmarkListeners {
	observation := &resourceBenchmarkListeners{MatchedFunctions: make(map[string]int)}
	count, _ := runtime.GoroutineProfile(nil)
	const maxGoroutines = 4096
	if count > maxGoroutines {
		observation.Truncated = true
		observation.Reason = "runtime goroutine count exceeds bounded profile capacity4096"
		return observation
	}
	records := make([]runtime.StackRecord, min(count+32, maxGoroutines))
	count, complete := runtime.GoroutineProfile(records)
	if !complete {
		observation.Truncated = true
		observation.Reason = "goroutine growth exceeded one bounded profile attempt; no counts inferred"
		return observation
	}
	observation.GoroutinesProfiled = count
	names := []string{
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource.(*controller).listenForWatchEvents",
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource.(*controller).listenForConnectionEvents",
	}
	for _, record := range records[:count] {
		stack := record.Stack()
		if len(stack) == len(record.Stack0) {
			observation.Truncated = true
		}
		frames := runtime.CallersFrames(stack)
		for depth := range 64 {
			frame, more := frames.Next()
			for _, name := range names {
				if frame.Function == name {
					observation.MatchedFunctions[name]++
					break
				}
			}
			if !more {
				break
			}
			if depth == 63 {
				observation.Truncated = true
			}
		}
	}
	for _, name := range names {
		if observation.MatchedFunctions[name] == 0 {
			observation.UnmatchedFunctions = append(observation.UnmatchedFunctions, name)
		}
	}
	observation.Available = len(observation.MatchedFunctions) > 0
	if len(observation.UnmatchedFunctions) > 0 {
		observation.Reason = "unmatched function names mean absent, renamed or truncated frames; not measured zero streams"
	}
	return observation
}

func startResourceBenchmarkMetrics(ctx context.Context, path string, descriptor devcontract.InstanceDescriptor) (*resourceBenchmarkMetrics, error) {
	if path == "" {
		return nil, nil
	}
	if descriptor.Kind != "development" || descriptor.WorkspaceID == "" || descriptor.Generation == "" || descriptor.StateRoot == "" || descriptor.Process.PID != os.Getpid() || descriptor.Process.Role != "host" || descriptor.Process.Source == "" || descriptor.Process.WorkspaceID != descriptor.WorkspaceID || descriptor.Process.Generation != descriptor.Generation {
		return nil, fmt.Errorf("P02 metrics requires verified development host identity")
	}
	// sockaddr_un.sun_path is 104 bytes on Darwin, including the terminating NUL.
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || len(path) > 103 {
		return nil, fmt.Errorf("P02 metrics requires short canonical absolute Unix socket path")
	}
	if err := devsession.ValidatePrivateDirectory(filepath.Dir(path)); err != nil {
		return nil, fmt.Errorf("P02 metrics parent: %w", err)
	}
	parent, err := os.Lstat(filepath.Dir(path))
	if err != nil || parent.Mode().Perm() != 0700 {
		return nil, fmt.Errorf("P02 metrics parent must be private0700")
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return nil, fmt.Errorf("P02 metrics refuses existing or unreadable socket path")
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	listener.SetUnlinkOnClose(false)
	inode, err := os.Lstat(path)
	if err != nil {
		listener.Close()
		return nil, err
	}
	samplerCtx, cancel := context.WithCancel(ctx)
	sampler := &resourceBenchmarkMetrics{listener: listener, path: path, inode: inode, descriptor: descriptor, cancel: cancel, done: make(chan struct{})}
	if err := os.Chmod(path, 0600); err != nil {
		sampler.Close()
		return nil, err
	}
	// Validate the parent again before publishing, without ever adopting/replacing it.
	after, err := os.Lstat(filepath.Dir(path))
	if err != nil || !os.SameFile(parent, after) {
		sampler.Close()
		return nil, fmt.Errorf("P02 metrics parent changed during listen")
	}
	sampler.started = true
	go sampler.serve(samplerCtx)
	go func() { <-samplerCtx.Done(); _ = sampler.Close() }()
	return sampler, nil
}

func (s *resourceBenchmarkMetrics) serve(ctx context.Context) {
	defer close(s.done)
	for {
		conn, err := s.listener.AcceptUnix()
		if err != nil {
			return
		}
		// One finite request at a time. A slow client cannot retain the connection.
		_ = conn.SetDeadline(time.Now().Add(time.Second))
		line, readErr := bufio.NewReader(io.LimitReader(conn, 257)).ReadBytes('\n')
		if readErr == nil && len(line) <= 256 && ctx.Err() == nil {
			var request resourceBenchmarkRequest
			decoder := json.NewDecoder(bytes.NewReader(line))
			decoder.DisallowUnknownFields()
			err := decoder.Decode(&request)
			var extra any
			trailing := decoder.Decode(&extra)
			if err == nil && trailing == io.EOF && request.WorkspaceID == s.descriptor.WorkspaceID && request.Generation == s.descriptor.Generation && (request.Operation == "snapshot" || request.Operation == "gc-snapshot") {
				started := time.Now()
				forcedGC := request.Operation == "gc-snapshot"
				if forcedGC {
					runtime.GC()
				}
				var mem runtime.MemStats
				runtime.ReadMemStats(&mem)
				sample := resourceBenchmarkSnapshot{WorkspaceID: s.descriptor.WorkspaceID, Generation: s.descriptor.Generation, StateRoot: s.descriptor.StateRoot, Process: s.descriptor.Process, At: time.Now(), ForcedGC: forcedGC, SamplingNanos: time.Since(started).Nanoseconds(), HeapAlloc: mem.HeapAlloc, HeapInuse: mem.HeapInuse, HeapObjects: mem.HeapObjects, TotalAlloc: mem.TotalAlloc, Mallocs: mem.Mallocs, Frees: mem.Frees, NumGC: mem.NumGC, PauseTotalNs: mem.PauseTotalNs, Goroutines: runtime.NumGoroutine()}
				sample.HostCommit = s.descriptor.Commit
				sample.Repositories = s.descriptor.Repositories
				if forcedGC {
					sample.BackgroundListeners = resourceBenchmarkBackgroundListeners()
				}
				sample.SamplingNanos = time.Since(started).Nanoseconds()
				payload, marshalErr := json.Marshal(sample)
				if marshalErr == nil && len(payload) < 8192 {
					_, _ = conn.Write(append(payload, '\n'))
				}
			}
		}
		_ = conn.Close()
	}
}

func (s *resourceBenchmarkMetrics) Close() error {
	if s == nil {
		return nil
	}
	s.once.Do(func() {
		s.cancel()
		if err := s.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			s.closeErr = err
		}
		current, err := os.Lstat(s.path)
		if err == nil {
			if !os.SameFile(s.inode, current) || current.Mode()&os.ModeSocket == 0 {
				s.closeErr = errors.Join(s.closeErr, fmt.Errorf("P02 metrics cleanup refuses replaced socket"))
				return
			}
			s.closeErr = errors.Join(s.closeErr, os.Remove(s.path))
		} else if !os.IsNotExist(err) {
			s.closeErr = errors.Join(s.closeErr, err)
		}
	})
	if s.started {
		<-s.done
	}
	return s.closeErr
}
