package metric

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

const maxSetResources = 256
const maxSetMetrics = 32
const maxSetChunk = 64
const maxSetResponseBytes = 8 << 20
const maxSetSamples = 50000

// QueryResources is UI-only. ReadResourceSet retains the native caller principal.
func (c *controller) QueryResources(ctx context.Context, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	return c.queryResourceSet(ctx, req, c.uiReferenceAdmitter, false)
}
func (c *controller) ReadResourceSet(ctx context.Context, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	return c.queryResourceSet(ctx, req, c.referenceAdmitter, false)
}
func (c *controller) PreviewMetricDefinition(ctx context.Context, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	return c.queryResourceSet(ctx, req, c.uiReferenceAdmitter, true)
}
func (c *controller) queryResourceSet(ctx context.Context, input sdk.ResourceSetQueryRequest, admit resource.ReferenceAdmitter, preview bool) (*sdk.ResourceSetQueryResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	ctx = resource.WithCatalogSnapshotCache(ctx)
	co := c.queryWork()
	epoch := co.currentEpoch()
	if admit == nil {
		return nil, resourcev2.NewError("UNSUPPORTED", "Resource metric admission is unavailable.")
	}
	if input.ResourcePluginID == "" || input.ResourceConnectionID == "" || len(input.Resources) == 0 || len(input.Resources) > maxSetResources || len(input.MetricIDs) == 0 || len(input.MetricIDs) > maxSetMetrics {
		return nil, resourcev2.NewError("INVALID_REQUEST", "A bounded explicit resource set, owner connection and metric IDs are required.")
	}
	if input.Shape < sdk.ShapeCurrent || input.Shape > sdk.ShapeAggregate {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Unsupported metric shape.")
	}
	if input.Shape != sdk.ShapeCurrent && (input.Step <= 0 || input.StartTime.IsZero() || input.EndTime.Before(input.StartTime) || input.EndTime.Sub(input.StartTime) > 24*time.Hour || input.EndTime.Sub(input.StartTime)/input.Step > 10000) {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Metric range or step exceeds limits.")
	}
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	req := copyJSON(input)
	req.Source = sdk.MetricSourceReference{}
	req.Definitions = nil
	req.PublicScope = nil
	req.MappingRevision = ""
	tokens := map[string]bool{}
	identities := map[string]string{}
	c.mux.RLock()
	identityGuard := c.resourceIdentityGuard
	c.mux.RUnlock()
	if identityGuard == nil {
		return nil, resourcev2.NewError("UNAVAILABLE", "Observed resource identity admission is unavailable.")
	}
	deliveryGuards := make([]observationGuard, 0, len(req.Resources))
	// Admit every identity before resolving or invoking any provider. Only canonical
	// address fields survive; caller data and provider selection never cross here.
	for i := range req.Resources {
		r := &req.Resources[i]
		if r.Token == "" || tokens[r.Token] || r.Reference == nil || r.Route == nil || r.Route.Connection != req.ResourceConnectionID {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Resources require unique tokens, canonical references and the selected owner route.")
		}
		tokens[r.Token] = true
		a := r.Reference.Address
		if a.Provider != req.ResourcePluginID || a.Type != r.ResourceKey || a.ID == "" {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Resource address does not match its owner or type.")
		}
		admitted, err := admit(ctx, "metric.Query", req.ResourcePluginID, *r.Route, *r.Reference)
		if err != nil {
			return nil, err
		}
		ctx = admitted
		guard, err := identityGuard(ctx, "metric.Query", req.ResourcePluginID, *r.Route, *r.Reference)
		if err != nil {
			return nil, err
		}
		if guard == nil {
			return nil, resourcev2.NewError("UNAVAILABLE", "Observed resource identity guard is unavailable.")
		}
		deliveryGuards = append(deliveryGuards, guard)
		r.ResourceID = a.ID
		r.ResourceNamespace = ""
		r.PublicData = nil
		for _, scope := range a.Scope {
			if scope.Dimension == "namespace" {
				r.ResourceNamespace = scope.Value
			}
		}
		stable := resourceIdentity(*r)
		if _, exists := identities[stable]; exists {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Duplicate structural resource identity.")
		}
		identities[stable] = r.Token
		r.Token = stable
	}
	sort.Slice(req.Resources, func(i, j int) bool { return req.Resources[i].Token < req.Resources[j].Token })
	sort.Strings(req.MetricIDs)
	for i, id := range req.MetricIDs {
		if id == "" || (i > 0 && id == req.MetricIDs[i-1]) {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Metric IDs must be nonempty and unique.")
		}
	}
	s := c.state()
	s.Lock()
	loadErr := s.load()
	generation := s.generation
	s.Unlock()
	if loadErr != nil {
		return nil, loadErr
	}
	var binding *sdk.MetricBinding
	var err error
	if preview {
		err = c.resolveMetricPreview(&req, input)
	} else {
		binding, err = c.resolveMetricRequest(&req, input.BindingID)
	}
	if err != nil {
		return nil, err
	}
	s.Lock()
	unchanged := s.generation == generation
	s.Unlock()
	if !unchanged {
		return nil, profileChangingError()
	}
	principal := ""
	if call, ok := invocation.FromContext(ctx); ok {
		p := call.Principal()
		principal = p.Owner() + ":" + p.Generation() + ":" + string(p.Origin())
	} else {
		return nil, resourcev2.NewError("FORBIDDEN", "Resource admission did not issue an invocation principal.")
	}
	keyReq := req
	keyReq.Resources = nil
	partition := digest(struct {
		Request    sdk.ResourceSetQueryRequest
		Principal  string
		Generation uint64
		Epoch      uint64
	}{keyReq, principal, generation, epoch})
	valid := func() bool {
		s.Lock()
		same := s.generation == generation
		s.Unlock()
		return same && co.currentEpoch() == epoch
	}
	execute := func(work context.Context, resources []sdk.MetricResource) (*sdk.ResourceSetQueryResponse, error) {
		if !valid() {
			return nil, profileChangingError()
		}
		dispatch := req
		dispatch.Resources = append([]sdk.MetricResource(nil), resources...)
		for _, r := range resources {
			guard, err := identityGuard(work, "metric.Query", req.ResourcePluginID, *r.Route, *r.Reference)
			if err != nil {
				return nil, err
			}
			if guard == nil {
				return nil, resourcev2.NewError("UNAVAILABLE", "Observed resource identity guard is unavailable.")
			}
			if err := registerObservationGuard(work, r.Token, guard); err != nil {
				return nil, err
			}
			if err := guard(work); err != nil {
				return nil, err
			}
		}
		var out *sdk.ResourceSetQueryResponse
		var e error
		if binding != nil && binding.Policy == "supplement" {
			out, e = c.dispatchSupplementalResources(work, dispatch)
		} else {
			if e = c.projectMetricResources(work, &dispatch); e != nil {
				return nil, e
			}
			out, e = c.dispatchResourceSet(work, dispatch)
		}
		if !valid() {
			return nil, profileChangingError()
		}
		return out, e
	}
	out, err := co.query(ctx, partition, req.Resources, execute, valid)
	if err != nil {
		return nil, err
	}
	// Re-admit after execution/cache retrieval. A changed policy cannot publish a
	// result simply because it shared work with an earlier admitted consumer.
	for _, r := range req.Resources {
		if _, err = admit(ctx, "metric.Query", req.ResourcePluginID, *r.Route, *r.Reference); err != nil {
			return nil, err
		}
	}
	if !valid() {
		return nil, profileChangingError()
	}
	if err := validateObservationGuards(ctx, deliveryGuards); err != nil {
		return nil, err
	}
	for i := range out.Results {
		out.Results[i].ResourceToken = identities[out.Results[i].ResourceToken]
	}
	return out, nil
}
func resourceIdentity(r sdk.MetricResource) string {
	ref := copyJSON(r.Reference)
	sort.Slice(ref.Address.Scope, func(i, j int) bool { return ref.Address.Scope[i].Dimension < ref.Address.Scope[j].Dimension })
	return digest(struct {
		Reference *resourcev2.ResourceReference
		Route     *resourcev2.AccessRoute
		Key       string
	}{ref, r.Route, r.ResourceKey})
}
func digest(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func (c *controller) resolveMetricPreview(req *sdk.ResourceSetQueryRequest, input sdk.ResourceSetQueryRequest) error {
	if len(req.Resources) > 8 || len(input.Definitions) != 1 || len(req.MetricIDs) != 1 || req.MetricIDs[0] != input.Definitions[0].ID {
		return errors.New("preview requires one definition and at most eight admitted resources")
	}
	source := input.Source
	if source.PluginID == "" || source.ConnectionID == "" || source.DatasourceUID == "" || source.DatasourceKind == "" || source.DatasourceKind == "native" {
		return errors.New("preview requires an explicit external provider connection and datasource")
	}
	if err := c.validateSelectedMetricSource(source); err != nil {
		return err
	}
	if len(input.PublicScope) > 32 {
		return errors.New("preview scope exceeds limits")
	}
	for k, v := range input.PublicScope {
		if !publicScopeKey(k) || len(v) > 1024 {
			return errors.New("preview scope contains an unsupported public field")
		}
	}
	definition := input.Definitions[0]
	for _, r := range req.Resources {
		found := false
		for _, key := range definition.ResourceKeys {
			if key == r.ResourceKey {
				found = true
				break
			}
		}
		if !found {
			return errors.New("preview definition does not apply to selected resource type")
		}
	}
	validation, err := c.ValidateMetricDefinition(source.PluginID, source.ConnectionID, source.DatasourceUID, definition)
	if err != nil {
		return err
	}
	if validation == nil || !validation.Valid {
		return errors.New("preview definition failed schema validation")
	}
	req.Source = source
	req.BindingID = ""
	req.Definitions = copyJSON(input.Definitions)
	req.PublicScope = copyJSON(input.PublicScope)
	req.MappingRevision = "preview:" + digest(struct {
		Definition sdk.MetricDefinition
		Scope      map[string]string
	}{definition, req.PublicScope})
	return nil
}
func (c *controller) resolveMetricRequest(req *sdk.ResourceSetQueryRequest, bindingID string) (*sdk.MetricBinding, error) {
	bindings, err := c.GetMetricBindings(req.ResourcePluginID, req.ResourceConnectionID)
	if err != nil {
		return nil, err
	}
	var selected *sdk.MetricBinding
	for _, b := range bindings {
		if bindingID != "native" && b.Signal == "metrics" && (bindingID == "" || b.ID == bindingID) {
			v := b
			selected = &v
			break
		}
	}
	if bindingID != "" && bindingID != "native" && selected == nil {
		return nil, errors.New("metric binding not found in selected resource connection")
	}
	if selected == nil {
		req.BindingID = ""
		req.Source = sdk.MetricSourceReference{PluginID: req.ResourcePluginID, ConnectionID: req.ResourceConnectionID, DatasourceUID: "native", DatasourceKind: "native"}
		req.MappingRevision = "native"
		return nil, nil
	}
	req.BindingID = selected.ID
	req.Source = selected.Source
	req.PublicScope = copyJSON(selected.PublicScope)
	all, err := c.GetMetricDefinitions()
	if err != nil {
		return nil, err
	}
	byID := map[string]sdk.MetricDefinition{}
	for _, d := range all {
		byID[d.ID] = d
	}
	for _, id := range req.MetricIDs {
		d, ok := byID[id]
		if !ok || (selected.Policy == "supplement" && d.Native) {
			if selected.Policy == "supplement" {
				continue
			}
			return nil, fmt.Errorf("metric definition %q is unavailable", id)
		}
		applicable := 0
		for _, r := range req.Resources {
			if metricAppliesToResource(d, r.ResourceKey) {
				applicable++
			}
		}
		if applicable != len(req.Resources) && selected.Policy != "supplement" {
			return nil, fmt.Errorf("metric %q does not apply to resource type", id)
		}
		if applicable == 0 {
			continue
		}
		shapeOK := false
		for _, shape := range d.SupportedShapes {
			if shape == req.Shape {
				shapeOK = true
				break
			}
		}
		if !shapeOK {
			if selected.Policy == "supplement" {
				continue
			}
			return nil, fmt.Errorf("metric %q does not support requested shape", id)
		}
		for _, o := range selected.Overrides {
			if o.MetricID != id {
				continue
			}
			if o.Query != nil {
				d.Query = *o.Query
			}
			if o.FieldBindings != nil {
				d.FieldBindings = copyJSON(*o.FieldBindings)
			}
			if o.IdentityLabels != nil {
				d.IdentityLabels = copyJSON(*o.IdentityLabels)
			}
			if o.Reducer != nil {
				d.Reducer = *o.Reducer
			}
			if o.BatchStrategy != nil {
				d.BatchStrategy = *o.BatchStrategy
			}
			d.Revision = d.Revision + ":" + o.Revision
		}
		req.Definitions = append(req.Definitions, d)
	}
	req.MappingRevision = digest(struct {
		Binding     sdk.MetricBinding
		Definitions []sdk.MetricDefinition
	}{*selected, req.Definitions})
	return selected, nil
}
func (c *controller) dispatchResourceSet(ctx context.Context, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	if err := sdk.ValidateResourceSetQuery(req); err != nil {
		return nil, err
	}
	c.mux.RLock()
	client := c.clients[req.Source.PluginID]
	blocked := c.streamBlocked[metricStreamKey{req.ResourcePluginID, req.ResourceConnectionID}] > 0
	c.mux.RUnlock()
	if blocked {
		return nil, profileChangingError()
	}
	p, ok := client.(sdk.ResourceSetProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Selected provider does not support explicit resource sets.")
	}
	qctx := &sdk.QueryContext{Context: ctx, PluginID: req.Source.PluginID, ConnectionID: req.Source.ConnectionID}
	if req.Source.DatasourceKind == "native" {
		if req.Source.PluginID != req.ResourcePluginID || req.Source.ConnectionID != req.ResourceConnectionID {
			return nil, errors.New("native metric source must match resource owner connection")
		}
		connected := c.getConnectedCtx(ctx, req.ResourcePluginID, req.ResourceConnectionID)
		if connected == nil {
			return nil, resourcev2.NewError("UNAVAILABLE", "Native metric connection unavailable.")
		}
		qctx.Connection = connected.Connection
	}
	out := &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{}, Warnings: []string{}}
	samples := 0
	for start := 0; start < len(req.Resources); start += maxSetChunk {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := start + maxSetChunk
		if end > len(req.Resources) {
			end = len(req.Resources)
		}
		chunk := req
		chunk.Resources = req.Resources[start:end]
		response, err := p.QueryResources(qctx, chunk)
		if err != nil {
			return nil, err
		}
		if response == nil {
			return nil, errors.New("metric provider returned no response")
		}
		normalized, err := normalizeResourceResults(chunk, response)
		if err != nil {
			return nil, err
		}
		out.Results = append(out.Results, normalized.Results...)
		out.Warnings = append(out.Warnings, normalized.Warnings...)
		for _, result := range normalized.Results {
			if result.Value != nil {
				samples += metricSampleCount(result.Value)
			}
		}
		if samples > maxSetSamples {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Metric sample count exceeds limit.")
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	if len(raw) > maxSetResponseBytes {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Metric response exceeds byte limit.")
	}
	return out, nil
}
func normalizeResourceResults(req sdk.ResourceSetQueryRequest, response *sdk.ResourceSetQueryResponse) (*sdk.ResourceSetQueryResponse, error) {
	if err := sdk.ValidateResourceSetResponse(req, response); err != nil {
		return nil, err
	}
	type pair struct{ resource, metric string }
	seen := map[pair]bool{}
	out := &sdk.ResourceSetQueryResponse{Warnings: response.Warnings}
	now := time.Now()
	samples := 0
	if len(response.Results) > len(req.Resources)*len(req.MetricIDs)*64 {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Metric result count exceeds limit.")
	}
	for _, r := range response.Results {
		if r.Value != nil {
			samples += metricSampleCount(r.Value)
		}
		if r.Value != nil {
			if err := validateResourceMetricValue(req, r.MetricID, r.Value, now); err != nil {
				return nil, err
			}
		}
		if samples > maxSetSamples {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Metric sample count exceeds limit.")
		}
		r.Provenance = sdk.MetricProvenance{Source: req.Source, Native: req.Source.DatasourceKind == "native", BindingID: req.BindingID}
		r.MappingRevision = req.MappingRevision
		if r.ObservedAt.After(now) {
			return nil, errors.New("provider returned future observation time")
		}
		if r.Value != nil {
			if r.Value.CurrentValue != nil {
				r.ObservedAt = r.Value.CurrentValue.Timestamp
			}
			if r.Value.TimeSeries != nil {
				r.ObservedAt = time.Time{}
				for _, point := range r.Value.TimeSeries.DataPoints {
					if point.Timestamp.After(r.ObservedAt) {
						r.ObservedAt = point.Timestamp
					}
				}
			}
			end := req.EndTime
			if end.IsZero() {
				end = now
			}
			if !r.ObservedAt.IsZero() && r.ObservedAt.Before(end.Add(-5*time.Minute)) {
				r.Status = sdk.MetricStatusStale
				r.Warnings = append(r.Warnings, "Metric samples are older than five minutes.")
			}
		}
		if r.ObservedAt.IsZero() {
			r.ObservedAt = now
		}
		if r.ExpiresAt.IsZero() || r.ExpiresAt.After(now.Add(5*time.Second)) {
			r.ExpiresAt = now.Add(5 * time.Second)
		}
		seen[pair{r.ResourceToken, r.MetricID}] = true
		out.Results = append(out.Results, r)
	}
	for _, resource := range req.Resources {
		for _, id := range req.MetricIDs {
			if !seen[pair{resource.Token, id}] {
				out.Results = append(out.Results, sdk.ResourceMetricResult{ResourceToken: resource.Token, MetricID: id, Status: sdk.MetricStatusMissing, Provenance: sdk.MetricProvenance{Source: req.Source, Native: req.Source.DatasourceKind == "native", BindingID: req.BindingID}, ObservedAt: now, ExpiresAt: now.Add(5 * time.Second), MappingRevision: req.MappingRevision})
			}
		}
	}
	return out, nil
}
func metricSampleCount(value *sdk.MetricResult) int {
	if value.TimeSeries != nil {
		return len(value.TimeSeries.DataPoints)
	}
	if value.CurrentValue != nil || value.AggregateValue != nil {
		return 1
	}
	return 0
}

func validateResourceMetricValue(req sdk.ResourceSetQueryRequest, id string, value *sdk.MetricResult, now time.Time) error {
	finite := func(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }
	sampleTime := func(timestamp time.Time) bool {
		if timestamp.IsZero() || timestamp.After(now) {
			return false
		}
		if !req.EndTime.IsZero() && timestamp.After(req.EndTime) {
			return false
		}
		return req.StartTime.IsZero() || !timestamp.Before(req.StartTime)
	}
	switch req.Shape {
	case sdk.ShapeCurrent:
		current := value.CurrentValue
		if current == nil || current.MetricID != id || !finite(current.Value) || !sampleTime(current.Timestamp) {
			return errors.New("provider returned an invalid current metric value or timestamp")
		}
	case sdk.ShapeTimeseries:
		series := value.TimeSeries
		if series == nil || series.MetricID != id || len(series.DataPoints) == 0 {
			return errors.New("provider returned an invalid metric timeseries")
		}
		for _, point := range series.DataPoints {
			if !finite(point.Value) || !sampleTime(point.Timestamp) {
				return errors.New("provider returned a non-finite or out-of-range metric sample")
			}
		}
	case sdk.ShapeAggregate:
		aggregate := value.AggregateValue
		if aggregate == nil || aggregate.MetricID != id {
			return errors.New("provider returned an invalid metric aggregate")
		}
		for _, n := range []float64{aggregate.Min, aggregate.Max, aggregate.Avg, aggregate.Sum, aggregate.P50, aggregate.P90, aggregate.P99} {
			if !finite(n) {
				return errors.New("provider returned a non-finite metric aggregate")
			}
		}
	}
	return nil
}
