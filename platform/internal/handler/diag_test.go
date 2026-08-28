package handler_test

import (
	"encoding/json"
	"testing"
	"time"

	"niuma/pkg/logutil"
	"niuma/platform/internal/handler"
)

func TestDiagTraceRequiresTraceID(t *testing.T) {
	d := newDispatcher(t)
	resp := invoke(t, d, handler.MethodDiagTrace, `{}`, "d1")
	if resp.OK || resp.ErrorCode != "invalid_params" {
		t.Fatalf("ok=%v code=%q err=%q", resp.OK, resp.ErrorCode, resp.Error)
	}
}

func TestDiagTraceFindsLocalObserve(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIUMMA_LOG_DIR", dir)
	t.Setenv("NIUMMA_LOG_ROOT", "")
	d := newDispatcher(t)
	t.Cleanup(logutil.CloseObserve)

	logutil.ObserveIPC(
		[]byte(`{"method":"mysql.query.exec","id":"q1","traceId":"diag-tr"}`),
		[]byte(`{"ok":false,"id":"q1","traceId":"diag-tr","errorCode":"timeout","result":""}`),
		250*time.Millisecond,
	)

	resp := invoke(t, d, handler.MethodDiagTrace, `{"traceId":"diag-tr"}`, "d2")
	if !resp.OK {
		t.Fatalf("trace: %s", resp.Error)
	}
	var body struct {
		Dir    string          `json:"dir"`
		Events []logutil.Event `json:"events"`
	}
	if err := json.Unmarshal([]byte(resp.Result), &body); err != nil {
		t.Fatal(err)
	}
	if body.Dir != dir || len(body.Events) != 1 {
		t.Fatalf("body=%+v", body)
	}
	if body.Events[0].ErrorCode != "timeout" {
		t.Fatalf("event=%+v", body.Events[0])
	}

	sumResp := invoke(t, d, handler.MethodDiagSummary, `{}`, "d3")
	if !sumResp.OK {
		t.Fatalf("summary: %s", sumResp.Error)
	}
	crashResp := invoke(t, d, handler.MethodDiagCrashes, `{}`, "d4")
	if !crashResp.OK {
		t.Fatalf("crashes: %s", crashResp.Error)
	}
}
