package metric

import (
	"maps"
	"reflect"
	"slices"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// Spans describe evaluated grid points, including source-proven null gaps. A
// missing interval is not a missing sample. Subqueries repeat their boundary
// point because finite range requests require strictly ordered bounds.
type finiteRangeSpan struct {
	start, end time.Time
}

func finiteQuerySpan(q sdk.ResourceMetricsQuery) finiteRangeSpan {
	return finiteRangeSpan{q.StartTime, q.StartTime.Add(q.EndTime.Sub(q.StartTime) / q.Step * q.Step)}
}

func finiteIntersectSpan(a, b finiteRangeSpan) (finiteRangeSpan, bool) {
	if b.start.After(a.start) {
		a.start = b.start
	}
	if b.end.Before(a.end) {
		a.end = b.end
	}
	return a, !a.end.Before(a.start)
}

func finiteCompatibleGrid(a, b finiteRangeSpan, step time.Duration) bool {
	if _, overlaps := finiteIntersectSpan(a, b); !overlaps || step <= 0 {
		return false
	}
	// Overlapping valid finite domains are at most 62 days apart, so Sub does
	// not saturate even when the absolute dates are outside UnixNano's range.
	return a.start.Sub(b.start)%step == 0
}

func finiteAddCoverage(spans []finiteRangeSpan, span finiteRangeSpan, step time.Duration) []finiteRangeSpan {
	spans = append(spans, span)
	slices.SortFunc(spans, func(a, b finiteRangeSpan) int { return a.start.Compare(b.start) })
	kept := spans[:0]
	for _, next := range spans {
		if len(kept) > 0 && !next.start.After(kept[len(kept)-1].end.Add(step)) {
			if next.end.After(kept[len(kept)-1].end) {
				kept[len(kept)-1].end = next.end
			}
		} else {
			kept = append(kept, next)
		}
	}
	return kept
}

func finiteSpanNeeded(spans []finiteRangeSpan, span finiteRangeSpan, step time.Duration) bool {
	cursor := span.start
	for _, covered := range spans {
		if covered.end.Before(cursor) {
			continue
		}
		if covered.start.After(cursor) {
			return true
		}
		if !covered.end.Before(span.end) {
			return false
		}
		cursor = covered.end.Add(step)
	}
	return !cursor.After(span.end)
}

// nextFiniteRangeLocked finds only the first hole. It scans at most 64 completed
// spans and four active jobs without allocating a second work/sample cache.
func (f *finiteCoordinator) nextFiniteRangeLocked(w *finiteWaiter, pair finitePair, includeJobs bool) (finiteRangeSpan, bool) {
	domain := finiteQuerySpan(w.query)
	cursor, cursorCovered := domain.start, false
	for {
		extended, next := cursor, domain.end
		visit := func(span finiteRangeSpan) {
			if span.end.Before(cursor) || span.start.After(domain.end) {
				return
			}
			if !span.start.After(cursor) {
				cursorCovered = true
				if span.end.After(extended) {
					extended = span.end
				}
			} else if cursorCovered && !span.start.After(cursor.Add(w.query.Step)) {
				if span.end.After(extended) {
					extended = span.end
				}
			} else if span.start.Before(next) {
				next = span.start
			}
		}
		for _, covered := range w.rangeCoverage[pair] {
			visit(covered)
		}
		if includeJobs {
			for job := range f.jobs {
				if job.retired || !job.rangeReuse || job.partition != w.partition || !job.pairs[pair] || job.configuration != w.configuration || job.epoch != w.epoch || job.sourceEpoch != w.sourceEpoch {
					continue
				}
				span := finiteQuerySpan(job.query)
				if !finiteCompatibleGrid(domain, span, w.query.Step) {
					continue
				}
				span, _ = finiteIntersectSpan(domain, span)
				if finiteSpanNeeded(w.rangeCoverage[pair], span, w.query.Step) {
					job.waiters[w] = true
					visit(span)
				}
			}
		}
		if cursorCovered && !extended.Before(domain.end) {
			return finiteRangeSpan{}, false
		}
		if extended.After(cursor) {
			cursor, cursorCovered = extended, true
			continue
		}
		return finiteRangeSpan{cursor, next}, true
	}
}

func finiteRangeQuery(q sdk.ResourceMetricsQuery, span finiteRangeSpan) sdk.ResourceMetricsQuery {
	start, end := q.StartTime, q.EndTime
	q.StartTime, q.EndTime = span.start, span.end
	if !q.EndTime.After(q.StartTime) {
		// Repeat one neighboring boundary, never extend outside the requested
		// domain. A sub-step domain retains its original positive wire bounds.
		if end.After(span.end) {
			q.EndTime = minFiniteTime(end, span.end.Add(q.Step))
		} else {
			q.StartTime = maxFiniteTime(start, span.start.Add(-q.Step))
		}
	}
	return q
}

func minFiniteTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func finitePureRangeResult(result sdk.ResourceMetricResult, span finiteRangeSpan, step time.Duration) bool {
	if result.Status != "ok" || result.Value != nil || result.ObservedAt != nil || result.Window != 0 {
		return false
	}
	for _, point := range result.Points {
		if point.Time.Sub(span.start)%step != 0 {
			return false
		}
	}
	return true
}

func finiteClipRangeResult(result sdk.ResourceMetricResult, span finiteRangeSpan) sdk.ResourceMetricResult {
	first, last := 0, len(result.Points)
	for first < last && result.Points[first].Time.Before(span.start) {
		first++
	}
	for last > first && result.Points[last-1].Time.After(span.end) {
		last--
	}
	result.Points = result.Points[first:last]
	return result
}

func finiteMergeRangeResult(current, incoming sdk.ResourceMetricResult, preferIncoming bool) (sdk.ResourceMetricResult, error) {
	if current.Status == "" || current.Status == "missing" {
		return incoming, nil
	}
	if incoming.Status == "missing" {
		return current, nil
	}
	if current.Status != "ok" || incoming.Status != "ok" {
		return incoming, nil
	}
	if current.IdentityScope != incoming.IdentityScope || !maps.Equal(current.Dimensions, incoming.Dimensions) || !reflect.DeepEqual(current.Source, incoming.Source) || current.Window != incoming.Window || !reflect.DeepEqual(current.ObservedAt, incoming.ObservedAt) {
		return sdk.ResourceMetricResult{}, finiteError("INVALID_REQUEST", "Range result identity changed while combining coverage.")
	}
	points := make([]sdk.ResourceMetricPoint, 0, len(current.Points)+len(incoming.Points))
	a, b := 0, 0
	for a < len(current.Points) && b < len(incoming.Points) {
		switch current.Points[a].Time.Compare(incoming.Points[b].Time) {
		case -1:
			points = append(points, current.Points[a])
			a++
		case 1:
			points = append(points, incoming.Points[b])
			b++
		default:
			if preferIncoming {
				points = append(points, incoming.Points[b])
			} else {
				points = append(points, current.Points[a])
			}
			a++
			b++
		}
	}
	points = append(points, current.Points[a:]...)
	points = append(points, incoming.Points[b:]...)
	if preferIncoming {
		incoming.Points = points
		return incoming, nil
	}
	current.Points = points
	return current, nil
}

func finiteRangeReuseAllowed(q sdk.ResourceMetricsQuery, catalog *sdk.ResourceMetricsCatalog) bool {
	if q.Shape != "range" {
		return false
	}
	for _, id := range q.MetricIDs {
		allowed := false
		for _, descriptor := range catalog.Metrics {
			if descriptor.ID == id {
				allowed = descriptor.RangeReuse
				break
			}
		}
		if !allowed {
			return false
		}
	}
	return len(q.MetricIDs) > 0
}

func (f *finiteCoordinator) applyRangeCacheLocked(w *finiteWaiter, entry finiteCacheEntry) error {
	if !entry.rangeReuse {
		return nil
	}
	query := w.query
	query.StartTime, query.EndTime = entry.start, entry.end
	cached, requested := finiteQuerySpan(query), finiteQuerySpan(w.query)
	if !finiteCompatibleGrid(cached, requested, query.Step) {
		return nil
	}
	span, _ := finiteIntersectSpan(cached, requested)
	exact := entry.start.Equal(w.query.StartTime) && entry.end.Equal(w.query.EndTime)
	for pair := range w.pairs {
		if w.done[pair] {
			continue
		}
		result, ok := entry.pairs[pair]
		if !ok {
			continue
		}
		pure := finitePureRangeResult(result, cached, query.Step)
		if exact && (!entry.complete || !pure) {
			// Preserve exact-domain negative and incomplete reuse. Neither can
			// establish pointwise coverage of another domain.
			w.results[pair] = result
			w.done[pair] = true
			w.missing--
			w.complete = w.complete && entry.complete
		} else {
			if !entry.complete || !pure || !finiteSpanNeeded(w.rangeCoverage[pair], span, query.Step) {
				continue
			}
			result = finiteClipRangeResult(result, span)
			merged, err := finiteMergeRangeResult(w.results[pair], result, false)
			if err != nil {
				return err
			}
			w.results[pair] = merged
			w.rangeCoverage[pair] = finiteAddCoverage(w.rangeCoverage[pair], span, query.Step)
			if _, missing := f.nextFiniteRangeLocked(w, pair, false); !missing {
				w.done[pair] = true
				w.missing--
			}
		}
		if w.cachedPairs == nil {
			w.cachedPairs = map[finitePair]bool{}
		}
		w.cachedPairs[pair] = true
		w.warnings = mergeFiniteWarnings(w.warnings, entry.warnings)
	}
	return nil
}

func (f *finiteCoordinator) acceptRangeResultLocked(w *finiteWaiter, job *finiteJob, pair finitePair, result sdk.ResourceMetricResult, present, complete bool) error {
	if !present {
		w.complete = false
		w.done[pair] = true
		w.missing--
		return nil
	}
	if result.Status != "ok" && result.Status != "missing" {
		// A failed subrange cannot be presented as a successful whole range.
		w.results[pair] = result
		w.done[pair] = true
		w.missing--
		return nil
	}
	domain, incoming := finiteQuerySpan(w.query), finiteQuerySpan(job.query)
	span, overlaps := finiteIntersectSpan(domain, incoming)
	if !overlaps {
		return nil
	}
	if result.Status == "ok" && !finitePureRangeResult(result, incoming, w.query.Step) {
		return finiteError("INVALID_REQUEST", "Range reuse requires pure, aligned point series.")
	}
	result = finiteClipRangeResult(result, span)
	merged, err := finiteMergeRangeResult(w.results[pair], result, true)
	if err != nil {
		return err
	}
	w.results[pair] = merged
	if complete {
		w.rangeCoverage[pair] = finiteAddCoverage(w.rangeCoverage[pair], span, w.query.Step)
	}
	if _, missing := f.nextFiniteRangeLocked(w, pair, false); !missing || !complete {
		w.done[pair] = true
		w.missing--
	}
	return nil
}

func (f *finiteCoordinator) progressWaiterLocked(w *finiteWaiter) {
	if w.progress != nil && !w.finished && w.missing > 0 && len(w.results) > 0 {
		// Queue a signal, not another retained sample snapshot. The reader
		// assembles the latest immutable projection under the coordinator lock.
		select {
		case w.progress <- struct{}{}:
		default:
		}
	}
}
