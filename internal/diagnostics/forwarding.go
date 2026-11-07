package diagnostics

import (
	"context"
	"os"
	"strconv"
	"time"
)

func resolveRemoteInterval(explicit time.Duration) time.Duration {
	if explicit > 0 {
		return explicit
	}
	milliseconds, err := strconv.ParseInt(os.Getenv("OTEL_METRIC_EXPORT_INTERVAL"), 10, 64)
	if err == nil && milliseconds > 0 && milliseconds <= int64((1<<63-1)/time.Millisecond) {
		return time.Duration(milliseconds) * time.Millisecond
	}
	return time.Minute
}

// forward owns the remote timer. The SDK still collects exactly once per local tick.
// Intermediate cumulative measurements replace one owned pending snapshot.
func (s *Service) forward(ctx context.Context) {
	defer close(s.done)
	timer := time.NewTimer(time.Hour)
	timer.Stop()
	defer timer.Stop()
	var timerC <-chan time.Time
	var lastSent time.Time
	stopTimer := func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timerC = nil
	}
	send := func(exportCtx context.Context) (bool, error) {
		sent, err := s.forwardLatest(exportCtx)
		if sent {
			lastSent = time.Now()
		}
		return sent, err
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.notify:
			delay := time.Until(lastSent.Add(s.opts.RemoteInterval))
			if lastSent.IsZero() || delay <= 0 {
				stopTimer()
				exportCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
				_, _ = send(exportCtx)
				cancel()
			} else if timerC == nil {
				timer.Reset(delay)
				timerC = timer.C
			}
		case <-timerC:
			timerC = nil
			exportCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			_, _ = send(exportCtx)
			cancel()
		case job := <-s.queue:
			sent, err := send(job.ctx)
			if sent {
				stopTimer()
			}
			s.mu.RLock()
			remote := s.remote
			s.mu.RUnlock()
			if err == nil && remote != nil {
				err = remote.ForceFlush(job.ctx)
			}
			s.mu.Lock()
			if err == nil {
				err = s.remoteFailure
			}
			s.remoteFailure = nil
			s.mu.Unlock()
			job.flush <- err
		}
	}
}
func (s *Service) forwardLatest(ctx context.Context) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	s.mu.Lock()
	data, remote := s.pending, s.remote
	if s.remoteDisabled || remote == nil || data == nil {
		s.mu.Unlock()
		return false, nil
	}
	s.pending = nil
	s.mu.Unlock()
	err := remote.Export(ctx, data)
	if err != nil {
		s.mu.Lock()
		s.health.RemoteErrors++
		s.remoteFailure = failure("storage", "remote metric export failed")
		s.mu.Unlock()
	}
	return true, err
}
