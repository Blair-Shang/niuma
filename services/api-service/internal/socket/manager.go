package socket

import (
	"context"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"niuma/pkg/common/id"
	"niuma/services/api-service/internal/codec"
)

// Emitter 把套接字事件交给 Platform 事件入口。
type Emitter func(map[string]any)

// Manager 管理进程内 TCP/UDP 会话。
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	emit     Emitter
}

type session struct {
	id         string
	kind       Kind
	spec       OpenSpec
	state      State
	localAddr  string
	remoteAddr string
	destHost   string
	destPort   int
	lastHost   string
	lastPort   int
	openedAt   time.Time
	emit       Emitter

	mu       sync.Mutex
	closed   bool
	cancel   context.CancelFunc
	tcpConn  net.Conn
	writeMu  sync.Mutex
	listener net.Listener
	udpConn  *net.UDPConn
	peers    map[string]*peer
}

type peer struct {
	id          string
	conn        net.Conn
	remoteAddr  string
	localAddr   string
	connectedAt time.Time
	writeMu     sync.Mutex
}

// NewManager 创建会话管理器。emit 为 nil 时丢弃事件（测试可用）。
func NewManager(emit Emitter) *Manager {
	if emit == nil {
		emit = func(map[string]any) {}
	}
	return &Manager{
		sessions: make(map[string]*session),
		emit:     emit,
	}
}

// Open 按角色拨号、监听或绑定，并启动接收循环。
func (m *Manager) Open(ctx context.Context, spec OpenSpec) (SessionInfo, error) {
	spec, err := normalizeSpec(spec)
	if err != nil {
		return SessionInfo{}, err
	}
	m.mu.Lock()
	n := len(m.sessions)
	m.mu.Unlock()
	if n >= MaxSessions {
		return SessionInfo{}, fmt.Errorf("api: too many sessions (max %d)", MaxSessions)
	}

	sid := id.UniqueID("sess")
	sessCtx, cancel := context.WithCancel(context.Background())
	sess := &session{
		id:       sid,
		kind:     spec.Kind,
		spec:     spec,
		openedAt: time.Now().UTC(),
		emit:     m.emit,
		cancel:   cancel,
		peers:    make(map[string]*peer),
	}

	switch spec.Kind {
	case KindTCPClient:
		err = m.dialTCP(ctx, sessCtx, sess)
	case KindTCPServer:
		err = m.listenTCP(sessCtx, sess)
	case KindUDP:
		err = m.bindUDP(sessCtx, sess)
	default:
		err = fmt.Errorf("api: unknown kind %q", spec.Kind)
	}
	if err != nil {
		cancel()
		return SessionInfo{}, err
	}

	m.mu.Lock()
	m.sessions[sid] = sess
	m.mu.Unlock()
	sess.emitState(sess.state, "", sess.remoteAddr, "")
	return sess.info(), nil
}

// Close 主动关闭会话及其全部对端。
func (m *Manager) Close(sessionID string) error {
	sess, err := m.take(sessionID)
	if err != nil {
		return err
	}
	sess.shutdown(StateClosed, "")
	return nil
}

// Test 探测能否拨号或绑定，成功后立即释放，不保留会话。
func (m *Manager) Test(ctx context.Context, spec OpenSpec) (string, error) {
	spec, err := normalizeSpec(spec)
	if err != nil {
		return "", err
	}
	switch spec.Kind {
	case KindTCPClient:
		conn, err := dialTCPConn(ctx, spec)
		if err != nil {
			return "", err
		}
		local := conn.LocalAddr().String()
		remote := conn.RemoteAddr().String()
		_ = conn.Close()
		return fmt.Sprintf("tcp-client %s -> %s", local, remote), nil
	case KindTCPServer:
		ln, err := net.Listen("tcp", bindTCPAddr(spec))
		if err != nil {
			return "", err
		}
		addr := ln.Addr().String()
		_ = ln.Close()
		return "tcp-server bind " + addr, nil
	case KindUDP:
		conn, err := listenUDP(spec)
		if err != nil {
			return "", err
		}
		addr := conn.LocalAddr().String()
		_ = conn.Close()
		return "udp bind " + addr, nil
	default:
		return "", fmt.Errorf("api: unknown kind %q", spec.Kind)
	}
}

// Send 在已打开的会话上写出一帧。
func (m *Manager) Send(_ context.Context, spec SendSpec) (SendResult, error) {
	enc := spec.Encoding
	if enc == "" {
		if sess, err := m.get(spec.SessionID); err == nil {
			enc = sess.spec.Encoding
		}
	}
	raw, err := codec.Decode(spec.Data, enc, MaxPayload)
	if err != nil {
		return SendResult{}, err
	}
	if len(raw) == 0 {
		return SendResult{}, fmt.Errorf("api: empty payload")
	}
	sess, err := m.get(spec.SessionID)
	if err != nil {
		return SendResult{}, err
	}
	var result SendResult
	switch sess.kind {
	case KindTCPClient:
		result, err = sess.writeTCPClient(raw)
	case KindTCPServer:
		result, err = sess.writeTCPPeer(spec.PeerID, raw)
	case KindUDP:
		result, err = sess.writeUDP(spec.Host, spec.Port, raw)
	default:
		err = fmt.Errorf("api: unknown kind %q", sess.kind)
	}
	if err != nil {
		return SendResult{}, err
	}
	sess.emitData(result.PeerID, result.RemoteAddr, sess.localAddr, DirOut, raw)
	return result, nil
}

