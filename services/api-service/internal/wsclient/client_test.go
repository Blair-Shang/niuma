package wsclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestConnectEchoAndClose(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Trace") != "1" {
			http.Error(w, "missing header", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "")
		ctx := r.Context()
		for {
			kind, raw, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if err := conn.Write(ctx, kind, raw); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	var events []string
	hub := NewHub(func(ev map[string]any) {
		events = append(events, ev["type"].(string)+":"+stringValue(ev["state"])+stringValue(ev["direction"]))
	})
	info, err := hub.Connect(context.Background(), ConnectSpec{
		URL:     "ws" + strings.TrimPrefix(srv.URL, "http"),
		Headers: []Header{{Name: "X-Trace", Value: "1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hub.Send(context.Background(), SendSpec{SessionID: info.SessionID, Data: "ping", Encoding: "utf8"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !hasDirection(events, "in") {
		time.Sleep(10 * time.Millisecond)
	}
	if !hasDirection(events, "in") {
		t.Fatalf("events = %#v", events)
	}
	if err := hub.Close(info.SessionID); err != nil {
		t.Fatal(err)
	}
}

func TestConnectRejectsHTTPURL(t *testing.T) {
	hub := NewHub(nil)
	_, err := hub.Connect(context.Background(), ConnectSpec{URL: "http://example.com"})
	if err == nil {
		t.Fatal("expected scheme error")
	}
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func hasDirection(events []string, direction string) bool {
	for _, event := range events {
		if strings.HasSuffix(event, direction) {
			return true
		}
	}
	return false
}
