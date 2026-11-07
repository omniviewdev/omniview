// Package activity owns durable activity observations independently of their views.
package activity

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	historyLimit                   = 500
	maxNonterminalActivities       = 2000
	maxActiveTasksPerProducer      = 128
	maxUnresolvedAlertsPerProducer = 128
	maxSubscriptions               = 256
	maxSubscriptionsPerOwner       = 16
	maxProducerOwners              = 512
)

type storedRecord struct {
	Record sdk.Record `json:"record"`
	Owner  string     `json:"owner"`
}

type diskState struct {
	Version  uint32                  `json:"version"`
	Revision uint64                  `json:"revision"`
	Records  map[string]storedRecord `json:"records"`
}

type subscription struct {
	owner string
	armed bool
}

// Service serializes persistence and publication. An event never precedes its durable commit.
type Service struct {
	mu            sync.Mutex
	root          *appstate.ScopedRoot
	state         diskState
	subscriptions map[string]subscription
	producers     map[string]bool
	cancellations map[string]func() error
	emit          func(string, sdk.Change)
	starter       func(context.Context, sdk.StartResourceActionRequest) (sdk.Record, error)
}

func NewService(root *appstate.ScopedRoot, emit func(string, sdk.Change)) (*Service, error) {
	s := &Service{
		root:          root,
		state:         diskState{Version: 1, Records: map[string]storedRecord{}},
		subscriptions: map[string]subscription{},
		producers:     map[string]bool{},
		cancellations: map[string]func() error{},
		emit:          emit,
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	for id, v := range s.state.Records {
		changed := false
		if v.Record.Task != nil && active(v.Record) {
			v.Record.Task.State = "unknown"
			v.Record.Task.UnknownReason = "host-restarted"
			v.Record.Task.Cancellation = "unsupported"
			changed = true
		}
		if v.Record.Alert != nil && v.Record.Alert.State == "firing" {
			v.Record.Alert.State = "unknown"
			changed = true
		}
		if changed {
			s.state.Revision++
			v.Record.Revision = s.state.Revision
			v.Record.UpdatedAt = now()
			s.state.Records[id] = v
		}
	}
	s.pruneLocked()
	if err := s.persistLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func active(r sdk.Record) bool {
	return r.Task != nil && (r.Task.State == "starting" || r.Task.State == "running" || r.Task.State == "paused")
}

func eligible(r sdk.Record) bool {
	return r.Kind == "message" || (r.Task != nil && !active(r)) || (r.Alert != nil && r.Alert.State == "resolved")
}

func (s *Service) persistLocked() error {
	data, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	if len(data) > maxActivityFileBytes {
		return errors.New("activity history exceeds storage limit")
	}
	name := "activities-" + newID() + ".tmp"
	f, err := s.root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer s.root.Remove(name)
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
	return s.root.Rename(name, "activities.json")
}

func (s *Service) pruneLocked() []string {
	var records []sdk.Record
	for _, v := range s.state.Records {
		if eligible(v.Record) {
			records = append(records, v.Record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].UpdatedAt < records[j].UpdatedAt
	})
	var removed []string
	for len(records) > historyLimit {
		r := records[0]
		records = records[1:]
		delete(s.state.Records, r.ID)
		removed = append(removed, r.ID)
	}
	return removed
}

func (s *Service) publishLocked(change sdk.Change) {
	if s.emit == nil {
		return
	}
	for id, sub := range s.subscriptions {
		if sub.armed {
			s.emit("activity/change/"+id, cloneChange(change))
		}
	}
}

func (s *Service) commitLocked(v storedRecord) (sdk.Record, error) {
	if s.state.Revision == math.MaxUint64 {
		return sdk.Record{}, errors.New("activity revision exhausted")
	}
	v.Record.Revision = s.state.Revision + 1
	v.Record.UpdatedAt = now()
	if err := validatePersistedRecord(v.Record.ID, v, v.Record.Revision); err != nil {
		return sdk.Record{}, fmt.Errorf("invalid activity record: %w", err)
	}
	old := diskState{Version: s.state.Version, Revision: s.state.Revision, Records: maps.Clone(s.state.Records)}
	s.state.Revision = v.Record.Revision
	s.state.Records[v.Record.ID] = v
	removed := s.pruneLocked()
	if err := s.persistLocked(); err != nil {
		s.state = old
		return sdk.Record{}, err
	}
	r := cloneRecord(v.Record)
	s.publishLocked(sdk.Change{Revision: s.state.Revision, Record: &r, RemovedIDs: removed})
	return r, nil
}

func (s *Service) snapshotLocked() sdk.Snapshot {
	out := sdk.Snapshot{Revision: s.state.Revision, Records: []sdk.Record{}}
	for _, v := range s.state.Records {
		out.Records = append(out.Records, cloneRecord(v.Record))
	}
	sort.Slice(out.Records, func(i, j int) bool {
		return out.Records[i].CreatedAt < out.Records[j].CreatedAt
	})
	return out
}

func (s *Service) Snapshot() sdk.Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *Service) Subscribe(owner string) (sdk.Subscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.subscriptions) >= maxSubscriptions {
		return sdk.Subscription{}, errors.New("activity subscription limit reached")
	}
	count := 0
	for _, subscription := range s.subscriptions {
		if subscription.owner == owner {
			count++
		}
	}
	if count >= maxSubscriptionsPerOwner {
		return sdk.Subscription{}, errors.New("producer subscription limit reached")
	}
	id := newID()
	s.subscriptions[id] = subscription{owner: owner}
	return sdk.Subscription{ID: id, Snapshot: s.snapshotLocked()}, nil
}

