package metric

import (
	"maps"
	"reflect"
	"slices"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// Spans describe evaluated grid points, including source-proven null gaps. A
// missing interval is not a missing sample. A complete contribution settles
// every grid point of its span: points it omits are absent, not unknown, and no
// older contribution may restore them. Subqueries repeat their boundary point
// because finite range requests require strictly ordered bounds.
type finiteRangeSpan struct {
	start, end time.Time
}

func finiteQuerySpan(q sdk.ResourceMetricsQuery) finiteRangeSpan {
	steps := int64(q.EndTime.Sub(q.StartTime) / q.Step)
	return finiteRangeSpan{q.StartTime, q.StartTime.Add(time.Duration(steps) * q.Step)}
}

// finiteNoSpan is the span returned beside a result that has no span to report.
func finiteNoSpan() finiteRangeSpan {
	return finiteRangeSpan{start: time.Time{}, end: time.Time{}}
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
// Every active job it counts as coverage also keeps w attached, so cancelling
// another reader cannot retire work that w now relies on.
func (f *finiteCoordinator) nextFiniteRangeLocked(w *finiteWaiter, pair finitePair, includeJobs bool) (finiteRangeSpan, bool) {
	return f.finiteRangeHoleLocked(w, pair, includeJobs, finiteQuerySpan(w.query).start, false)
}

// finiteRangeHoleLocked finds the first hole at or after cursor. A true
// cursorCovered says the cursor point is already evaluated, as the end of an
// earlier hole is.
func (f *finiteCoordinator) finiteRangeHoleLocked(
	w *finiteWaiter, pair finitePair, includeJobs bool, cursor time.Time, cursorCovered bool,
) (finiteRangeSpan, bool) {
	domain := finiteQuerySpan(w.query)
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
			return finiteNoSpan(), false
		}
		if extended.After(cursor) {
			cursor, cursorCovered = extended, true
			continue
		}
		return finiteRangeSpan{cursor, next}, true
	}
}

