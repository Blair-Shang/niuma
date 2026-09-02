package socket

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"niuma/pkg/common/id"
)

func (m *Manager) dialTCP(dialCtx, sessCtx context.Context, sess *session) error {
	conn, err := dialTCPConn(dialCtx, sess.spec)
	if err != nil {
		return err
	}
	sess.tcpConn = conn
	sess.localAddr = conn.LocalAddr().String()
	sess.remoteAddr = conn.RemoteAddr().String()
	sess.state = StateConnected
	go m.readTCP(sessCtx, sess, conn, "")
	return nil
}

func (m *Manager) listenTCP(ctx context.Context, sess *session) error {
	ln, err := net.Listen("tcp", bindTCPAddr(sess.spec))
	if err != nil {
		return fmt.Errorf("api: listen tcp: %w", err)
	}
	sess.listener = ln
	sess.localAddr = ln.Addr().String()
	sess.state = StateListening
	go m.acceptLoop(ctx, sess)
	return nil
}

func (m *Manager) acceptLoop(ctx context.Context, sess *session) {
	for {
		conn, err := sess.listener.Accept()
		if err != nil {
			if sess.isClosed() || ctx.Err() != nil {
				return
			}
			m.loseSession(sess, err.Error())
			return
		}
		sess.mu.Lock()
		if sess.closed || len(sess.peers) >= MaxPeers {
			sess.mu.Unlock()
			_ = conn.Close()
			continue
		}
		peerID := id.UniqueID("peer")
		p := &peer{
			id:          peerID,
			conn:        conn,
			remoteAddr:  conn.RemoteAddr().String(),
			localAddr:   conn.LocalAddr().String(),
			connectedAt: time.Now().UTC(),
		}
		sess.peers[peerID] = p
		sess.mu.Unlock()
		sess.emitState(StateAccepted, peerID, p.remoteAddr, "")
		go m.readTCP(ctx, sess, conn, peerID)
	}
}

func (m *Manager) readTCP(ctx context.Context, sess *session, conn net.Conn, peerID string) {
	buf := make([]byte, sess.spec.ReadLimit)
	for {
		if ctx.Err() != nil || sess.isClosed() {
			return
		}
		n, err := conn.Read(buf)
		if n > 0 {
			sess.emitData(peerID, conn.RemoteAddr().String(), conn.LocalAddr().String(), DirIn, buf[:n])
		}
		if err == nil {
			continue
		}
		if sess.isClosed() || ctx.Err() != nil || err == io.EOF {
			if peerID != "" {
				_ = sess.dropPeer(peerID, StateClosed, "")
			} else if err == io.EOF {
				m.loseSession(sess, "peer closed")
			}
			return
		}
		if peerID != "" {
			_ = sess.dropPeer(peerID, StateLost, err.Error())
		} else {
			m.loseSession(sess, err.Error())
		}
		return
	}
}

func (s *session) writeTCPClient(raw []byte) (SendResult, error) {
	s.mu.Lock()
	conn := s.tcpConn
	closed := s.closed
	remote := s.remoteAddr
	s.mu.Unlock()
	if closed || conn == nil {
		return SendResult{}, fmt.Errorf("api: session closed")
	}
	s.writeMu.Lock()
	err := writeAll(conn, raw)
	s.writeMu.Unlock()
	if err != nil {
		return SendResult{}, fmt.Errorf("api: tcp send: %w", err)
	}
	return SendResult{BytesSent: len(raw), At: time.Now().UTC(), RemoteAddr: remote}, nil
}

func (s *session) writeTCPPeer(peerID string, raw []byte) (SendResult, error) {
	p, err := s.pickPeer(peerID)
	if err != nil {
		return SendResult{}, err
	}
	p.writeMu.Lock()
	err = writeAll(p.conn, raw)
	p.writeMu.Unlock()
	if err != nil {
		return SendResult{}, fmt.Errorf("api: tcp send: %w", err)
	}
	return SendResult{
		BytesSent:  len(raw),
		At:         time.Now().UTC(),
		PeerID:     p.id,
		RemoteAddr: p.remoteAddr,
	}, nil
}

func (s *session) pickPeer(peerID string) (*peer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, fmt.Errorf("api: session closed")
	}
	peerID = strings.TrimSpace(peerID)
	if peerID != "" {
		p := s.peers[peerID]
		if p == nil {
			return nil, fmt.Errorf("api: peer not found")
		}
		return p, nil
	}
	if len(s.peers) == 1 {
		for _, p := range s.peers {
			return p, nil
		}
	}
	if len(s.peers) == 0 {
		return nil, fmt.Errorf("api: no connected peers")
	}
	return nil, fmt.Errorf("api: peerId required when multiple peers are connected")
}

func (s *session) dropPeer(peerID string, state State, message string) error {
	s.mu.Lock()
	if s.peers == nil {
		s.mu.Unlock()
		return fmt.Errorf("api: peer not found")
	}
	p := s.peers[peerID]
	if p == nil {
		s.mu.Unlock()
		return fmt.Errorf("api: peer not found")
	}
	delete(s.peers, peerID)
	s.mu.Unlock()
	_ = p.conn.Close()
	s.emitState(state, peerID, p.remoteAddr, message)
	return nil
}

func dialTCPConn(ctx context.Context, spec OpenSpec) (net.Conn, error) {
	dialer := net.Dialer{Timeout: spec.Timeout}
	if spec.LocalHost != "" || spec.LocalPort > 0 {
		ip := net.ParseIP(spec.LocalHost)
		if spec.LocalHost != "" && ip == nil {
			return nil, fmt.Errorf("api: invalid localHost %q", spec.LocalHost)
		}
		dialer.LocalAddr = &net.TCPAddr{IP: ip, Port: spec.LocalPort}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	dialCtx, cancel := context.WithTimeout(ctx, spec.Timeout)
	defer cancel()
	conn, err := dialer.DialContext(dialCtx, "tcp", joinHostPort(spec.Host, spec.Port))
	if err != nil {
		return nil, fmt.Errorf("api: dial tcp: %w", err)
	}
	return conn, nil
}

func bindTCPAddr(spec OpenSpec) string {
	host := spec.LocalHost
	port := spec.LocalPort
	if host == "" {
		if spec.Host != "" {
			host = spec.Host
		} else {
			host = "0.0.0.0"
		}
	}
	if port == 0 {
		port = spec.Port
	}
	return joinHostPort(host, port)
}

func writeAll(w interface{ Write([]byte) (int, error) }, raw []byte) error {
	for len(raw) > 0 {
		n, err := w.Write(raw)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		raw = raw[n:]
	}
	return nil
}
