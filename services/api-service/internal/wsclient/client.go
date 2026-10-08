// Package wsclient 维护 WebSocket 客户端会话。
//
// 与 TCP/UDP 的 socket.Manager 分开：握手、子协议和 wss 都在这里完成。
// 收发事件沿用 api.socket.data / api.session.state，工作台按 sessionId 订阅。
package wsclient

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"niuma/pkg/common/id"
	"niuma/services/api-service/internal/codec"
)

const (
	defaultTimeout = 15 * time.Second
	maxTimeout     = 2 * time.Minute
	maxPayload     = 1 << 20
)

// Header 是握手时附加的请求头。
type Header struct {
	Name  string
	Value string
}

// ConnectSpec 打开一条 WebSocket。
type ConnectSpec struct {
	URL       string
	Headers   []Header
	Protocols []string
	Insecure  bool
	Proxy     string
	CertFile  string
	KeyFile   string
	Timeout   time.Duration
}

// SendSpec 在已连接的会话上发送一条消息。
type SendSpec struct {
	SessionID string
	Data      string
	Encoding  string
}

// Info 是连接成功后的快照。
type Info struct {
	SessionID  string `json:"sessionId"`
	State      string `json:"state"`
	URL        string `json:"url"`
	LocalAddr  string `json:"localAddr,omitempty"`
	RemoteAddr string `json:"remoteAddr,omitempty"`
}

// Emitter 把事件交给平台事件入口。
type Emitter func(map[string]any)

// Hub 管理进程内的 WebSocket 客户端。
type Hub struct {
	mu       sync.Mutex
	sessions map[string]*session
	emit     Emitter
}

type session struct {
	id         string
	url        string
	localAddr  string
	remoteAddr string
	conn       *websocket.Conn
	emit       Emitter
	cancel     context.CancelFunc
	remove     func()
	done       sync.Once
}

// NewHub 创建会话表。emit 为 nil 时丢弃事件。
func NewHub(emit Emitter) *Hub {
	if emit == nil {
		emit = func(map[string]any) {}
	}
	return &Hub{sessions: map[string]*session{}, emit: emit}
}

// Connect 完成握手并开始读循环。
func (h *Hub) Connect(ctx context.Context, spec ConnectSpec) (Info, error) {
	target, err := normalizeURL(spec.URL)
	if err != nil {
		return Info{}, err
	}
	timeout := spec.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	if timeout > maxTimeout {
		timeout = maxTimeout
	}
	client, err := dialClient(spec)
	if err != nil {
		return Info{}, err
	}
	dialCtx, cancelDial := context.WithTimeout(ctx, timeout)
	conn, resp, err := websocket.Dial(dialCtx, target.String(), &websocket.DialOptions{
		HTTPHeader:   handshakeHeader(spec.Headers),
		Subprotocols: cleanProtocols(spec.Protocols),
		HTTPClient:   client,
	})
	cancelDial()
	if err != nil {
		return Info{}, fmt.Errorf("ws: %w", err)
	}
	conn.SetReadLimit(maxPayload)
	sid := id.UniqueID("ws")
	sessCtx, cancel := context.WithCancel(context.Background())
	sess := &session{
		id:         sid,
		url:        target.String(),
		remoteAddr: target.Host,
		conn:       conn,
		emit:       h.emit,
		cancel:     cancel,
		remove:     func() { h.drop(sid) },
	}
	if resp != nil && resp.Request != nil {
		sess.localAddr = resp.Request.Host
	}
	h.mu.Lock()
	if len(h.sessions) >= 64 {
		h.mu.Unlock()
		cancel()
		_ = conn.Close(websocket.StatusPolicyViolation, "too many sessions")
		return Info{}, fmt.Errorf("ws: too many sessions")
	}
	h.sessions[sid] = sess
	h.mu.Unlock()
	h.emit(stateEvent(sid, "connected", sess.remoteAddr, ""))
	go sess.readLoop(sessCtx)
	return Info{
		SessionID:  sid,
		State:      "connected",
		URL:        sess.url,
		LocalAddr:  sess.localAddr,
		RemoteAddr: sess.remoteAddr,
	}, nil
}

