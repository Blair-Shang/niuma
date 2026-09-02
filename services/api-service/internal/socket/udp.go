package socket

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"
)

func (m *Manager) bindUDP(ctx context.Context, sess *session) error {
	conn, err := listenUDP(sess.spec)
	if err != nil {
		return err
	}
	sess.udpConn = conn
	sess.localAddr = conn.LocalAddr().String()
	// 非通配 host:port 是客户端默认对端；通配或仅 local* 是监听绑定。
	if !isWildcard(sess.spec.Host) && sess.spec.Port > 0 {
		sess.destHost = sess.spec.Host
		sess.destPort = sess.spec.Port
		sess.remoteAddr = joinHostPort(sess.destHost, sess.destPort)
		sess.state = StateConnected
	} else {
		sess.state = StateListening
	}
	go m.readUDP(ctx, sess)
	return nil
}

func (m *Manager) readUDP(ctx context.Context, sess *session) {
	buf := make([]byte, sess.spec.ReadLimit)
	for {
		if ctx.Err() != nil || sess.isClosed() {
			return
		}
		n, addr, err := sess.udpConn.ReadFromUDP(buf)
		if n > 0 && addr != nil {
			sess.rememberUDPPeer(addr)
			sess.emitData("", addr.String(), sess.localAddr, DirIn, buf[:n])
		}
		if err == nil {
			continue
		}
		if sess.isClosed() || ctx.Err() != nil {
			return
		}
		m.loseSession(sess, err.Error())
		return
	}
}

func (s *session) rememberUDPPeer(addr *net.UDPAddr) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastHost = addr.IP.String()
	s.lastPort = addr.Port
	s.remoteAddr = addr.String()
}

func (s *session) writeUDP(host string, port int, raw []byte) (SendResult, error) {
	s.mu.Lock()
	conn := s.udpConn
	closed := s.closed
	host, port = pickUDPDest(host, port, s.lastHost, s.lastPort, s.destHost, s.destPort)
	s.mu.Unlock()
	if closed || conn == nil {
		return SendResult{}, fmt.Errorf("api: session closed")
	}
	if host == "" || isWildcard(host) || port <= 0 {
		return SendResult{}, fmt.Errorf("api: udp send requires host and port")
	}
	addr, err := net.ResolveUDPAddr("udp", joinHostPort(host, port))
	if err != nil {
		return SendResult{}, fmt.Errorf("api: resolve udp: %w", err)
	}
	n, err := conn.WriteToUDP(raw, addr)
	if err != nil {
		return SendResult{}, fmt.Errorf("api: udp send: %w", err)
	}
	return SendResult{BytesSent: n, At: time.Now().UTC(), RemoteAddr: addr.String()}, nil
}

// pickUDPDest 解析发送目的：显式非通配地址优先；通配/空则回最近 recvfrom，再回打开时的默认对端。
// 通配 host 会丢掉随绑端口传来的 port（工作台常把 0.0.0.0:监听端口当成发送目的）。
func pickUDPDest(host string, port int, lastHost string, lastPort int, destHost string, destPort int) (string, int) {
	host = strings.TrimSpace(host)
	if host == "" || isWildcard(host) {
		if lastHost != "" && lastPort > 0 {
			return lastHost, lastPort
		}
		return destHost, destPort
	}
	if port <= 0 {
		if lastHost == host && lastPort > 0 {
			return host, lastPort
		}
		return host, destPort
	}
	return host, port
}

func listenUDP(spec OpenSpec) (*net.UDPConn, error) {
	host, port := udpBind(spec)
	addr, err := net.ResolveUDPAddr("udp", joinHostPort(host, port))
	if err != nil {
		return nil, fmt.Errorf("api: resolve udp bind: %w", err)
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return nil, fmt.Errorf("api: listen udp: %w", err)
	}
	return conn, nil
}

func udpBind(spec OpenSpec) (string, int) {
	host := spec.LocalHost
	port := spec.LocalPort
	if host == "" {
		if isWildcard(spec.Host) {
			host = spec.Host
		} else {
			host = "0.0.0.0"
		}
	}
	if host == "" || host == "*" {
		host = "0.0.0.0"
	}
	if port == 0 && isWildcard(spec.Host) {
		port = spec.Port
	}
	return host, port
}
