package eventhub

import (
	"encoding/json"
	"sync"
	"time"
)

const progressCoalesceInterval = 100 * time.Millisecond // 10 Hz，对齐 docs/12 §7.3

// progressCoalescer 对 progress 事件按 taskId 保留最新值、定时扇出；state 立即转发。
type progressCoalescer struct {
	hub      *Hub
	interval time.Duration

	mu     sync.Mutex
	latest map[string][]byte
	timer  *time.Timer
}

func newProgressCoalescer(hub *Hub, interval time.Duration) *progressCoalescer {
	if interval <= 0 {
		interval = progressCoalesceInterval
	}
	return &progressCoalescer{
		hub:      hub,
		interval: interval,
		latest:   make(map[string][]byte),
	}
}

func (c *progressCoalescer) handle(payload []byte) {
	var hdr struct {
		Type   string `json:"type"`
		TaskID string `json:"taskId"`
	}
	if err := json.Unmarshal(payload, &hdr); err != nil || hdr.Type != "ftp.transfer.progress" || hdr.TaskID == "" {
		c.hub.fanOut(payload)
		return
	}

	c.mu.Lock()
	c.latest[hdr.TaskID] = append([]byte(nil), payload...)
	if c.timer == nil {
		c.timer = time.AfterFunc(c.interval, c.flush)
	}
	c.mu.Unlock()
}

func (c *progressCoalescer) flush() {
	c.mu.Lock()
	if len(c.latest) == 0 {
		c.timer = nil
		c.mu.Unlock()
		return
	}
	events := make([]json.RawMessage, 0, len(c.latest))
	for _, p := range c.latest {
		events = append(events, json.RawMessage(p))
	}
	c.latest = make(map[string][]byte)
	c.timer = nil
	c.mu.Unlock()

	batch, err := json.Marshal(map[string]any{
		"type":   "platform.event.batch",
		"events": events,
	})
	if err != nil {
		return
	}
	c.hub.fanOut(batch)
}
