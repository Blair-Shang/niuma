package handler

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"niuma/pkg/serviceipc/envelope"
)

type nopEmit struct{}

func (nopEmit) Emit(map[string]any) {}

func invoke(t *testing.T, d *Dispatcher, method string, params any) envelope.Response {
	t.Helper()
	rawParams, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	req := envelope.Request{Method: method, Params: rawParams, ID: "t1"}
	frame, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var resp envelope.Response
	if err := json.Unmarshal(d.HandleFrame(context.Background(), frame), &resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestHandleUnknownMethod(t *testing.T) {
	t.Parallel()
	d := New(nopEmit{})
	resp := invoke(t, d, "http.send", map[string]any{})
	if resp.OK || !strings.Contains(resp.Error, "method not found") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestSessionOpenAndListTCPServer(t *testing.T) {
	t.Parallel()
	d := New(nopEmit{})
	resp := invoke(t, d, MethodSessionOpen, map[string]any{
		"kind": "tcp-server",
		"host": "127.0.0.1",
		"port": 0,
	})
	if !resp.OK {
		t.Fatalf("open: %+v", resp)
	}
	var info struct {
		SessionID string `json:"sessionId"`
		Kind      string `json:"kind"`
		State     string `json:"state"`
		LocalAddr string `json:"localAddr"`
	}
	if err := json.Unmarshal([]byte(resp.Result), &info); err != nil {
		t.Fatal(err)
	}
	if info.SessionID == "" || info.Kind != "tcp-server" || info.State != "listening" || info.LocalAddr == "" {
		t.Fatalf("info = %+v", info)
	}
	list := invoke(t, d, MethodSocketList, map[string]any{})
	if !list.OK || !strings.Contains(list.Result, info.SessionID) {
		t.Fatalf("list = %+v", list)
	}
	closed := invoke(t, d, MethodSessionClose, map[string]any{"sessionId": info.SessionID})
	if !closed.OK {
		t.Fatalf("close: %+v", closed)
	}
}

func TestSessionOpenRejectsTCPClientWithoutHost(t *testing.T) {
	t.Parallel()
	d := New(nopEmit{})
	resp := invoke(t, d, MethodSessionOpen, map[string]any{"kind": "tcp-client", "port": 9})
	if resp.OK || !strings.Contains(resp.Error, "host required") {
		t.Fatalf("resp = %+v", resp)
	}
}
