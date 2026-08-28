package eventhub

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"niuma/pkg/serviceipc/event"
)

const progressCoalesceInterval = 100 * time.Millisecond // 10 Hz，对齐 docs/12 §7.3

// progressCoalescer 对 type 以 .progress 结尾的事件按键保留最新值、定时扇出；其余立即转发。
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

type progressHeader struct {
	Type     string `json:"type"`
	TaskID   string `json:"taskId"`
	BundleID string `json:"bundleId"`
	ToolID   string `json:"toolId"`
}

func progressKey(hdr progressHeader) string {
	if id := strings.TrimSpace(hdr.TaskID); id != "" {
		return hdr.Type + "\x00" + id
	}
	if b := strings.TrimSpace(hdr.BundleID); b != "" {
		return hdr.Type + "\x00" + b + "\x00" + strings.TrimSpace(hdr.ToolID)
	}
	return hdr.Type
}

func (c *progressCoalescer) handle(payload []byte) {
	var hdr progressHeader
	if err := json.Unmarshal(payload, &hdr); err != nil || !event.IsProgressType(hdr.Type) {
		c.hub.fanOut(payload, false)
		return
	}

	key := progressKey(hdr)
	c.mu.Lock()
	c.latest[key] = append([]byte(nil), payload...)
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
	c.hub.fanOut(batch, true)
}