// finiteRangeQuery returns the wire query for one fetch of span. A fragment is
// limited to its grid points, which already repeat their covered boundaries. A
// fetch of the whole domain keeps the reader's original bounds, so an off-grid
// end remains the exact key for negative and incomplete reuse.
func finiteRangeQuery(q sdk.ResourceMetricsQuery, span finiteRangeSpan) sdk.ResourceMetricsQuery {
	if whole := finiteQuerySpan(q); !span.start.Equal(whole.start) || !span.end.Equal(whole.end) {
		q.StartTime, q.EndTime = span.start, span.end
	}
	return q
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

// finiteExcludeRangeSpans drops points inside any covered span. Covered spans
// must be sorted and disjoint. It copies only when a point is dropped, so a
// series shared with the completed cache is never changed.
func finiteExcludeRangeSpans(result sdk.ResourceMetricResult, covered ...finiteRangeSpan) sdk.ResourceMetricResult {
	kept, copied, next := result.Points, false, 0
	for index, point := range result.Points {
		for next < len(covered) && covered[next].end.Before(point.Time) {
			next++
		}
		if next < len(covered) && !covered[next].start.After(point.Time) {
			if !copied {
				kept = append(make([]sdk.ResourceMetricPoint, 0, len(result.Points)-1), result.Points[:index]...)
				copied = true
			}
			continue
		}
		if copied {
			kept = append(kept, point)
		}
	}
	result.Points = kept
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

func finiteReuseCapabilities(q sdk.ResourceMetricsQuery, catalog *sdk.ResourceMetricsCatalog) (bool, bool) {
	rangeReuse := q.Shape == "range" && len(q.MetricIDs) > 0
	rangeToCurrent, matched := false, 0
	for _, descriptor := range catalog.Metrics {
		if !rangeReuse && !descriptor.RangeToCurrent {
			continue
		}
		for _, id := range q.MetricIDs {
			if descriptor.ID == id {
				matched++
				rangeReuse = rangeReuse && descriptor.RangeReuse
				rangeToCurrent = rangeToCurrent || descriptor.RangeToCurrent
				break
			}
		}
	}
	return rangeReuse && matched == len(q.MetricIDs), rangeToCurrent
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
			// Older entries only fill holes: coverage a newer contribution
			// settled stays final, including the points it omitted.
			result = finiteExcludeRangeSpans(finiteClipRangeResult(result, span), w.rangeCoverage[pair]...)
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

// acceptRangeResultLocked merges one job answer into w. Only a complete ok point
// series says anything beyond the domain its job asked for. Any other answer
// finishes a reader only when the job asked one of that reader's own fetches.
// For a borrower it describes another domain, so the pair stays open and the
// coordinator asks for the reader's own domain instead.
func (f *finiteCoordinator) acceptRangeResultLocked(
	w *finiteWaiter, job *finiteJob, pair finitePair, result sdk.ResourceMetricResult, present, complete bool,
	warnings []string,
) error {
	reusable := present && complete && result.Status == "ok"
	if !reusable && !f.finiteRangeOwnsLocked(w, job, pair) {
		return nil
	}
	w.complete = w.complete && complete && present
	w.warnings = mergeFiniteWarnings(w.warnings, warnings)
	if !present {
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
	current := w.results[pair]
	if complete {
		// A complete answer settles every grid point of its span. Points it
		// omits are absent now and must not return from older contributions.
		current = finiteExcludeRangeSpans(current, span)
	}
	merged, err := finiteMergeRangeResult(current, finiteClipRangeResult(result, span), true)
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

// finiteRangeOwnsLocked reports whether job asks exactly one of the fetches that
// w itself still needs for pair, counting other in-flight work as covered. Only
// then does the job's failure, absence or partial answer describe the reader's
// own domain.
func (f *finiteCoordinator) finiteRangeOwnsLocked(w *finiteWaiter, job *finiteJob, pair finitePair) bool {
	domain := finiteQuerySpan(w.query)
	need, open := f.nextFiniteRangeLocked(w, pair, true)
	for open {
		// Equal grids can still have different off-grid wire ends. Non-ok and
		// incomplete answers describe only the bounds actually sent.
		asked := finiteRangeQuery(w.query, need)
		if asked.StartTime.Equal(job.query.StartTime) && asked.EndTime.Equal(job.query.EndTime) {
			return true
		}
		if !need.end.Before(domain.end) {
			break
		}
		need, open = f.finiteRangeHoleLocked(w, pair, true, need.end, true)
	}
	return false
}

// finiteRangeOwnsAnyLocked reports whether job asks one of w's own fetches for
// any pair that w still needs from it.
func (f *finiteCoordinator) finiteRangeOwnsAnyLocked(w *finiteWaiter, job *finiteJob) bool {
	for pair := range job.pairs {
		if w.pairs[pair] && !w.done[pair] && f.finiteRangeOwnsLocked(w, job, pair) {
			return true
		}
	}
	return false
}

// joinRangeJobsLocked attaches a new reader to every compatible in-flight job
// that supplies part of its open domain. Registration must do this under the
// lock that also guards cancellation: a reader left for the dispatch scan to
// attach can lose the shared provider call when the original reader cancels first.
func (f *finiteCoordinator) joinRangeJobsLocked(w *finiteWaiter) {
	for pair := range w.pairs {
		if !w.done[pair] {
			_, _ = f.nextFiniteRangeLocked(w, pair, true)
		}
	}
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

// applyCurrentRangeCacheLocked only fills pairs not answered by exact current
// reuse. It reads the existing range entries; no promoted sample cache is made.
func (f *finiteCoordinator) applyCurrentRangeCacheLocked(w *finiteWaiter, catalog *sdk.ResourceMetricsCatalog, now time.Time) {
	if w.maxSampleAge <= 0 {
		return
	}
	for _, descriptor := range catalog.Metrics {
		if !descriptor.RangeToCurrent {
			continue
		}
		for target := range w.workTargets {
			pair := finitePair{target, descriptor.ID}
			if !w.pairs[pair] || w.done[pair] {
				continue
			}
			var best sdk.ResourceMetricResult
			var bestEvaluation time.Time
			var warnings []string
			found := false
			for index := len(f.cache) - 1; index >= 0; index-- {
				entry := &f.cache[index]
				if entry.rangeToCurrentKey != w.rangeToCurrentKey || !entry.complete ||
					entry.configuration != w.configuration || entry.epoch != w.epoch ||
					entry.sourceEpoch != w.sourceEpoch || !now.Before(entry.until) {
					continue
				}
				result, exists := entry.pairs[pair]
				if !exists || result.Status != "ok" || result.Value != nil ||
					result.ObservedAt == nil || len(result.Points) == 0 {
					continue
				}
				point := result.Points[len(result.Points)-1]
				if point.Value == nil || point.Time.After(now) || result.ObservedAt.After(point.Time) ||
					!now.Before(result.ObservedAt.Add(w.maxSampleAge)) {
					continue
				}
				if found && (result.ObservedAt.Before(*best.ObservedAt) ||
					(result.ObservedAt.Equal(*best.ObservedAt) && !point.Time.After(bestEvaluation))) {
					continue
				}
				best, bestEvaluation, warnings, found = result, point.Time, entry.warnings, true
			}
			if !found {
				continue
			}
			best.Value = best.Points[len(best.Points)-1].Value
			best.Points = nil
			w.results[pair] = best
			w.done[pair] = true
			w.missing--
			if w.cachedPairs == nil {
				w.cachedPairs = map[finitePair]bool{}
			}
			w.cachedPairs[pair] = true
			w.warnings = mergeFiniteWarnings(w.warnings, warnings)
		}
	}
}
