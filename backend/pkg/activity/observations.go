package activity

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"strings"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func validatePresentation(p sdk.Presentation, owner string) error {
	if err := resourcev2.ValidateActivityPresentation(p); err != nil {
		return err
	}
	pluginID := strings.SplitN(owner, ":", 2)[0]
	if strings.HasPrefix(owner, "plugin:") {
		pluginID = strings.TrimPrefix(producer(owner), "plugin:")
	}
	if owner == "ui" || strings.HasPrefix(owner, "ui:") {
		return nil
	}
	if strings.HasPrefix(owner, "native:") {
		pluginID = strings.TrimPrefix(owner, "native:")
	}
	for _, action := range p.Actions {
		if action.Target != nil && action.Target.PluginID != pluginID {
			return errors.New("cross-plugin navigation intent")
		}
		if action.Intent != nil && action.Intent.PluginID != pluginID {
			return errors.New("cross-plugin action intent")
		}
		if action.Kind == "cancel-task" {
			return errors.New("producer cancellation intents are not accepted")
		}
	}
	return nil
}

func validateSpec(spec sdk.Spec, owner string) error {
	pluginID, err := persistedOwnerPlugin(owner)
	if err != nil {
		return err
	}
	source := sdk.Source{}
	if spec.Source != nil {
		source = *spec.Source
	}
	if owner == "ui" || strings.HasPrefix(owner, "ui:") {
		if source.PluginID != "" || source.Resource != nil {
			return errors.New("frontend source claims plugin provenance")
		}
	} else if strings.HasPrefix(owner, "plugin:") {
		if source.PluginID != pluginID {
			return errors.New("plugin source provenance mismatch")
		}
	} else if source.PluginID != "" && source.PluginID != pluginID {
		return errors.New("native source provenance mismatch")
	}
	switch spec.Severity {
	case "", "info", "success", "warning", "error":
	default:
		return errors.New("invalid severity")
	}
	if spec.Source != nil && spec.Source.Resource != nil {
		presentation := sdk.Presentation{
			Title: "Source",
			Actions: []resourcev2.ActivityAction{{
				ID: "source", Kind: "navigate-resource", Label: "Source", Target: spec.Source.Resource,
			}},
		}
		if err := resourcev2.ValidateActivityPresentation(presentation); err != nil {
			return err
		}
	}
	if source.Resource != nil {
		if source.Resource.PluginID != pluginID || source.Resource.PluginID != source.PluginID {
			return errors.New("source resource provenance mismatch")
		}
		if source.ConnectionID != source.Resource.Route.Connection {
			return errors.New("source resource connection mismatch")
		}
	}
	return validatePresentation(spec.Presentation, owner)
}

func (s *Service) publishMessage(owner string, spec sdk.Spec) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.specLocked(owner, spec)
	if err != nil {
		return r, err
	}
	r.Kind = "message"
	return s.commitLocked(storedRecord{Record: r, Owner: owner})
}

func (s *Service) upsertAlert(owner string, req sdk.AlertRequest) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if req.Key == "" || len(req.Key) > 1024 {
		return sdk.Record{}, errors.New("invalid alert key")
	}
	if _, err := time.Parse(time.RFC3339Nano, req.ObservedAt); err != nil {
		return sdk.Record{}, err
	}
	if s.producerUnavailableLocked(owner) {
		return sdk.Record{}, errors.New("producer retired")
	}
	if err := validateSpec(req.Spec, owner); err != nil {
		return sdk.Record{}, err
	}
	for _, v := range s.state.Records {
		if producer(v.Owner) != producer(owner) || v.Record.Alert == nil || v.Record.Alert.Key != req.Key {
			continue
		}
		source := sdk.Source{}
		if req.Source != nil {
			source = *req.Source
		}
		oldSource, _ := json.Marshal(v.Record.Source)
		newSource, _ := json.Marshal(source)
		if string(oldSource) != string(newSource) {
			return sdk.Record{}, errors.New("alert key must include stable connection/resource identity")
		}
		if !newer(req.ObservedAt, v.Record.ObservedAt) {
			return cloneRecord(v.Record), nil
		}
		v = detach(v)
		v.Owner = owner
		v.Record.Alert.State = "firing"
		v.Record.Alert.Occurrences++
		v.Record.ObservedAt = req.ObservedAt
		v.Record.Presentation = clonePresentation(req.Presentation)
		if req.Severity != "" {
			v.Record.Severity = req.Severity
		}
		return s.commitLocked(v)
	}
	if err := s.admitRecordLocked(owner, "alert"); err != nil {
		return sdk.Record{}, err
	}
	r, err := s.specLocked(owner, req.Spec)
	if err != nil {
		return r, err
	}
	r.Kind = "alert"
	r.ObservedAt = req.ObservedAt
	r.Alert = &sdk.Alert{Key: req.Key, State: "firing", Occurrences: 1}
	return s.commitLocked(storedRecord{Record: r, Owner: owner})
}

