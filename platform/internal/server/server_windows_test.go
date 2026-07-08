//go:build windows

package server_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"

	"niuma/platform/internal/handler"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/protocol"
	"niuma/platform/internal/server"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

// TestServerPipeRoundTrip 在真实命名管道上验证 set → get 往返。
func TestServerPipeRoundTrip(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	addr := fmt.Sprintf(`\\.\pipe\niuma-test-%d`, os.Getpid())
	srv := server.New(addr, handler.New(handler.Deps{Settings: store.NewSettingStore(db)}))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ctx) }()

	// 管道监听器在 goroutine 中异步建立；winio 仅对 PIPE_BUSY 自动重试，
	// 对 FILE_NOT_FOUND 不重试，故这里自行轮询直到就绪（C++ 客户端同理）。
	conn := dialWithRetry(t, addr, 3*time.Second)
	defer conn.Close()

	// set
	writeReq(t, conn, `{"method":"platform.settings.set","params":{"key":"k","value":"v"},"id":"1"}`)
	if got := readResp(t, conn); got.Result != `{"updated":true}` || !got.OK {
		t.Fatalf("set resp: %+v", got)
	}

	// get（同一连接的第二个顺序请求）
	writeReq(t, conn, `{"method":"platform.settings.get","params":{"key":"k"},"id":"2"}`)
	if got := readResp(t, conn); got.Result != `{"value":"v"}` || !got.OK {
		t.Fatalf("get resp: %+v", got)
	}

	cancel()
	select {
	case <-serveErr:
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop after ctx cancel")
	}
}

// dialWithRetry 反复尝试连接命名管道，直到成功或超过 deadline。
func dialWithRetry(t *testing.T, addr string, within time.Duration) net.Conn {
	t.Helper()
	deadline := time.Now().Add(within)
	step := 10 * time.Millisecond
	for {
		conn, err := winio.DialPipe(addr, &step)
		if err == nil {
			return conn
		}
		if time.Now().After(deadline) {
			t.Fatalf("dial pipe: %v", err)
		}
		time.Sleep(step)
	}
}

func writeReq(t *testing.T, conn interface{ Write([]byte) (int, error) }, req string) {
	t.Helper()
	if err := protocol.WriteFrame(conn, []byte(req)); err != nil {
		t.Fatalf("write frame: %v", err)
	}
}

func readResp(t *testing.T, conn interface{ Read([]byte) (int, error) }) handler.Response {
	t.Helper()
	payload, err := protocol.ReadFrame(conn)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var resp handler.Response
	if err := json.Unmarshal(payload, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return resp
}
