package session

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const notifyEventType = "postgres.notify"

// NotifyHub 在独立物理连接上维护 LISTEN 集合并回投通知事件。
type NotifyHub struct {
	sessionID string
	pool      *pgxpool.Pool
	emit      func(map[string]any)

	mu       sync.Mutex
	channels map[string]struct{}
	conn     *pgxpool.Conn
	cancel   context.CancelFunc
}

// NewNotifyHub 创建未启动的通知枢纽。
func NewNotifyHub(sessionID string, pool *pgxpool.Pool, emit func(map[string]any)) *NotifyHub {
	return &NotifyHub{
		sessionID: sessionID,
		pool:      pool,
		emit:      emit,
		channels:  make(map[string]struct{}),
	}
}

// Listen 订阅频道；首次调用时钉住一条连接并启动等待循环。
func (h *NotifyHub) Listen(ctx context.Context, channel string) error {
	ch, err := normalizeNotifyChannel(channel)
	if err != nil {
		return err
	}
	h.mu.Lock()
	if _, ok := h.channels[ch]; ok {
		h.mu.Unlock()
		return nil
	}
	if err := h.ensureConnLocked(ctx); err != nil {
		h.mu.Unlock()
		return err
	}
	if _, err := h.conn.Exec(ctx, "LISTEN "+quoteNotifyIdent(ch)); err != nil {
		h.mu.Unlock()
		return fmt.Errorf("postgres: listen %s: %w", ch, err)
	}
	h.channels[ch] = struct{}{}
	h.mu.Unlock()
	return nil
}

// Unlisten 取消订阅；无剩余频道时释放连接。
func (h *NotifyHub) Unlisten(ctx context.Context, channel string) error {
	ch, err := normalizeNotifyChannel(channel)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.channels[ch]; !ok {
		return nil
	}
	if h.conn != nil {
		if _, err := h.conn.Exec(ctx, "UNLISTEN "+quoteNotifyIdent(ch)); err != nil {
			return fmt.Errorf("postgres: unlisten %s: %w", ch, err)
		}
	}
	delete(h.channels, ch)
	if len(h.channels) == 0 {
		h.stopLocked()
	}
	return nil
}

// Channels 返回当前订阅频道。
func (h *NotifyHub) Channels() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]string, 0, len(h.channels))
	for ch := range h.channels {
		out = append(out, ch)
	}
	return out
}

// Close 停止等待循环并释放连接。
func (h *NotifyHub) Close() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.channels = make(map[string]struct{})
	h.stopLocked()
}

func (h *NotifyHub) ensureConnLocked(ctx context.Context) error {
	if h.conn != nil {
		return nil
	}
	if h.pool == nil {
		return fmt.Errorf("postgres: notify: nil pool")
	}
	conn, err := h.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("postgres: notify acquire: %w", err)
	}
	waitCtx, cancel := context.WithCancel(context.Background())
	h.conn = conn
	h.cancel = cancel
	go h.waitLoop(waitCtx, conn.Conn())
	return nil
}

func (h *NotifyHub) stopLocked() {
	if h.cancel != nil {
		h.cancel()
		h.cancel = nil
	}
	if h.conn != nil {
		h.conn.Release()
		h.conn = nil
	}
}

func (h *NotifyHub) waitLoop(ctx context.Context, conn *pgx.Conn) {
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return
		}
		if n == nil || h.emit == nil {
			continue
		}
		h.emit(map[string]any{
			"type":      notifyEventType,
			"sessionId": h.sessionID,
			"channel":   n.Channel,
			"payload":   n.Payload,
			"pid":       n.PID,
		})
	}
}

func normalizeNotifyChannel(channel string) (string, error) {
	ch := strings.TrimSpace(channel)
	if ch == "" {
		return "", fmt.Errorf("postgres: notify channel required")
	}
	if len(ch) > 63 {
		return "", fmt.Errorf("postgres: notify channel too long")
	}
	for i, r := range ch {
		if r == 0 || r == ';' || r == '"' {
			return "", fmt.Errorf("postgres: invalid notify channel")
		}
		if i == 0 && !unicode.IsLetter(r) && r != '_' {
			return "", fmt.Errorf("postgres: invalid notify channel")
		}
		if i > 0 && !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
			return "", fmt.Errorf("postgres: invalid notify channel")
		}
	}
	return ch, nil
}

func quoteNotifyIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