func (s *Service) Attach(owner, id string) (sdk.Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub, ok := s.subscriptions[id]
	if !ok || sub.owner != owner {
		return sdk.Snapshot{}, errors.New("subscription unavailable")
	}
	sub.armed = true
	s.subscriptions[id] = sub
	return s.snapshotLocked(), nil
}

func (s *Service) Unsubscribe(owner, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub, ok := s.subscriptions[id]
	if ok && sub.owner != owner {
		return errors.New("subscription unavailable")
	}
	delete(s.subscriptions, id)
	return nil
}

func (s *Service) SetActionStarter(fn func(context.Context, sdk.StartResourceActionRequest) (sdk.Record, error)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.starter = fn
}

func (s *Service) StartResourceAction(ctx context.Context, r sdk.StartResourceActionRequest) (sdk.Record, error) {
	s.mu.Lock()
	fn := s.starter
	s.mu.Unlock()
	if fn == nil {
		return sdk.Record{}, errors.New("resource actions unavailable")
	}
	return fn(ctx, r)
}

func (s *Service) ownedLocked(owner, id string) (storedRecord, error) {
	v, ok := s.state.Records[id]
	if !ok || v.Owner != owner || s.producerUnavailableLocked(owner) {
		return storedRecord{}, errors.New("activity unavailable for producer")
	}
	return detach(v), nil
}

func (s *Service) specLocked(owner string, spec sdk.Spec) (sdk.Record, error) {
	if _, err := persistedOwnerPlugin(owner); err != nil {
		return sdk.Record{}, err
	}
	if s.producerUnavailableLocked(owner) {
		return sdk.Record{}, errors.New("producer retired")
	}
	if err := validateSpec(spec, owner); err != nil {
		return sdk.Record{}, err
	}
	if spec.ParentID != "" {
		if strings.HasPrefix(owner, "native:") {
			if _, ok := s.state.Records[spec.ParentID]; !ok {
				return sdk.Record{}, errors.New("parent activity unavailable")
			}
		} else {
			if _, err := s.ownedLocked(owner, spec.ParentID); err != nil {
				return sdk.Record{}, err
			}
		}
	}
	severity := spec.Severity
	if severity == "" {
		severity = "info"
	}
	source := sdk.Source{}
	if spec.Source != nil {
		source = cloneSource(*spec.Source)
	}
	return sdk.Record{
		ID:           newID(),
		Source:       source,
		Severity:     severity,
		CreatedAt:    now(),
		Presentation: clonePresentation(spec.Presentation),
		ParentID:     spec.ParentID,
	}, nil
}

func (s *Service) BeginOwnedTask(owner string, spec sdk.Spec, cancel func() error) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.admitRecordLocked(owner, "task"); err != nil {
		return sdk.Record{}, err
	}
	r, err := s.specLocked(owner, spec)
	if err != nil {
		return r, err
	}
	r.Kind = "task"
	r.Task = &sdk.Task{State: "starting", Cancellation: "unsupported"}
	if cancel != nil {
		r.Task.Cancellation = "available"
	}
	r, err = s.commitLocked(storedRecord{Record: r, Owner: owner})
	if err == nil && cancel != nil {
		s.cancellations[r.ID] = cancel
	}
	return r, err
}

