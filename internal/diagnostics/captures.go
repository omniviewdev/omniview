package diagnostics

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func validID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}
func (s *Service) load() error {
	if s.opts.Directory == "" {
		return fmt.Errorf("diagnostics capture directory required")
	}
	if err := os.MkdirAll(s.opts.Directory, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(s.opts.Directory)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("unsafe diagnostics directory")
	}
	if err = os.Chmod(s.opts.Directory, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(s.opts.Directory)
	if err != nil {
		return err
	}
	var total int64
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !strings.HasSuffix(entry.Name(), ".json") || !validID(id) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Size() > 8<<20 {
			return fmt.Errorf("unsafe capture file")
		}
		total += info.Size()
		if total > 64<<20 || len(s.captures) >= 20 {
			return fmt.Errorf("capture storage exceeds limit")
		}
		path := filepath.Join(s.opts.Directory, entry.Name())
		if err := os.Chmod(path, 0600); err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var c Capture
		if err = json.Unmarshal(data, &c); err != nil {
			return fmt.Errorf("invalid capture %s: %w", id, err)
		}
		if c.ID != id || c.SchemaVersion != SchemaVersion {
			return fmt.Errorf("capture identity or schema mismatch")
		}
		if len(c.Samples) > 302 || c.DurationSeconds < 1 || c.DurationSeconds > 300 {
			return fmt.Errorf("capture samples or duration exceeds limit")
		}
		if c.Status == "running" {
			c.Status = "interrupted"
			c.Error = "application stopped before capture completed"
			c.Coverage.Complete = false
			if err = s.persist(&c); err != nil {
				return err
			}
		}
		s.captures[id] = &c
	}
	return nil
}
func (s *Service) persist(c *Capture) error {
	c.SchemaVersion = SchemaVersion
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if len(data) > 8<<20 {
		return fmt.Errorf("capture exceeds 8 MiB limit")
	}
	entries, err := os.ReadDir(s.opts.Directory)
	if err != nil {
		return err
	}
	total := int64(len(data))
	for _, entry := range entries {
		if entry.Name() == c.ID+".json" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			total += info.Size()
		}
	}
	if total > 64<<20 {
		return fmt.Errorf("capture storage exceeds 64 MiB limit")
	}
	f, err := os.CreateTemp(s.opts.Directory, ".capture-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(s.opts.Directory, c.ID+".json"))
}
func (s *Service) StartCapture(r CaptureRequest) (Capture, error) {
	if len(r.Name) > 80 || strings.TrimSpace(r.Name) == "" || len(r.Workload) > 120 {
		return Capture{}, failure("invalid_request", "name must contain 1–80 characters; workload at most 120")
	}
	if r.DurationSeconds < 1 || r.DurationSeconds > 300 {
		return Capture{}, failure("invalid_request", "duration must be 1–300 seconds")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Capture{}, failure("closed", "diagnostics closed")
	}
	running := 0
	for _, c := range s.captures {
		if c.Status == "running" {
			running++
		}
	}
	if running >= 2 {
		return Capture{}, failure("capacity", "two captures already running")
	}
	if len(s.captures) >= 20 {
		return Capture{}, failure("capacity", "capture limit reached (20)")
	}
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return Capture{}, err
	}
	now := time.Now()
	c := &Capture{ID: hex.EncodeToString(bytes), Name: r.Name, Workload: r.Workload, Status: "running", Identity: s.opts.Identity, StartedAt: now, DurationSeconds: r.DurationSeconds, Samples: []Snapshot{}, Coverage: Health{Complete: true}}
	if err := s.persist(c); err != nil {
		return Capture{}, err
	}
	s.captures[c.ID] = c
	s.timers[c.ID] = time.AfterFunc(time.Duration(r.DurationSeconds)*time.Second+3*s.opts.Interval, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.timers, c.ID)
		if s.closed || c.Status != "running" {
			return
		}
		c.ElapsedSeconds = sampledElapsed(c)
		c.EndedAt = time.Now()
		c.Status = "incomplete"
		c.Coverage.Complete = false
		c.Error = "capture deadline reached without endpoint collection"
		if err := s.persist(c); err != nil {
			c.Status = "error"
			c.Error = "capture persistence failed"
		}
	})
	return clone(*c), nil
}
func (s *Service) GetCapture(id string) (Capture, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if capture, ok := s.captures[id]; ok {
		return clone(*capture), nil
	}
	var found *Capture
	for _, capture := range s.captures {
		if capture.Name != id {
			continue
		}
		if found != nil {
			return Capture{}, failure("conflict", "capture name is ambiguous; use its ID")
		}
		found = capture
	}
	if found == nil {
		return Capture{}, failure("not_found", "capture not found")
	}
	return clone(*found), nil
}
func (s *Service) ListCaptures() []CaptureSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]CaptureSummary, 0, len(s.captures))
	for _, c := range s.captures {
		out = append(out, CaptureSummary{
			SchemaVersion: c.SchemaVersion, ID: c.ID, Name: c.Name, Workload: c.Workload, Status: c.Status,
			Identity: c.Identity, StartedAt: c.StartedAt, EndedAt: c.EndedAt, DurationSeconds: c.DurationSeconds,
			ElapsedSeconds: c.ElapsedSeconds, SampleCount: len(c.Samples), Coverage: c.Coverage, Error: c.Error,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}
func (s *Service) CancelCapture(id string) (Capture, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.captures[id]
	if !ok {
		return Capture{}, failure("not_found", "capture not found")
	}
	if c.Status == "running" {
		s.stopTimer(id)
		c.Status = "canceled"
		c.EndedAt = time.Now()
		c.ElapsedSeconds = sampledElapsed(c)
		c.Coverage.Complete = false
		if err := s.persist(c); err != nil {
			return Capture{}, err
		}
	}
	return clone(*c), nil
}