// Send 写出一条文本或二进制消息，并记入收发流。
func (h *Hub) Send(_ context.Context, spec SendSpec) (int, error) {
	sess, err := h.get(spec.SessionID)
	if err != nil {
		return 0, err
	}
	raw, err := codec.Decode(spec.Data, codec.Normalize(spec.Encoding), maxPayload)
	if err != nil {
		return 0, err
	}
	kind := websocket.MessageText
	if codec.Normalize(spec.Encoding) == codec.Base64 || codec.Normalize(spec.Encoding) == codec.Hex {
		kind = websocket.MessageBinary
	}
	writeCtx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()
	if err := sess.conn.Write(writeCtx, kind, raw); err != nil {
		return 0, fmt.Errorf("ws: %w", err)
	}
	h.emit(dataEvent(sess.id, "out", sess.remoteAddr, sess.localAddr, raw))
	return len(raw), nil
}

// Close 主动断开。
func (h *Hub) Close(sessionID string) error {
	sess, err := h.take(sessionID)
	if err != nil {
		return err
	}
	sess.finish("closed", "")
	return nil
}

func (s *session) readLoop(ctx context.Context) {
	for {
		_, raw, err := s.conn.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				s.finish("closed", "")
				return
			}
			s.finish("lost", err.Error())
			return
		}
		s.emit(dataEvent(s.id, "in", s.remoteAddr, s.localAddr, raw))
	}
}

func (s *session) finish(state, message string) {
	s.done.Do(func() {
		s.cancel()
		_ = s.conn.Close(websocket.StatusNormalClosure, "")
		if s.remove != nil {
			s.remove()
		}
		s.emit(stateEvent(s.id, state, s.remoteAddr, message))
	})
}

func (h *Hub) get(sessionID string) (*session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	sess := h.sessions[strings.TrimSpace(sessionID)]
	if sess == nil {
		return nil, fmt.Errorf("ws: session not found")
	}
	return sess, nil
}

func (h *Hub) take(sessionID string) (*session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := strings.TrimSpace(sessionID)
	sess := h.sessions[id]
	if sess == nil {
		return nil, fmt.Errorf("ws: session not found")
	}
	delete(h.sessions, id)
	return sess, nil
}

func (h *Hub) drop(sessionID string) {
	h.mu.Lock()
	delete(h.sessions, sessionID)
	h.mu.Unlock()
}

func normalizeURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("ws: invalid url")
	}
	if parsed.Scheme != "ws" && parsed.Scheme != "wss" {
		return nil, fmt.Errorf("ws: unsupported scheme %s", parsed.Scheme)
	}
	return parsed, nil
}

func handshakeHeader(rows []Header) http.Header {
	out := make(http.Header)
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		if name == "" || hop(name) {
			continue
		}
		out.Add(name, row.Value)
	}
	return out
}

func hop(name string) bool {
	switch strings.ToLower(name) {
	case "connection", "upgrade", "host", "content-length", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol":
		return true
	default:
		return false
	}
}

func cleanProtocols(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		for _, part := range strings.Split(item, ",") {
			text := strings.TrimSpace(part)
			if text != "" {
				out = append(out, text)
			}
		}
	}
	return out
}

func dialClient(spec ConnectSpec) (*http.Client, error) {
	proxy := http.ProxyFromEnvironment
	if text := strings.TrimSpace(spec.Proxy); text != "" {
		parsed, err := url.Parse(text)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return nil, fmt.Errorf("ws: invalid proxy")
		}
		proxy = http.ProxyURL(parsed)
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: spec.Insecure}
	certFile := strings.TrimSpace(spec.CertFile)
	keyFile := strings.TrimSpace(spec.KeyFile)
	if certFile != "" || keyFile != "" {
		if certFile == "" || keyFile == "" {
			return nil, fmt.Errorf("ws: client certificate needs both cert and key")
		}
		pair, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, fmt.Errorf("ws: client certificate: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{pair}
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:              proxy,
			ForceAttemptHTTP2:  true,
			TLSClientConfig:    tlsCfg,
			DisableCompression: true,
		},
	}, nil
}

func dataEvent(sessionID, direction, remote, local string, raw []byte) map[string]any {
	view := codec.Inspect(raw, codec.UTF8)
	return map[string]any{
		"type":       "api.socket.data",
		"sessionId":  sessionID,
		"direction":  direction,
		"remoteAddr": remote,
		"localAddr":  local,
		"encoding":   string(view.Encoding),
		"data":       view.Data,
		"hex":        view.Hex,
		"bytes":      view.Bytes,
		"at":         time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func stateEvent(sessionID, state, remote, message string) map[string]any {
	ev := map[string]any{
		"type":       "api.session.state",
		"sessionId":  sessionID,
		"state":      state,
		"remoteAddr": remote,
	}
	if message != "" {
		ev["message"] = message
	}
	return ev
}