func (s *Service) resolveAlert(owner string, req sdk.ResolveAlertRequest) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.producerUnavailableLocked(owner) {
		return sdk.Record{}, errors.New("producer retired")
	}
	if _, err := time.Parse(time.RFC3339Nano, req.ObservedAt); err != nil {
		return sdk.Record{}, err
	}
	for _, v := range s.state.Records {
		if producer(v.Owner) != producer(owner) || v.Record.Alert == nil || v.Record.Alert.Key != req.Key {
			continue
		}
		if !newer(req.ObservedAt, v.Record.ObservedAt) {
			return cloneRecord(v.Record), nil
		}
		v = detach(v)
		v.Owner = owner
		v.Record.Alert.State = "resolved"
		v.Record.ObservedAt = req.ObservedAt
		return s.commitLocked(v)
	}
	return sdk.Record{}, errors.New("alert unavailable")
}

func (s *Service) SetPresentation(req sdk.SetPresentationRequest) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.state.Records[req.ID]
	if !ok {
		return sdk.Record{}, errors.New("activity unavailable")
	}
	v = detach(v)
	if req.Collapsed != nil {
		v.Record.Visibility.Collapsed = *req.Collapsed
	}
	if req.ToastDismissed != nil {
		v.Record.Visibility.ToastDismissed = *req.ToastDismissed
	}
	if req.Read != nil {
		v.Record.Visibility.Read = *req.Read
	}
	if req.SnoozedUntil != nil || req.Acknowledged != nil {
		if v.Record.Alert == nil {
			return sdk.Record{}, errors.New("presentation control requires alert")
		}
		if req.SnoozedUntil != nil {
			if *req.SnoozedUntil != "" {
				if _, err := time.Parse(time.RFC3339Nano, *req.SnoozedUntil); err != nil {
					return sdk.Record{}, err
				}
			}
			v.Record.Alert.SnoozedUntil = *req.SnoozedUntil
		}
		if req.Acknowledged != nil {
			v.Record.Alert.AcknowledgedAt = ""
			if *req.Acknowledged {
				v.Record.Alert.AcknowledgedAt = now()
			}
		}
	}
	return s.commitLocked(v)
}

func (s *Service) ClearHistory() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := diskState{Version: s.state.Version, Revision: s.state.Revision, Records: maps.Clone(s.state.Records)}
	removed := []string{}
	for id, v := range s.state.Records {
		if eligible(v.Record) {
			delete(s.state.Records, id)
			removed = append(removed, id)
		}
	}
	if len(removed) == 0 {
		return nil
	}
	s.state.Revision++
	if err := s.persistLocked(); err != nil {
		s.state = old
		return err
	}
	s.publishLocked(sdk.Change{Revision: s.state.Revision, RemovedIDs: removed})
	return nil
}

func (s *Service) RequestCancellation(id string) (sdk.Record, error) {
	s.mu.Lock()
	v, ok := s.state.Records[id]
	cancel := s.cancellations[id]
	if !ok || !active(v.Record) || cancel == nil {
		s.mu.Unlock()
		return sdk.Record{}, errors.New("cancellation unavailable")
	}
	if v.Record.Task.Cancellation == "requested" {
		r := cloneRecord(v.Record)
		s.mu.Unlock()
		return r, nil
	}
	v = detach(v)
	v.Record.Task.Cancellation = "requested"
	r, err := s.commitLocked(v)
	s.mu.Unlock()
	if err != nil {
		return r, err
	}
	if err = cancel(); err != nil {
		return r, err
	}
	return r, nil
}

