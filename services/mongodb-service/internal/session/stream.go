package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"niuma/services/mongodb-service/internal/idgen"
)

// StreamEmitter 上报 Change Stream 事件。
type StreamEmitter func(payload map[string]any)

// StreamManager 管理 MongoDB Change Stream（每会话最多 1 条活跃流）。
type StreamManager struct {
	mu       sync.Mutex
	streams  map[string]*streamEntry
	bySess   map[string]string
	sessions *Manager
	ids      idgen.Generator
	emit     StreamEmitter
}

type streamEntry struct {
	streamID        string
	sessionID       string
	cancel          context.CancelFunc
	intentionalStop bool
}

// NewStreamManager 创建 Change Stream 管理器。
func NewStreamManager(sessions *Manager, ids idgen.Generator, emit StreamEmitter) *StreamManager {
	return &StreamManager{
		streams:  make(map[string]*streamEntry),
		bySess:   make(map[string]string),
		sessions: sessions,
		ids:      ids,
		emit:     emit,
	}
}

// Start 在指定库集合上打开 Change Stream。
func (m *StreamManager) Start(ctx context.Context, sessionID, database, collection string, pipeline []bson.M) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("sessionId required")
	}
	if database == "" || collection == "" {
		return "", fmt.Errorf("database and collection required")
	}

	sess, err := m.sessions.Get(sessionID)
	if err != nil {
		return "", err
	}

	m.mu.Lock()
	if existing, ok := m.bySess[sessionID]; ok {
		m.mu.Unlock()
		_ = m.Stop(existing)
		m.mu.Lock()
	}
	m.mu.Unlock()

	streamID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}

	runCtx, cancel := context.WithCancel(ctx)
	coll := sess.Client.Database(database).Collection(collection)
	watchOpts := options.ChangeStream().SetFullDocument(options.UpdateLookup)
	var stream *mongo.ChangeStream
	if len(pipeline) > 0 {
		stream, err = coll.Watch(runCtx, pipeline, watchOpts)
	} else {
		stream, err = coll.Watch(runCtx, mongo.Pipeline{}, watchOpts)
	}
	if err != nil {
		cancel()
		return "", fmt.Errorf("mongodb: change stream: %w", err)
	}

	entry := &streamEntry{
		streamID:  streamID,
		sessionID: sessionID,
		cancel:    cancel,
	}
	m.mu.Lock()
	m.streams[streamID] = entry
	m.bySess[sessionID] = streamID
	m.mu.Unlock()

	m.emitEvent(map[string]any{
		"type":      "mongodb.monitor.state",
		"streamId":  streamID,
		"sessionId": sessionID,
		"state":     "ready",
		"message":   "",
	})

	go m.run(runCtx, streamID, sessionID, stream)
	return streamID, nil
}

// Stop 关闭指定 Change Stream。
func (m *StreamManager) Stop(streamID string) error {
	m.mu.Lock()
	entry, ok := m.streams[streamID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("stream not found: %s", streamID)
	}
	entry.intentionalStop = true
	m.mu.Unlock()
	entry.cancel()
	return nil
}

// StopBySession 关闭会话关联的 Change Stream。
func (m *StreamManager) StopBySession(sessionID string) {
	m.mu.Lock()
	streamID, ok := m.bySess[sessionID]
	m.mu.Unlock()
	if ok {
		_ = m.Stop(streamID)
	}
}

func (m *StreamManager) run(ctx context.Context, streamID, sessionID string, stream *mongo.ChangeStream) {
	defer func() {
		_ = stream.Close(ctx)
		m.mu.Lock()
		entry, ok := m.streams[streamID]
		intentional := ok && entry.intentionalStop
		if ok {
			delete(m.streams, streamID)
			delete(m.bySess, entry.sessionID)
		}
		m.mu.Unlock()

		state := "lost"
		if intentional || errors.Is(ctx.Err(), context.Canceled) {
			state = "closed"
		}
		m.emitEvent(map[string]any{
			"type":      "mongodb.monitor.state",
			"streamId":  streamID,
			"sessionId": sessionID,
			"state":     state,
			"message":   "",
		})
	}()

	for stream.Next(ctx) {
		var event bson.M
		if err := stream.Decode(&event); err != nil {
			continue
		}
		doc, err := MarshalDocument(event)
		if err != nil {
			continue
		}
		var document any
		if err := json.Unmarshal(doc, &document); err != nil {
			continue
		}
		m.emitEvent(map[string]any{
			"type":     "mongodb.monitor.event",
			"streamId": streamID,
			"document": document,
		})
	}
}

func (m *StreamManager) emitEvent(payload map[string]any) {
	if m.emit != nil {
		m.emit(payload)
	}
}
