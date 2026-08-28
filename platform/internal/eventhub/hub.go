// Package eventhub 将能力服务上报的事件扇出给 Shell 订阅连接。
package eventhub

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"sync"

	"niuma/pkg/serviceipc/event"
	"niuma/pkg/serviceipc/protocol"
)

const shellOutQueueSize = 32

// Hub 管理 eventin（服务上报）与 events（Shell 订阅）两路命名管道。
type Hub struct {
	mu         sync.Mutex
	shellConns map[net.Conn]*shellSink
	progress   *progressCoalescer
	stream     streamDeliverer
}

// streamDeliverer 由 streamserver 实现，用于独占投递高频流事件。
type streamDeliverer interface {
	DeliverExclusive(payload []byte) bool
}

// shellSink 为单条 Shell 订阅连接的有界写出队列；ingest 永不直接 WriteFrame。
type shellSink struct {
	conn net.Conn
	ch   chan []byte
	dead chan struct{}
}

// New 创建事件中枢。
func New() *Hub {
	h := &Hub{shellConns: make(map[net.Conn]*shellSink)}
	h.progress = newProgressCoalescer(h, progressCoalesceInterval)
	return h
}

// SetStreamDeliverer 注入流服务（Platform 管理面，不含业务规则）。
func (h *Hub) SetStreamDeliverer(d streamDeliverer) {
	h.stream = d
}

// Serve 同时启动事件入口与 Shell 订阅监听，直到 ctx 取消。
func (h *Hub) Serve(ctx context.Context) error {
	errCh := make(chan error, 2)
	go func() { errCh <- h.serveIngest(ctx) }()
	go func() { errCh <- h.serveShell(ctx) }()

	select {
	case <-ctx.Done():
		return nil
	case err := <-errCh:
		return err
	}
}

func (h *Hub) serveIngest(ctx context.Context) error {
	return h.listenLoop(ctx, event.IngestAddress(), "eventin", h.handleIngestConn)
}

func (h *Hub) serveShell(ctx context.Context) error {
	return h.listenLoop(ctx, event.ShellAddress(), "events", h.handleShellConn)
}

func (h *Hub) listenLoop(ctx context.Context, addr, label string, handler func(context.Context, net.Conn)) error {
	ln, err := listen(addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	slog.Info("event listener ready", "channel", label, "addr", addr)
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go handler(ctx, conn)
	}
}

func (h *Hub) handleIngestConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	for {
		payload, err := protocol.ReadFrame(conn)
		if err != nil {
			if !errors.Is(err, io.EOF) && ctx.Err() == nil {
				slog.Error("eventin read", "err", err)
			}
			return
		}
		if len(payload) == 0 {
			continue
		}
		h.ingest(payload)
	}
}

func (h *Hub) ingest(payload []byte) {
	if h.stream != nil && h.stream.DeliverExclusive(payload) {
		return
	}
	h.progress.handle(payload)
}

func (h *Hub) handleShellConn(ctx context.Context, conn net.Conn) {
	sink := &shellSink{conn: conn, ch: make(chan []byte, shellOutQueueSize), dead: make(chan struct{})}
	h.mu.Lock()
	h.shellConns[conn] = sink
	h.mu.Unlock()

	done := make(chan struct{})
	go func() {
		defer close(done)
		sink.writeLoop(ctx.Done())
	}()

	select {
	case <-ctx.Done():
	case <-done:
	}

	h.mu.Lock()
	delete(h.shellConns, conn)
	h.mu.Unlock()
	_ = conn.Close()
}

func (s *shellSink) writeLoop(stop <-chan struct{}) {
	defer close(s.dead)
	for {
		select {
		case <-stop:
			return
		case payload := <-s.ch:
			if err := protocol.WriteFrame(s.conn, payload); err != nil {
				slog.Error("event fan-out", "err", err)
				_ = s.conn.Close()
				return
			}
		}
	}
}

func (h *Hub) fanOut(payload []byte, droppable bool) {
	h.mu.Lock()
	sinks := make([]*shellSink, 0, len(h.shellConns))
	for _, s := range h.shellConns {
		sinks = append(sinks, s)
	}
	h.mu.Unlock()

	for _, sink := range sinks {
		enqueueEvent(sink, payload, droppable)
	}
}

func enqueueEvent(sink *shellSink, payload []byte, droppable bool) {
	if sink == nil {
		return
	}
	if droppable {
		select {
		case sink.ch <- payload:
		case <-sink.dead:
		default:
		}
		return
	}
	// 可靠事件（session.state / transfer.state）禁止丢弃；连接已死才放弃。
	select {
	case sink.ch <- payload:
	case <-sink.dead:
	}
}

// Publish 将 Platform 主动事件扇出给所有 Shell 订阅连接。
func (h *Hub) Publish(eventMap map[string]any) {
	payload, err := json.Marshal(eventMap)
	if err != nil {
		slog.Error("event publish marshal", "err", err)
		return
	}
	typ, _ := eventMap["type"].(string)
	h.fanOut(payload, event.IsProgressType(typ))
}