// RetireProducer fences late reports and records lost observations as unknown.
func (s *Service) RetireProducer(pluginID, generation string) error {
	return s.retire("plugin:"+pluginID+":"+generation, "producer-lost")
}

func (s *Service) retire(owner, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.producers, owner)
	for id, v := range s.state.Records {
		if v.Owner != owner {
			continue
		}
		v = detach(v)
		changed := false
		if active(v.Record) {
			v.Record.Task.State = "unknown"
			v.Record.Task.UnknownReason = reason
			v.Record.Task.Cancellation = "unsupported"
			changed = true
		}
		if v.Record.Alert != nil && v.Record.Alert.State == "firing" {
			v.Record.Alert.State = "unknown"
			changed = true
		}
		if changed {
			if _, err := s.commitLocked(v); err != nil {
				return err
			}
		}
		delete(s.cancellations, id)
	}
	return nil
}

func (s *Service) Shutdown() error {
	s.mu.Lock()
	owners := map[string]bool{}
	for _, v := range s.state.Records {
		owners[v.Owner] = true
	}
	s.mu.Unlock()
	for owner := range owners {
		if err := s.retire(owner, "host-stopped"); err != nil {
			return err
		}
	}
	return nil
}

type reporter struct {
	s               *Service
	owner, pluginID string
}

func (s *Service) Reporter(pluginID, generation string) sdk.Reporter {
	owner := "plugin:" + pluginID + ":" + generation
	_ = s.ActivateProducer(owner)
	return &reporter{s: s, owner: owner, pluginID: pluginID}
}

func (r *reporter) spec(spec sdk.Spec) (sdk.Spec, error) {
	if spec.Source == nil {
		spec.Source = &sdk.Source{}
	} else {
		source := cloneSource(*spec.Source)
		spec.Source = &source
	}
	if spec.Source.PluginID != "" && spec.Source.PluginID != r.pluginID {
		return spec, errors.New("plugin provenance mismatch")
	}
	spec.Source.PluginID = r.pluginID
	if spec.Source.Resource != nil && spec.Source.Resource.PluginID != r.pluginID {
		return spec, errors.New("resource provenance mismatch")
	}
	return spec, nil
}

func (r *reporter) BeginTask(ctx context.Context, spec sdk.Spec) (sdk.Record, error) {
	spec, err := r.spec(spec)
	if err != nil {
		return sdk.Record{}, err
	}
	return r.s.BeginOwnedTask(r.owner, spec, nil)
}

func (r *reporter) ReportTask(ctx context.Context, req sdk.ReportTaskRequest) (sdk.Record, error) {
	return r.s.ReportOwnedTask(r.owner, req)
}

func (r *reporter) FinishTask(ctx context.Context, req sdk.FinishTaskRequest) (sdk.Record, error) {
	return r.s.FinishOwnedTask(r.owner, req)
}

func (r *reporter) PublishMessage(ctx context.Context, spec sdk.Spec) (sdk.Record, error) {
	spec, err := r.spec(spec)
	if err != nil {
		return sdk.Record{}, err
	}
	return r.s.publishMessage(r.owner, spec)
}

func (r *reporter) UpsertAlert(ctx context.Context, req sdk.AlertRequest) (sdk.Record, error) {
	spec, err := r.spec(req.Spec)
	if err != nil {
		return sdk.Record{}, err
	}
	req.Spec = spec
	return r.s.upsertAlert(r.owner, req)
}

func (r *reporter) ResolveAlert(ctx context.Context, req sdk.ResolveAlertRequest) (sdk.Record, error) {
	return r.s.resolveAlert(r.owner, req)
}

func producer(owner string) string {
	if strings.HasPrefix(owner, "plugin:") {
		return owner[:strings.LastIndex(owner, ":")]
	}
	return owner
}

func detach(v storedRecord) storedRecord {
	if v.Record.Task != nil {
		task := *v.Record.Task
		v.Record.Task = &task
	}
	if v.Record.Alert != nil {
		alert := *v.Record.Alert
		v.Record.Alert = &alert
	}
	return v
}