// List 返回当前会话快照。
func (m *Manager) List() []SessionInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SessionInfo, 0, len(m.sessions))
	for _, sess := range m.sessions {
		out = append(out, sess.info())
	}
	return out
}

// Peers 列出 TCP 监听下的已接受对端。
func (m *Manager) Peers(sessionID string) ([]PeerInfo, error) {
	sess, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	if sess.kind != KindTCPServer {
		return nil, fmt.Errorf("api: peers only valid for tcp-server")
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	out := make([]PeerInfo, 0, len(sess.peers))
	for _, p := range sess.peers {
		out = append(out, PeerInfo{
			PeerID:      p.id,
			RemoteAddr:  p.remoteAddr,
			LocalAddr:   p.localAddr,
			ConnectedAt: p.connectedAt,
		})
	}
	return out, nil
}

// Kick 断开 TCP 监听下的指定对端。
func (m *Manager) Kick(sessionID, peerID string) error {
	sess, err := m.get(sessionID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(peerID) == "" {
		return fmt.Errorf("api: peerId required")
	}
	return sess.dropPeer(peerID, StateClosed, "")
}

func (m *Manager) get(sessionID string) (*session, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, fmt.Errorf("api: sessionId required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	sess := m.sessions[sessionID]
	if sess == nil {
		return nil, fmt.Errorf("api: session not found")
	}
	return sess, nil
}

func (m *Manager) take(sessionID string) (*session, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, fmt.Errorf("api: sessionId required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	sess := m.sessions[sessionID]
	if sess == nil {
		return nil, fmt.Errorf("api: session not found")
	}
	delete(m.sessions, sessionID)
	return sess, nil
}

func (m *Manager) loseSession(sess *session, message string) {
	taken, err := m.take(sess.id)
	if err != nil {
		return
	}
	taken.shutdown(StateLost, message)
}

func (s *session) info() SessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return SessionInfo{
		SessionID:  s.id,
		Kind:       s.kind,
		State:      s.state,
		Host:       s.spec.Host,
		Port:       s.spec.Port,
		LocalAddr:  s.localAddr,
		RemoteAddr: s.remoteAddr,
		Encoding:   s.spec.Encoding,
		OpenedAt:   s.openedAt,
		PeerCount:  len(s.peers),
	}
}

func (s *session) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *session) shutdown(state State, message string) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.state = state
	cancel := s.cancel
	conn := s.tcpConn
	ln := s.listener
	udp := s.udpConn
	peers := s.peers
	s.tcpConn = nil
	s.listener = nil
	s.udpConn = nil
	s.peers = map[string]*peer{}
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if conn != nil {
		_ = conn.Close()
	}
	if ln != nil {
		_ = ln.Close()
	}
	if udp != nil {
		_ = udp.Close()
	}
	for _, p := range peers {
		_ = p.conn.Close()
	}
	s.emitState(state, "", s.remoteAddr, message)
}

func (s *session) emitData(peerID, remote, local string, dir Direction, raw []byte) {
	s.emit(dataEvent(s.id, peerID, remote, local, dir, raw, s.spec.Encoding))
}

func (s *session) emitState(state State, peerID, remote, message string) {
	s.emit(stateEvent(s.id, state, peerID, remote, message))
}

func normalizeSpec(spec OpenSpec) (OpenSpec, error) {
	spec.Kind = Kind(strings.ToLower(strings.TrimSpace(string(spec.Kind))))
	switch spec.Kind {
	case KindTCPClient, KindTCPServer, KindUDP:
	default:
		return spec, fmt.Errorf("api: unknown kind %q (tcp-client|tcp-server|udp)", spec.Kind)
	}
	if spec.Timeout <= 0 {
		spec.Timeout = DefaultTimeout
	}
	if spec.ReadLimit <= 0 {
		spec.ReadLimit = DefaultRead
	}
	if spec.ReadLimit > MaxPayload {
		spec.ReadLimit = MaxPayload
	}
	spec.Encoding = codec.Normalize(string(spec.Encoding))
	spec.Host = strings.TrimSpace(spec.Host)
	spec.LocalHost = strings.TrimSpace(spec.LocalHost)
	if spec.Port < 0 || spec.Port > 65535 {
		return spec, fmt.Errorf("api: port out of range")
	}
	if spec.LocalPort < 0 || spec.LocalPort > 65535 {
		return spec, fmt.Errorf("api: localPort out of range")
	}
	if spec.Kind == KindTCPClient {
		if spec.Host == "" || isWildcard(spec.Host) {
			return spec, fmt.Errorf("api: host required for tcp-client")
		}
		if spec.Port == 0 {
			return spec, fmt.Errorf("api: port required for tcp-client")
		}
	}
	return spec, nil
}

func isWildcard(host string) bool {
	switch host {
	case "", "0.0.0.0", "::", "*", "[::]":
		return true
	default:
		return false
	}
}

func joinHostPort(host string, port int) string {
	if host == "" {
		host = "0.0.0.0"
	}
	if host == "*" {
		host = "0.0.0.0"
	}
	return net.JoinHostPort(host, fmt.Sprintf("%d", port))
}