func (s *Service) ReportOwnedTask(owner string, req sdk.ReportTaskRequest) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, err := s.ownedLocked(owner, req.ID)
	if err != nil {
		return sdk.Record{}, err
	}
	if !active(v.Record) {
		return sdk.Record{}, errors.New("task is not active")
	}
	if req.State != "" && req.State != "running" && req.State != "paused" {
		return sdk.Record{}, errors.New("invalid task state")
	}
	if err = validatePresentation(req.Presentation, owner); err != nil {
		return sdk.Record{}, err
	}
	if req.ObservedAt != "" {
		if _, err = time.Parse(time.RFC3339Nano, req.ObservedAt); err != nil {
			return sdk.Record{}, err
		}
		if v.Record.ObservedAt != "" && !newer(req.ObservedAt, v.Record.ObservedAt) {
			return cloneRecord(v.Record), nil
		}
		v.Record.ObservedAt = req.ObservedAt
	}
	v.Record.Presentation = clonePresentation(req.Presentation)
	if req.State != "" {
		v.Record.Task.State = req.State
	} else {
		v.Record.Task.State = "running"
	}
	return s.commitLocked(v)
}

func (s *Service) FinishOwnedTask(owner string, req sdk.FinishTaskRequest) (sdk.Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, err := s.ownedLocked(owner, req.ID)
	if err != nil {
		return sdk.Record{}, err
	}
	if !active(v.Record) {
		return sdk.Record{}, errors.New("task already terminal")
	}
	switch req.State {
	case "succeeded", "failed", "cancelled", "unknown":
	default:
		return sdk.Record{}, errors.New("invalid terminal state")
	}
	if req.Presentation != nil {
		if err = validatePresentation(*req.Presentation, owner); err != nil {
			return sdk.Record{}, err
		}
		v.Record.Presentation = clonePresentation(*req.Presentation)
	}
	v.Record.Task.State = req.State
	if req.State == "cancelled" {
		v.Record.Task.Cancellation = "acknowledged"
	}
	r, err := s.commitLocked(v)
	if err == nil {
		delete(s.cancellations, req.ID)
	}
	return r, err
}

func newer(a, b string) bool {
	x, err := time.Parse(time.RFC3339Nano, a)
	if err != nil {
		return false
	}
	y, err := time.Parse(time.RFC3339Nano, b)
	return err != nil || x.After(y)
}

func (s *Service) load() error {
	file, err := s.root.OpenFile("activities.json", os.O_RDONLY, 0)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > maxActivityFileBytes {
		return errors.New("activity history exceeds storage limit")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxActivityFileBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxActivityFileBytes {
		return errors.New("activity history exceeds storage limit")
	}
	if err := resourcev2.ValidateJSON(data); err != nil {
		return fmt.Errorf("read activities: %w", err)
	}
	var state diskState
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return fmt.Errorf("read activities: %w", err)
	}
	if err := validatePersistedState(state); err != nil {
		return fmt.Errorf("read activities: %w", err)
	}
	s.state = state
	return nil
}

// ActivateProducer admits a live identity. Retirement removes the identity rather
// than retaining an unbounded blacklist; old callbacks fail closed thereafter.
func (s *Service) ActivateProducer(owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := persistedOwnerPlugin(owner); err != nil {
		return err
	}
	if s.producers[owner] {
		return nil
	}
	if len(s.producers) >= maxProducerOwners {
		return errors.New("activity producer limit reached")
	}
	s.producers[owner] = true
	return nil
}

func (s *Service) producerUnavailableLocked(owner string) bool {
	if strings.HasPrefix(owner, "plugin:") || strings.HasPrefix(owner, "ui:") {
		return !s.producers[owner]
	}
	return false
}

func (s *Service) DropSubscriptions(owner string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, subscription := range s.subscriptions {
		if subscription.owner == owner {
			delete(s.subscriptions, id)
		}
	}
}

func (s *Service) admitRecordLocked(owner, kind string) error {
	if s.producerUnavailableLocked(owner) {
		return errors.New("activity producer unavailable")
	}
	nonterminal := 0
	activeTasks := 0
	unresolvedAlerts := 0
	for _, stored := range s.state.Records {
		record := stored.Record
		if !eligible(record) {
			nonterminal++
		}
		if producer(stored.Owner) != producer(owner) {
			continue
		}
		if active(record) {
			activeTasks++
		}
		if record.Alert != nil && record.Alert.State != "resolved" {
			unresolvedAlerts++
		}
	}
	if nonterminal >= maxNonterminalActivities {
		return errors.New("active activity limit reached")
	}
	if kind == "task" && activeTasks >= maxActiveTasksPerProducer {
		return errors.New("producer active task limit reached")
	}
	if kind == "alert" && unresolvedAlerts >= maxUnresolvedAlertsPerProducer {
		return errors.New("producer unresolved alert limit reached")
	}
	return nil
}
