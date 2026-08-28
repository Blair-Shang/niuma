package eventhub

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"niuma/pkg/serviceipc/protocol"
)

func TestProgressKey_TaskAndBundle(t *testing.T) {
	t.Parallel()
	if got := progressKey(progressHeader{Type: "mysql.io.progress", TaskID: "t1"}); got != "mysql.io.progress\x00t1" {
		t.Fatalf("task key=%q", got)
	}
	if got := progressKey(progressHeader{Type: "platform.components.install.progress", BundleID: "git"}); got == "" {
		t.Fatal("bundle key empty")
	}
}

func TestCoalesce_KeepsLatestProgress(t *testing.T) {
	h := New()
	cli, srv := net.Pipe()
	defer cli.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.handleShellConn(ctx, srv)
	time.Sleep(20 * time.Millisecond)

	h.ingest([]byte(`{"type":"mysql.io.progress","taskId":"t1","bytes":1}`))
	h.ingest([]byte(`{"type":"mysql.io.progress","taskId":"t1","bytes":9}`))

	_ = cli.SetReadDeadline(time.Now().Add(time.Second))
	payload, err := protocol.ReadFrame(cli)
	if err != nil {
		t.Fatal(err)
	}
	var batch struct {
		Type   string            `json:"type"`
		Events []json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(payload, &batch); err != nil {
		t.Fatal(err)
	}
	if batch.Type != "platform.event.batch" || len(batch.Events) != 1 {
		t.Fatalf("batch=%s events=%d", batch.Type, len(batch.Events))
	}
	var inner map[string]any
	if err := json.Unmarshal(batch.Events[0], &inner); err != nil {
		t.Fatal(err)
	}
	if inner["bytes"] != float64(9) {
		t.Fatalf("want latest bytes=9 got %#v", inner["bytes"])
	}
}

func TestFanOut_ProgressDoesNotBlockWhenShellSlow(t *testing.T) {
	h := New()
	cli, srv := net.Pipe()
	defer cli.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.handleShellConn(ctx, srv)
	time.Sleep(20 * time.Millisecond)

	done := make(chan struct{})
	go func() {
		for i := 0; i < 80; i++ {
			h.fanOut([]byte(`{"type":"ftp.transfer.progress","taskId":"x"}`), true)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("progress fan-out blocked on slow shell")
	}
}

func TestPublish_StateNotCoalesced(t *testing.T) {
	h := New()
	cli, srv := net.Pipe()
	defer cli.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.handleShellConn(ctx, srv)
	time.Sleep(20 * time.Millisecond)

	h.Publish(map[string]any{"type": "ftp.session.state", "sessionId": "*", "state": "lost"})
	_ = cli.SetReadDeadline(time.Now().Add(time.Second))
	payload, err := protocol.ReadFrame(cli)
	if err != nil {
		t.Fatal(err)
	}
	var ev map[string]any
	if err := json.Unmarshal(payload, &ev); err != nil {
		t.Fatal(err)
	}
	if ev["type"] != "ftp.session.state" {
		t.Fatalf("got %#v", ev)
	}
}

func TestFanOut_ReliableBlocksUntilSinkDead(t *testing.T) {
	h := New()
	cli, srv := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.handleShellConn(ctx, srv)
	time.Sleep(20 * time.Millisecond)

	h.fanOut([]byte(`{"type":"ftp.transfer.progress","taskId":"x"}`), true)
	time.Sleep(30 * time.Millisecond)

	for i := 0; i < shellOutQueueSize+2; i++ {
		h.fanOut([]byte(`{"type":"ftp.transfer.progress","taskId":"x"}`), true)
	}

	done := make(chan struct{})
	go func() {
		h.fanOut([]byte(`{"type":"ftp.session.state","sessionId":"s1","state":"lost"}`), false)
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("reliable event must not drop while sink is alive")
	case <-time.After(150 * time.Millisecond):
	}
	_ = cli.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("reliable enqueue should unblock when sink dies")
	}
}
