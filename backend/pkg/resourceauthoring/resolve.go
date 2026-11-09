package resourceauthoring

import (
	"context"
	"slices"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// tier is one resolved step of an operand path: the catalog's own account of
// the child (presence, nullability, applicability, checking strength) as listed
// by its parent.
type tier struct {
	segment resourcecatalog.PathSegment
	// info is nil when the parent's listing was truncated before the child, so
	// its facts are unknown rather than guessed.
	info *resourcecatalog.FieldInfo
}

// pathResolution is an operand path resolved against the catalog schema.
type pathResolution struct {
	// ok is true when every segment resolved.
	ok    bool
	path  []resourcecatalog.PathSegment
	tiers []tier
	// listing holds the children of the final position.
	listing resourcecatalog.Navigation
	// tooDeep is set when the path exceeds the policy depth.
	tooDeep bool
}

// resolver walks operand paths through resourcecatalog.Navigate, which is the
// only schema walker. Each tier costs one bounded navigation; the depth ceiling
// bounds the total.
type resolver struct {
	ctx      context.Context
	schema   *resourcecatalog.Schema
	policy   resourcecatalog.Policy
	maxDepth int
	navs     map[int]resourcecatalog.Navigation
}

func newResolver(ctx context.Context, schema *resourcecatalog.Schema, policy resourcecatalog.Policy, maxDepth int) *resolver {
	return &resolver{ctx: ctx, schema: schema, policy: policy, maxDepth: maxDepth, navs: map[int]resourcecatalog.Navigation{}}
}

// navigate lists the children at path; the result for a prefix length is cached
// for the request.
func (r *resolver) navigate(path []resourcecatalog.PathSegment) (resourcecatalog.Navigation, error) {
	if cached, ok := r.navs[len(path)]; ok {
		return cached, nil
	}
	nav, err := resourcecatalog.Navigate(r.ctx, r.schema, path, r.policy)
	if err != nil {
		return resourcecatalog.Navigation{}, err
	}
	r.navs[len(path)] = nav
	return nav, nil
}

// doesNotResolve reports the catalog's "schema path does not resolve" outcome,
// which is a normal answer for a draft, not a failure.
func doesNotResolve(err error) bool {
	return err != nil && resourcev2.ErrorCode(err) == "INVALID_REQUEST"
}

func typesContain(types []string, name string) bool { return slices.Contains(types, name) }

// child finds the listed entry a segment addresses.
func child(nav resourcecatalog.Navigation, seg segment, previous *resourcecatalog.FieldInfo) (resourcecatalog.FieldInfo, resourcecatalog.PathSegment, bool) {
	find := func(kind, name string) (resourcecatalog.FieldInfo, bool) {
		for _, entry := range nav.Fields {
			if entry.Segment.Kind == kind && entry.Segment.Name == name {
				return entry, true
			}
		}
		return resourcecatalog.FieldInfo{}, false
	}
	switch seg.kind {
	case "field":
		if entry, ok := find(resourcecatalog.SegmentField, seg.name); ok {
			return entry, resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentField, Name: seg.name}, true
		}
		// An undeclared name on an object with a value schema addresses its map value.
		if entry, ok := find(resourcecatalog.SegmentMapValue, ""); ok {
			return entry, resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentField, Name: seg.name}, true
		}
	case "item":
		if entry, ok := find(resourcecatalog.SegmentItem, ""); ok {
			return entry, resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentItem}, true
		}
	case "index":
		preferItem := true
		if previous != nil {
			array, object := typesContain(previous.Types, "array"), typesContain(previous.Types, "object")
			preferItem = array || !object
		}
		kinds := []string{resourcecatalog.SegmentItem, resourcecatalog.SegmentMapValue}
		if !preferItem {
			kinds = []string{resourcecatalog.SegmentMapValue, resourcecatalog.SegmentItem}
		}
		for _, kind := range kinds {
			if entry, ok := find(kind, ""); ok {
				return entry, resourcecatalog.PathSegment{Kind: kind}, true
			}
		}
	}
	return resourcecatalog.FieldInfo{}, resourcecatalog.PathSegment{}, false
}

// resolve resolves segments against the schema. A path that does not resolve is
// a normal result (ok == false), not an error; only cancellation, limits and
// internal failures are errors.
func (r *resolver) resolve(segments []segment) (pathResolution, error) {
	var out pathResolution
	if len(segments) > r.maxDepth {
		out.tooDeep = true
		return out, nil
	}
	var previous *resourcecatalog.FieldInfo
	for _, seg := range segments {
		if err := r.ctx.Err(); err != nil {
			return out, err
		}
		nav, err := r.navigate(out.path)
		if err != nil {
			return out, err
		}
		entry, concrete, found := child(nav, seg, previous)
		if !found && nav.Truncated {
			// The listing stopped before the child: walk to it directly, and
			// report its facts as unknown instead of inventing them.
			concrete, found = unlisted(seg, previous)
			if found {
				if _, walkErr := r.navigate(append(slices.Clone(out.path), concrete)); walkErr != nil {
					if !doesNotResolve(walkErr) {
						return out, walkErr
					}
					found = false
				}
			}
			if found {
				out.path = append(out.path, concrete)
				out.tiers = append(out.tiers, tier{segment: concrete})
				previous = nil
				continue
			}
		}
		if !found {
			return out, nil
		}
		info := entry
		out.path = append(out.path, concrete)
		out.tiers = append(out.tiers, tier{segment: concrete, info: &info})
		previous = &info
	}
	listing, err := r.navigate(out.path)
	if err != nil {
		if doesNotResolve(err) {
			return out, nil
		}
		return out, err
	}
	out.listing, out.ok = listing, true
	return out, nil
}

// unlisted maps a segment to a navigation step without a listed entry.
func unlisted(seg segment, previous *resourcecatalog.FieldInfo) (resourcecatalog.PathSegment, bool) {
	switch seg.kind {
	case "field":
		return resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentField, Name: seg.name}, true
	case "item":
		return resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentItem}, true
	case "index":
		if previous != nil && typesContain(previous.Types, "object") && !typesContain(previous.Types, "array") {
			return resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentMapValue}, true
		}
		return resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentItem}, true
	}
	return resourcecatalog.PathSegment{}, false
}
