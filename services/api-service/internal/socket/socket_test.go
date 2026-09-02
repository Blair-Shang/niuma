package socket

import (
	"context"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu  sync.Mutex
	evs []map[string]any
}

func (r *recorder) emit(ev map[string]any) {
	r.mu.Lock()
	r.evs = append(r.evs, ev)
	r.mu.Unlock()
}

func (r *recorder) wait(pred func(map[string]any) bool, d time.Duration) (map[string]any, bool) {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		for _, ev := range r.evs {
			if pred(ev) {
				r.mu.Unlock()
				return ev, true
			}
		}
		r.mu.Unlock()
		time.Sleep(8 * time.Millisecond)
	}
	return nil, false
}

func localPort(addr string) int {
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return 0
	}
	port, _ := strconv.Atoi(portStr)
	return port
}

func TestTCPClientServerRoundTrip(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	m := NewManager(rec.emit)
	ctx := context.Background()

	server, err := m.Open(ctx, OpenSpec{Kind: KindTCPServer, Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(server.SessionID) })

	client, err := m.Open(ctx, OpenSpec{
		Kind: KindTCPClient,
		Host: "127.0.0.1",
		Port: localPort(server.LocalAddr),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(client.SessionID) })

	accepted, ok := rec.wait(func(ev map[string]any) bool {
		return ev["type"] == EventState && ev["sessionId"] == server.SessionID && ev["state"] == string(StateAccepted)
	}, 2*time.Second)
	if !ok {
		t.Fatal("server did not accept client")
	}

	if _, err := m.Send(ctx, SendSpec{SessionID: client.SessionID, Data: "ping"}); err != nil {
		t.Fatal(err)
	}
	in, ok := rec.wait(func(ev map[string]any) bool {
		return ev["type"] == EventData && ev["sessionId"] == server.SessionID && ev["direction"] == string(DirIn) && ev["data"] == "ping"
	}, 2*time.Second)
	if !ok {
		t.Fatal("server did not receive ping")
	}
	if in["hex"] != "70696e67" {
		t.Fatalf("hex = %v", in["hex"])
	}

	peerID, _ := accepted["peerId"].(string)
	if _, err := m.Send(ctx, SendSpec{SessionID: server.SessionID, PeerID: peerID, Data: "pong"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := rec.wait(func(ev map[string]any) bool {
		return ev["type"] == EventData && ev["sessionId"] == client.SessionID && ev["data"] == "pong"
	}, 2*time.Second); !ok {
		t.Fatal("client did not receive pong")
	}

	peers, err := m.Peers(server.SessionID)
	if err != nil || len(peers) != 1 {
		t.Fatalf("peers = %v err=%v", peers, err)
	}
	if err := m.Kick(server.SessionID, peers[0].PeerID); err != nil {
		t.Fatal(err)
	}
}

func TestUDPRoundTrip(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	m := NewManager(rec.emit)
	ctx := context.Background()

	sender, err := m.Open(ctx, OpenSpec{Kind: KindUDP, LocalHost: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(sender.SessionID) })

	recv, err := m.Open(ctx, OpenSpec{Kind: KindUDP, LocalHost: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(recv.SessionID) })

	port := localPort(recv.LocalAddr)
	if port == 0 {
		t.Fatalf("recv local addr %s", recv.LocalAddr)
	}
	if _, err := m.Send(ctx, SendSpec{SessionID: sender.SessionID, Data: "hello-udp", Host: "127.0.0.1", Port: port}); err != nil {
		t.Fatal(err)
	}
	if _, ok := rec.wait(func(ev map[string]any) bool {
		return ev["type"] == EventData && ev["sessionId"] == recv.SessionID && ev["data"] == "hello-udp"
	}, 2*time.Second); !ok {
		t.Fatal("udp receiver did not get datagram")
	}
}

func TestUDPClientConnectedAndServerReply(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	m := NewManager(rec.emit)
	ctx := context.Background()

	server, err := m.Open(ctx, OpenSpec{Kind: KindUDP, Host: "0.0.0.0", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(server.SessionID) })
	if server.State != StateListening {
		t.Fatalf("server state = %s", server.State)
	}

	client, err := m.Open(ctx, OpenSpec{Kind: KindUDP, Host: "127.0.0.1", Port: localPort(server.LocalAddr)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(client.SessionID) })
	if client.State != StateConnected {
		t.Fatalf("client state = %s", client.State)
	}

	if _, err := m.Send(ctx, SendSpec{SessionID: client.SessionID, Data: "ping"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := rec.wait(func(ev map[string]any) bool {
		return ev["type"] == EventData && ev["sessionId"] == server.SessionID && ev["direction"] == string(DirIn) && ev["data"] == "ping"
	}, 2*time.Second); !ok {
		t.Fatal("server did not receive ping")
	}

	// 工作台会把绑定地址 0.0.0.0:监听端口传进来，必须改寄到最近 recvfrom，而不是监听端口。
	if _, err := m.Send(ctx, SendSpec{
		SessionID: server.SessionID,
		Data:      "pong",
		Host:      "0.0.0.0",
		Port:      localPort(server.LocalAddr),
	}); err != nil {
		t.Fatal(err)
	}
	if _, ok := rec.wait(func(ev map[string]any) bool {
		return ev["type"] == EventData && ev["sessionId"] == client.SessionID && ev["data"] == "pong"
	}, 2*time.Second); !ok {
		t.Fatal("client did not receive pong")
	}
}

func TestUDPListenSpecificLocal(t *testing.T) {
	t.Parallel()
	m := NewManager(nil)
	sess, err := m.Open(context.Background(), OpenSpec{Kind: KindUDP, LocalHost: "127.0.0.1", LocalPort: 0})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(sess.SessionID) })
	if sess.State != StateListening {
		t.Fatalf("state = %s", sess.State)
	}
	if sess.RemoteAddr != "" {
		t.Fatalf("listen bind should not set dest, got %s", sess.RemoteAddr)
	}
	host, _, err := net.SplitHostPort(sess.LocalAddr)
	if err != nil || host != "127.0.0.1" {
		t.Fatalf("local = %s err=%v", sess.LocalAddr, err)
	}
}

func TestPickUDPDest(t *testing.T) {
	t.Parallel()
	host, port := pickUDPDest("0.0.0.0", 9000, "10.0.0.8", 54321, "", 0)
	if host != "10.0.0.8" || port != 54321 {
		t.Fatalf("wildcard bind addr -> last peer, got %s:%d", host, port)
	}
	host, port = pickUDPDest("", 0, "", 0, "127.0.0.1", 5353)
	if host != "127.0.0.1" || port != 5353 {
		t.Fatalf("empty -> dest, got %s:%d", host, port)
	}
	host, port = pickUDPDest("8.8.8.8", 53, "10.0.0.8", 9, "127.0.0.1", 5353)
	if host != "8.8.8.8" || port != 53 {
		t.Fatalf("explicit dest kept, got %s:%d", host, port)
	}
}

func TestOpenRejectsBadKind(t *testing.T) {
	t.Parallel()
	m := NewManager(nil)
	_, err := m.Open(context.Background(), OpenSpec{Kind: "http", Host: "127.0.0.1", Port: 80})
	if err == nil || !strings.Contains(err.Error(), "unknown kind") {
		t.Fatalf("err = %v", err)
	}
}

func TestSessionTestBindsEphemeral(t *testing.T) {
	t.Parallel()
	m := NewManager(nil)
	msg, err := m.Test(context.Background(), OpenSpec{Kind: KindTCPServer, Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "tcp-server bind") {
		t.Fatalf("msg = %q", msg)
	}
}
